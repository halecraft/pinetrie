#!/usr/bin/env python3
"""Probe B, part 2: large files, as one git blob or as content-defined chunks. Disposable.

    python3 large.py 1 4 16      # sizes in GB

For each size: write a file, hash it as a git blob (SHA-1, SHA-256) and as chunks.
Then, for each edit (append 1 MiB; overwrite 1 MiB in the middle; rewrite all of
it), keep a reflinked copy as the previous snapshot, edit, and name the file
again three ways:
- flat: hash the whole file again;
- chunked, from scratch: chunk and hash the whole file again;
- chunked, incremental: FIEMAP says which byte ranges no longer share extents
  with the snapshot; rechunk from the chunk before each until the boundaries
  meet the old ones, and hash only the new chunks.
The incremental chunk list is checked against the from-scratch one.
"""

import array
import fcntl
import hashlib
import json
import os
import struct
import subprocess
import sys
import time
from pathlib import Path

DIR = Path("/workspace/sandbox/probes/large")
CDC = "/workspace/sandbox/probes/cdc"
OUT = Path(__file__).resolve().parent
MiB = 1 << 20
FS_IOC_FIEMAP = 0xC020660B
FIEMAP_FLAG_SYNC = 0x1
FIEMAP_EXTENT_LAST = 0x1


def ms_since(t):
    return round((time.perf_counter() - t) * 1000, 1)


def flat(path: Path, algo: str) -> bytes:
    h = hashlib.new(algo)
    h.update(b"blob %d\0" % path.stat().st_size)
    with open(path, "rb", buffering=0) as f:
        while b := f.read(16 * MiB):
            h.update(b)
    return h.digest()


def chunk_hashes(f, ends: list[int], start: int) -> list[tuple[int, int, bytes]]:
    out = []
    pos = start
    for end in ends:
        f.seek(pos)
        out.append((pos, end, hashlib.sha256(f.read(end - pos)).digest()))
        pos = end
    return out


def chunk_all(path: Path) -> list[tuple[int, int, bytes]]:
    ends = [int(x) for x in subprocess.run([CDC, "chunk", str(path), "0"], capture_output=True, text=True, check=True).stdout.split()]
    with open(path, "rb") as f:
        return chunk_hashes(f, ends, 0)


def fiemap(path: Path) -> list[tuple[int, int, int]]:
    out = []
    start = 0
    with open(path, "rb") as f:
        while True:
            count = 512
            hdr = struct.pack("=QQIIII", start, 2**64 - 1, FIEMAP_FLAG_SYNC, 0, count, 0)
            buf = array.array("B", hdr + b"\0" * (56 * count))
            fcntl.ioctl(f.fileno(), FS_IOC_FIEMAP, buf, True)
            mapped = struct.unpack_from("=I", buf, 20)[0]
            last = False
            for i in range(mapped):
                logical, physical, length, _, _, flags = struct.unpack_from("=QQQQQI", buf, 32 + 56 * i)
                out.append((logical, physical, length))
                if flags & FIEMAP_EXTENT_LAST:
                    last = True
            if last or mapped == 0:
                return out
            start = out[-1][0] + out[-1][2]


def changed_ranges(now: list, before: list, size: int) -> list[tuple[int, int]]:
    """Byte ranges of the file whose extents the snapshot does not share."""
    ranges = []
    for lo, phys, length in now:
        hi = min(lo + length, size)
        pos = lo
        for blo, bphys, blen in before:
            bhi = blo + blen
            if bhi <= pos or blo >= hi:
                continue
            if blo > pos:
                ranges.append((pos, blo))
            seg_hi = min(hi, bhi)
            if phys - lo != bphys - blo:
                ranges.append((max(pos, blo), seg_hi))
            pos = seg_hi
            if pos >= hi:
                break
        if pos < hi:
            ranges.append((pos, hi))
    merged = []
    for a, b in sorted(ranges):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def chunk_incremental(path: Path, old: list, ranges: list[tuple[int, int]]) -> tuple[list, int]:
    """Rechunk only around the changed ranges; return the chunk list and the bytes hashed."""
    size = path.stat().st_size
    old_size = old[-1][1] if old else 0
    # The old last chunk ends at the old EOF, not at a content boundary.
    eof_cut = old_size if size != old_size else None
    old_ends = {e for _, e, _ in old if e != eof_cut}
    result = []
    hashed = 0
    pos = 0
    with open(path, "rb") as f:
        for lo, hi in ranges:
            if lo < pos:
                continue
            # Keep old chunks wholly before the change.
            keep = [c for c in old if c[0] >= pos and c[1] <= lo and c[1] != eof_cut]
            result.extend(keep)
            start = keep[-1][1] if keep else pos
            proc = subprocess.Popen([CDC, "chunk", str(path), str(start)], stdout=subprocess.PIPE, text=True)
            ends = []
            assert proc.stdout
            for line in proc.stdout:
                e = int(line)
                ends.append(e)
                if e >= hi and e in old_ends:
                    break
            proc.kill()
            proc.wait()
            new = chunk_hashes(f, ends, start)
            hashed += sum(b - a for a, b, _ in new)
            result.extend(new)
            pos = ends[-1] if ends else size
        result.extend(c for c in old if c[0] >= pos and c[1] <= size)
    return result, hashed


