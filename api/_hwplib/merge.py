"""
HWP(한글, HWP5 바이너리 포맷) 파일 여러 개를 하나로 병합합니다.

방식: 첫 번째 파일의 컨테이너(스타일/폰트 등 DocInfo, BinData, 기타 메타
스트림)를 그대로 base로 삼고, 이후 파일들의 BodyText/SectionN 스트림만
새 섹션 번호로 이어 붙인 뒤, DocInfo의 DocumentProperties 레코드에 있는
섹션 개수를 그만큼 늘려 패치합니다.

주의(best-effort): 모든 입력 파일이 같은 양식(동일 스타일/폰트 테이블)에서
비롯된 경우에 안전합니다 - 이 앱에서는 담당자가 올린 "예시 양식"을 제출자들이
그대로 채워 제출하는 흐름이라 이 전제가 대체로 맞습니다. 서로 다른 스타일
체계를 가진 완전히 별개의 문서를 섞으면 섹션이 잘못된 스타일/문단모양을
참조해 한글에서 깨지거나 예상과 다르게 보일 수 있습니다.
"""
import io
import struct
import zlib

import olefile

from .cfb import write_cfb

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
