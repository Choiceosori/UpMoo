"""
Vercel Python Serverless Function.
여러 HWP(한글) 파일을 하나로 병합합니다. Next.js API Route
(src/app/api/merge/route.ts)가 category="hwp"일 때 내부적으로 이 엔드포인트를
호출합니다.

요청: POST { "urls": ["<입력 파일의 서명된 GET URL>", ...], "uploadUrl": "<병합
      결과를 올릴 서명된 PUT URL>" }  (urls는 제출 순서대로)
응답: 200 { "ok": true }
      4xx/5xx { "error": "메시지" }

파일 내용을 요청/응답 바디에 직접 base64로 싣지 않는 이유: Vercel Serverless
Function의 요청/응답 바디는 약 4.5MB로 제한되어 있어(FUNCTION_PAYLOAD_TOO_LARGE
/ HTTP 413), 제출 파일이 여러 개이거나 하나라도 크면 쉽게 그 한도를 넘습니다.
대신 Node(src/lib/mergeHwp.ts, src/app/api/merge/route.ts)가 각 원본 파일의
R2 서명 GET URL과, 결과를 올릴 서명 PUT URL을 미리 발급해 넘겨주면, 이 함수는
표준 라이브러리(urllib)만으로 직접 내려받고 올립니다 — boto3 등 AWS SDK를
설치할 필요가 없습니다.

이 파일이 CFB(OLE2 Compound File) 라이터와 HWP5 병합 로직까지 전부 한 파일에
담고 있는 이유: 이전에는 api/_hwplib/ 서브패키지로 분리해뒀는데, Vercel의
Python 빌더가 그 로컬 서브패키지를 함수와 함께 묶어주지 않아(vercel.json의
includeFiles로 명시했는데도) 매 요청마다 모듈을 못 찾아 원인을 알 수 없는 500
크래시가 반복됐습니다. Vercel이 "이 디렉터리의 .py 파일 하나 = 함수 하나"라는
가장 단순한 규칙은 확실히 보장하므로, 로컬 패키지 import에 전혀 의존하지 않도록
전부 이 한 파일 안에 넣어 그 불확실성 자체를 없앴습니다.

HWP5 병합 방식(best-effort, 실제 한글 프로그램으로 검증 못함): 첫 번째 파일의
컨테이너(스타일/폰트 등 DocInfo)를 그대로 두고, 이후 파일들의 BodyText 섹션만
이어 붙인 뒤 섹션 개수를 패치합니다. 모든 제출 파일이 같은 예시 양식에서 비롯된
경우(이 앱의 일반적인 사용 흐름)에 안전하게 동작할 가능성이 높습니다. 서로 다른
스타일 체계를 가진 문서를 섞으면 문단모양/글자모양 참조가 어긋나 깨질 수
있습니다.
"""
import io
import json
import struct
import traceback
import urllib.request
import zlib
from http.server import BaseHTTPRequestHandler

import olefile

# ---------------------------------------------------------------------------
# CFB(Compound File Binary) 라이터. MS-CFB 스펙(512바이트 섹터, major version 3)을
# 따릅니다. 미니스트림 컷오프는 스펙상 고정값 4096이므로(olefile 등 리더가 이
# 값을 강제합니다), 4096바이트 미만 스트림은 미니스트림/미니FAT에, 그 이상은
# 일반 FAT 섹터에 배치합니다. 109개 FAT 섹터(최대 약 7MB 컨테이너)를 넘으면
# 명시적으로 에러를 냅니다.
# ---------------------------------------------------------------------------
SECTOR_SIZE = 512
MINI_SECTOR_SIZE = 64
MINI_STREAM_CUTOFF = 4096
FREESECT = 0xFFFFFFFF
ENDOFCHAIN = 0xFFFFFFFE
FATSECT = 0xFFFFFFFD
NOSTREAM = 0xFFFFFFFF


