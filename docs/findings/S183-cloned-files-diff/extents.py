#!/usr/bin/env python3
"""Two files' extents by FIEMAP: equal physical extents mean equal content,
with nothing read. Then the same answer by reading both. Prints JSON."""
import fcntl, json, struct, sys, time

FS_IOC_FIEMAP = 0xC020660B
def extents(path):
    with open(path, "rb") as f:
        count = 4096
        buf = bytearray(struct.pack("<QQIIII", 0, 0xFFFFFFFFFFFFFFFF, 1, 0, count, 0) + b"\0" * 56 * count)
        fcntl.ioctl(f.fileno(), FS_IOC_FIEMAP, buf)
        mapped = struct.unpack_from("<I", buf, 20)[0]
        return [struct.unpack_from("<QQQ", buf, 32 + 56 * i) + struct.unpack_from("<I", buf, 32 + 56 * i + 40) for i in range(mapped)]

def read_equal(a, b):
    with open(a, "rb") as fa, open(b, "rb") as fb:
        while True:
            x, y = fa.read(1 << 20), fb.read(1 << 20)
            if x != y: return False
            if not x: return True

a, b = sys.argv[1], sys.argv[2]
t = time.perf_counter(); ea, eb = extents(a), extents(b); t1 = time.perf_counter()
INLINE = 0x200  # FIEMAP_EXTENT_DATA_INLINE: in metadata, its "physical" address means nothing
inline = any(e[3] & INLINE for e in ea + eb)
same_extents = (not inline) and len(ea) > 0 and [e[:3] for e in ea] == [e[:3] for e in eb]
t2 = time.perf_counter(); eq = read_equal(a, b); t3 = time.perf_counter()
print(json.dumps({"a": a, "b": b, "extents": len(ea), "inline": inline, "sameExtents": same_extents,
                  "fiemapMs": round((t1 - t) * 1000, 3), "equalByReading": eq,
                  "readMs": round((t3 - t2) * 1000, 1)}))