def edit(path: Path, kind: str, seed: int):
    size = path.stat().st_size
    if kind == "append":
        with open(path, "ab") as f:
            f.write(os.urandom(MiB))
    elif kind == "overwrite1MiBMiddle":
        fd = os.open(path, os.O_WRONLY)
        os.pwrite(fd, os.urandom(MiB), size // 2)
        os.fsync(fd)
        os.close(fd)
    elif kind == "rewriteSmallChange":
        # How an app that saves by rewriting behaves: the same content with a
        # small change, written to a new file and renamed over the old one.
        tmp = path.with_suffix(".tmp")
        subprocess.run(["cp", "--reflink=never", str(path), str(tmp)], check=True)
        fd = os.open(tmp, os.O_WRONLY)
        os.pwrite(fd, os.urandom(MiB), size // 3)
        os.fsync(fd)
        os.close(fd)
        os.replace(tmp, path)
    elif kind == "rewrite":
        tmp = path.with_suffix(".tmp")
        subprocess.run([CDC, "gen", str(tmp), str(size), str(seed)], check=True)
        os.replace(tmp, path)


KINDS = ("append", "overwrite1MiBMiddle", "rewriteSmallChange", "rewrite")


def run(gb: int):
    DIR.mkdir(parents=True, exist_ok=True)
    path = DIR / f"f{gb}.bin"
    size = gb << 30
    t = time.perf_counter()
    subprocess.run([CDC, "gen", str(path), str(size), str(gb)], check=True)
    row = {"GB": gb, "writeMs": ms_since(t)}
    for algo in ("sha1", "sha256"):
        t = time.perf_counter()
        flat(path, algo)
        row[f"flat{algo}Ms"] = ms_since(t)
    t = time.perf_counter()
    chunks = chunk_all(path)
    row["chunkAllMs"] = ms_since(t)
    row["chunks"] = len(chunks)
    row["edits"] = {}
    for n, kind in enumerate(KINDS):
        prev = DIR / f"f{gb}.prev"
        subprocess.run(["cp", "--reflink=always", str(path), str(prev)], check=True)
        edit(path, kind, 100 + n)
        e = {}
        t = time.perf_counter()
        flat(path, "sha1")
        e["flatSha1Ms"] = ms_since(t)
        t = time.perf_counter()
        before, now = fiemap(prev), fiemap(path)
        ranges = changed_ranges(now, before, path.stat().st_size)
        e["fiemapMs"] = ms_since(t)
        e["extentsBefore"], e["extentsNow"] = len(before), len(now)
        e["changedMB"] = round(sum(b - a for a, b in ranges) / 1e6, 2)
        t = time.perf_counter()
        inc, hashed = chunk_incremental(path, chunks, ranges)
        e["chunkIncrementalMs"] = ms_since(t)
        e["hashedMB"] = round(hashed / 1e6, 2)
        t = time.perf_counter()
        full = chunk_all(path)
        e["chunkAllMs"] = ms_since(t)
        e["incrementalEqualsFull"] = [c[2] for c in inc] == [c[2] for c in full]
        old_ids = {c[2] for c in chunks}
        e["newChunkMB"] = round(sum(b - a for a, b, h in full if h not in old_ids) / 1e6, 2)
        row["edits"][kind] = e
        print(gb, kind, e, flush=True)
        chunks = full
        prev.unlink()
    path.unlink()
    return row


if __name__ == "__main__":
    rows = [run(int(g)) for g in sys.argv[1:]]
    for r in rows:
        print({k: v for k, v in r.items() if k != "edits"})
    (OUT / f"results-large-{'-'.join(sys.argv[1:])}.json").write_text(json.dumps(rows, indent=1) + "\n")