def _build_tree(paths):
    root = {}
    for path in paths:
        parts = path.split("/")
        node = root
        for i, part in enumerate(parts):
            is_leaf = i == len(parts) - 1
            if part not in node:
                node[part] = {"__stream__": None, "__children__": {}}
            if is_leaf:
                node[part]["__stream__"] = path
            node = node[part]["__children__"]
    return root


def _pad(data: bytes, block: int) -> bytes:
    if len(data) % block == 0:
        return data
    return data + b"\x00" * (block - len(data) % block)


def write_cfb(streams: dict) -> bytes:
    tree = _build_tree(sorted(streams.keys()))

    entries = []

    def add_node(name, node, is_root=False):
        idx = len(entries)
        entry = {
            "name": "Root Entry" if is_root else name,
            "is_storage": node["__stream__"] is None,
            "is_root": is_root,
            "stream": node["__stream__"],
            "children": [],
        }
        entries.append(entry)
        for child_name in sorted(node["__children__"].keys()):
            child_idx = add_node(child_name, node["__children__"][child_name])
            entry["children"].append(child_idx)
        return idx

    add_node(None, {"__stream__": None, "__children__": tree}, is_root=True)

    for entry in entries:
        children = entry["children"]
        entry["child"] = children[0] if children else NOSTREAM
        for i, c in enumerate(children):
            entries[c]["left"] = NOSTREAM
            entries[c]["right"] = children[i + 1] if i + 1 < len(children) else NOSTREAM

    entries[0].setdefault("left", NOSTREAM)
    entries[0].setdefault("right", NOSTREAM)

    # ---- 1. 스트림을 "일반 FAT 사용(big)" / "미니스트림 사용(small)"으로 분류 ----
    minifat = []  # 미니섹터 인덱스 -> 다음 미니섹터 (또는 ENDOFCHAIN)
    mini_stream_chunks = []  # 64바이트 배수로 정렬된 미니스트림 원본 바이트 조각들

    def alloc_mini_stream(data: bytes):
        n = (len(data) + MINI_SECTOR_SIZE - 1) // MINI_SECTOR_SIZE
        start = len(minifat)
        padded = _pad(data, MINI_SECTOR_SIZE)
        mini_stream_chunks.append(padded)
        for i in range(n):
            minifat.append(ENDOFCHAIN if i == n - 1 else start + i + 1)
        return start

    sector_data = []
    fat = []

    def alloc_regular(data: bytes):
        n = (len(data) + SECTOR_SIZE - 1) // SECTOR_SIZE
        start = len(sector_data)
        padded = _pad(data, SECTOR_SIZE)
        for i in range(n):
            sector_data.append(padded[i * SECTOR_SIZE:(i + 1) * SECTOR_SIZE])
            fat.append(ENDOFCHAIN if i == n - 1 else start + i + 1)
        return start

    for entry in entries:
        if entry["stream"] is None:
            entry["start"] = 0
            entry["size"] = 0
            continue
        data = streams[entry["stream"]]
        size = len(data)
        if size == 0:
            entry["start"] = ENDOFCHAIN
            entry["size"] = 0
        elif size < MINI_STREAM_CUTOFF:
            entry["start"] = alloc_mini_stream(data)
            entry["size"] = size
        else:
            entry["start"] = alloc_regular(data)
            entry["size"] = size

    # ---- 2. 미니스트림 본체를 일반 FAT 섹터에 배치하고 Root Entry에 기록 ----
    mini_stream_data = b"".join(mini_stream_chunks)
    if mini_stream_data:
        root_mini_start = alloc_regular(mini_stream_data)
        entries[0]["start"] = root_mini_start
        entries[0]["size"] = len(mini_stream_data)
    else:
        entries[0]["start"] = ENDOFCHAIN
        entries[0]["size"] = 0

    # ---- 3. 디렉터리 섹터 구성 ----
    dir_entries_per_sector = SECTOR_SIZE // 128
    num_dir_sectors = (len(entries) + dir_entries_per_sector - 1) // dir_entries_per_sector
    total_dir_slots = num_dir_sectors * dir_entries_per_sector
    dir_start = len(sector_data)
    for i in range(num_dir_sectors):
        fat.append(ENDOFCHAIN if i == num_dir_sectors - 1 else dir_start + i + 1)
        sector_data.append(None)

    def pack_entry(entry):
        name = entry["name"]
        name_utf16 = name.encode("utf-16-le") + b"\x00\x00"
        if len(name_utf16) > 64:
            raise ValueError(f"디렉터리 이름이 너무 깁니다: {name}")
        name_field = name_utf16 + b"\x00" * (64 - len(name_utf16))
        name_len = len(name_utf16)
        obj_type = 5 if entry.get("is_root") else (1 if entry["is_storage"] else 2)
        color = 1
        left = entry.get("left", NOSTREAM)
        right = entry.get("right", NOSTREAM)
        child = entry.get("child", NOSTREAM)
        clsid = b"\x00" * 16
        return struct.pack(
            "<64sHBBIII16sIQQIQ",
            name_field, name_len, obj_type, color,
            left, right, child, clsid, 0,
            0, 0, entry["start"], entry["size"],
        )

    dir_bytes = b"".join(pack_entry(e) for e in entries)
    dir_bytes += b"\x00" * (128 * (total_dir_slots - len(entries)))
    for i in range(num_dir_sectors):
        sector_data[dir_start + i] = dir_bytes[i * SECTOR_SIZE:(i + 1) * SECTOR_SIZE]

    # ---- 4. 미니FAT을 일반 FAT 섹터에 배치 ----
    minifat_start = ENDOFCHAIN
    num_minifat_sectors = 0
    if minifat:
        entries_per_sector = SECTOR_SIZE // 4
        num_minifat_sectors = (len(minifat) + entries_per_sector - 1) // entries_per_sector
        padded_minifat = minifat + [FREESECT] * (
            num_minifat_sectors * entries_per_sector - len(minifat)
        )
        minifat_bytes = struct.pack(f"<{len(padded_minifat)}I", *padded_minifat)
        minifat_start = alloc_regular(minifat_bytes)

    # ---- 5. 일반 FAT 섹터 배치(자기 자신도 섹터를 차지하므로 고정점 반복) ----
    def compute_fat_sector_count(n):
        per = SECTOR_SIZE // 4
        return (n + per - 1) // per

    num_fat_sectors = 1
    while True:
        total = len(sector_data) + num_fat_sectors
        needed = compute_fat_sector_count(total)
        if needed == num_fat_sectors:
            break
        num_fat_sectors = needed
        if num_fat_sectors > 109:
            raise ValueError("파일이 너무 커서 이 병합 기능의 처리 한도를 초과했습니다.")

    fat_start = len(sector_data)
    for i in range(num_fat_sectors):
        fat.append(FATSECT)
        sector_data.append(None)

    entries_per_fat_sector = SECTOR_SIZE // 4
    fat_padded = fat + [FREESECT] * (num_fat_sectors * entries_per_fat_sector - len(fat))
    for i in range(num_fat_sectors):
        chunk = fat_padded[i * entries_per_fat_sector:(i + 1) * entries_per_fat_sector]
        sector_data[fat_start + i] = struct.pack(f"<{entries_per_fat_sector}I", *chunk)

    # ---- 6. 헤더 ----
    header = bytearray(512)
    header[0:8] = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"
    struct.pack_into("<H", header, 24, 0x003E)
    struct.pack_into("<H", header, 26, 0x0003)
    struct.pack_into("<H", header, 28, 0xFFFE)
    struct.pack_into("<H", header, 30, 9)
    struct.pack_into("<H", header, 32, 6)
    struct.pack_into("<I", header, 40, 0)
    struct.pack_into("<I", header, 44, num_fat_sectors)
    struct.pack_into("<I", header, 48, dir_start)
    struct.pack_into("<I", header, 52, 0)
    struct.pack_into("<I", header, 56, MINI_STREAM_CUTOFF)
    struct.pack_into("<I", header, 60, minifat_start)
    struct.pack_into("<I", header, 64, num_minifat_sectors)
    struct.pack_into("<I", header, 68, ENDOFCHAIN)
    struct.pack_into("<I", header, 72, 0)
    difat = [FREESECT] * 109
    for i in range(num_fat_sectors):
        difat[i] = fat_start + i
    struct.pack_into("<109I", header, 76, *difat)

    out = bytes(header)
    for sec in sector_data:
        assert sec is not None and len(sec) == SECTOR_SIZE
        out += sec
    return out


