"""
최소 CFB(Compound File Binary) 라이터.
MS-CFB 스펙(512바이트 섹터, major version 3)을 따릅니다.
미니스트림 컷오프는 스펙상 고정값 4096이므로(olefile 등 리더가 이 값을
강제합니다), 4096바이트 미만 스트림은 미니스트림/미니FAT에, 그 이상은
일반 FAT 섹터에 배치합니다.
109개 FAT 섹터(최대 약 7MB 컨테이너)를 넘으면 명시적으로 에러를 냅니다.
"""
import struct

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