# ---------------------------------------------------------------------------
# HWP5 BodyText 섹션 병합. 방식: 첫 번째 파일의 컨테이너(스타일/폰트 등
# DocInfo, BinData, 기타 메타 스트림)를 그대로 base로 삼고, 이후 파일들의
# BodyText/SectionN 스트림만 새 섹션 번호로 이어 붙인 뒤, DocInfo의
# DocumentProperties 레코드에 있는 섹션 개수를 그만큼 늘려 패치합니다.
# ---------------------------------------------------------------------------
HWPTAG_DOCUMENT_PROPERTIES = 0x10


class HwpMergeError(Exception):
    pass


def _read_streams(data: bytes) -> dict:
    try:
        ole = olefile.OleFileIO(io.BytesIO(data))
    except Exception as exc:  # noqa: BLE001
        raise HwpMergeError(f"유효한 HWP(OLE) 파일이 아닙니다: {exc}") from exc
    streams = {}
    for entry in ole.listdir(streams=True, storages=False):
        path = "/".join(entry)
        with ole.openstream(entry) as f:
            streams[path] = f.read()
    ole.close()
    return streams


def _is_compressed(file_header: bytes) -> bool:
    if len(file_header) < 40:
        raise HwpMergeError("FileHeader 스트림이 손상되었습니다.")
    flags = struct.unpack_from("<I", file_header, 36)[0]
    return bool(flags & 0x1)


def _inflate(data: bytes) -> bytes:
    return zlib.decompress(data, -15)


def _deflate(data: bytes) -> bytes:
    co = zlib.compressobj(zlib.Z_DEFAULT_COMPRESSION, zlib.DEFLATED, -15)
    return co.compress(data) + co.flush()


def _patch_section_count(docinfo_plain: bytes, delta: int) -> bytes:
    """DocInfo 스트림(압축 해제됨)의 첫 레코드(DocumentProperties)에서
    섹션 개수 필드(레코드 payload의 첫 2바이트)를 delta만큼 늘립니다."""
    if len(docinfo_plain) < 4:
        raise HwpMergeError("DocInfo 스트림이 손상되었습니다.")
    header_val = struct.unpack_from("<I", docinfo_plain, 0)[0]
    tag_id = header_val & 0x3FF
    size = (header_val >> 20) & 0xFFF
    header_len = 4
    if size == 0xFFF:
        size = struct.unpack_from("<I", docinfo_plain, 4)[0]
        header_len = 8
    if tag_id != HWPTAG_DOCUMENT_PROPERTIES:
        raise HwpMergeError(
            "DocInfo의 첫 레코드가 DocumentProperties가 아닙니다 "
            f"(tag={tag_id}). 지원하지 않는 HWP 파일 구조일 수 있습니다."
        )
    if size < 2:
        raise HwpMergeError("DocumentProperties 레코드 길이가 비정상입니다.")
    payload_offset = header_len
    old_count = struct.unpack_from("<H", docinfo_plain, payload_offset)[0]
    new_count = old_count + delta
    if new_count > 0xFFFF:
        raise HwpMergeError("병합 후 섹션 수가 너무 많습니다.")
    patched = bytearray(docinfo_plain)
    struct.pack_into("<H", patched, payload_offset, new_count)
    return bytes(patched)


def merge_hwp_files(file_buffers):
    """file_buffers: HWP 파일 바이트 문자열들의 리스트(제출 순서).
    반환값: 병합된 HWP 파일 바이트열."""
    if not file_buffers:
        raise HwpMergeError("병합할 파일이 없습니다.")
    if len(file_buffers) == 1:
        return file_buffers[0]

    base_streams = _read_streams(file_buffers[0])
    base_header = base_streams.get("FileHeader")
    if base_header is None:
        raise HwpMergeError("첫 번째 파일에 FileHeader가 없습니다.")
    base_compressed = _is_compressed(base_header)

    section_numbers = [
        int(p[len("BodyText/Section"):])
        for p in base_streams
        if p.startswith("BodyText/Section")
    ]
    if not section_numbers:
        raise HwpMergeError("첫 번째 파일에서 BodyText 섹션을 찾지 못했습니다.")
    next_section = max(section_numbers) + 1
    appended = 0

    for idx, buf in enumerate(file_buffers[1:], start=2):
        streams = _read_streams(buf)
        header = streams.get("FileHeader")
        if header is None:
            raise HwpMergeError(f"{idx}번째 파일에 FileHeader가 없습니다.")
        compressed = _is_compressed(header)
        sec_nums = sorted(
            int(p[len("BodyText/Section"):])
            for p in streams
            if p.startswith("BodyText/Section")
        )
        if not sec_nums:
            raise HwpMergeError(f"{idx}번째 파일에서 BodyText 섹션을 찾지 못했습니다.")
        for n in sec_nums:
            data = streams[f"BodyText/Section{n}"]
            if compressed != base_compressed:
                raw = _inflate(data) if compressed else data
                data = _deflate(raw) if base_compressed else raw
            base_streams[f"BodyText/Section{next_section}"] = data
            next_section += 1
            appended += 1

    docinfo = base_streams.get("DocInfo")
    if docinfo is None:
        raise HwpMergeError("첫 번째 파일에 DocInfo가 없습니다.")
    raw_docinfo = _inflate(docinfo) if base_compressed else docinfo
    patched = _patch_section_count(raw_docinfo, appended)
    base_streams["DocInfo"] = _deflate(patched) if base_compressed else patched

    return write_cfb(base_streams)


# ---------------------------------------------------------------------------
# Vercel 함수 진입점
# ---------------------------------------------------------------------------
def _download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=25) as resp:
        return resp.read()


def _upload(url: str, data: bytes) -> None:
    request = urllib.request.Request(url, data=data, method="PUT")
    with urllib.request.urlopen(request, timeout=25) as resp:
        if resp.status not in (200, 201, 204):
            raise RuntimeError(f"업로드 응답이 비정상입니다 (HTTP {resp.status}).")


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, obj: dict):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw_body)
        except Exception:
            self._send_json(400, {"error": "요청 본문을 파싱하지 못했습니다."})
            return

        urls = payload.get("urls")
        upload_url = payload.get("uploadUrl")
        if not isinstance(urls, list) or not urls:
            self._send_json(400, {"error": "urls 배열이 필요합니다."})
            return
        if not isinstance(upload_url, str) or not upload_url:
            self._send_json(400, {"error": "uploadUrl이 필요합니다."})
            return

        try:
            buffers = [_download(u) for u in urls]
        except Exception as exc:  # noqa: BLE001
            self._send_json(502, {"error": f"원본 파일을 내려받지 못했습니다: {exc}"})
            return

        try:
            merged = merge_hwp_files(buffers)
        except HwpMergeError as exc:
            self._send_json(400, {"error": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._send_json(500, {"error": f"HWP 병합 중 알 수 없는 오류: {exc}"})
            return

        try:
            _upload(upload_url, merged)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._send_json(502, {"error": f"병합 결과 업로드에 실패했습니다: {exc}"})
            return

        self._send_json(200, {"ok": True})
