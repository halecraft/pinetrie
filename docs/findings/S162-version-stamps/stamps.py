#!/usr/bin/env python3
"""S162: is (inode, size, ctime) a version stamp on the shared mount? Disposable.

    python3 stamps.py resolution forged mmap rename

Each test changes a file's content and checks that its stamp changed. A
"collision" is a change of content with an unchanged stamp. Writes
results-<step>.json beside this file. Every step stops after a time budget.
"""

import hashlib
import json
import mmap
import os
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRATCH = HERE / "scratch"
BUDGET = 120


def stamp(p):
    s = os.stat(p)
    return (s.st_ino, s.st_size, s.st_ctime_ns)


def full(p):
    s = os.stat(p)
    return {"ino": s.st_ino, "size": s.st_size, "ctime": s.st_ctime_ns, "mtime": s.st_mtime_ns}


def digest(p):
    return hashlib.sha1(Path(p).read_bytes()).hexdigest()


def resolution(pairs=2000):
    """Back-to-back same-size writes: in one process, and alternating between two."""
    f = SCRATCH / "res.txt"
    f.write_bytes(b"x" * 64)
    out = {}
    # One process.
    collisions = mtime_collisions = 0
    deltas = []
    end = time.monotonic() + BUDGET / 3
    prev = stamp(f)
    prev_m = os.stat(f).st_mtime_ns
    n = 0
    for i in range(pairs):
        if time.monotonic() > end:
            break
        with open(f, "r+b") as h:
            h.write(bytes([65 + i % 26]) * 64)
        s = stamp(f)
        m = os.stat(f).st_mtime_ns
        collisions += s == prev
        mtime_collisions += m == prev_m
        deltas.append(s[2] - prev[2])
        prev, prev_m = s, m
        n += 1
    deltas.sort()
    out["oneProcess"] = {"writes": n, "stampCollisions": collisions, "mtimeCollisions": mtime_collisions, "ctimeDeltaNs": {"min": deltas[0], "median": deltas[len(deltas) // 2]}}
    # Two processes, strictly alternating through pipes, each writing the same size.
    code = r"""
import os, sys
f, me, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
rd, wr = int(sys.argv[4]), int(sys.argv[5])
out = []
for i in range(n):
    os.read(rd, 1)
    with open(f, "r+b") as h:
        h.write((me * 64).encode())
    s = os.stat(f)
    out.append(f"{s.st_ino} {s.st_size} {s.st_ctime_ns}")
    os.write(wr, b"x")
print("\n".join(out))
"""
    a_r, b_w = os.pipe()
    b_r, a_w = os.pipe()
    n2 = pairs // 2
    pa = subprocess.Popen([sys.executable, "-c", code, str(f), "A", str(n2), str(a_r), str(a_w)], pass_fds=(a_r, a_w), stdout=subprocess.PIPE, text=True)
    pb = subprocess.Popen([sys.executable, "-c", code, str(f), "B", str(n2), str(b_r), str(b_w)], pass_fds=(b_r, b_w), stdout=subprocess.PIPE, text=True)
    os.write(b_w, b"x")  # A goes first
    oa, _ = pa.communicate(timeout=BUDGET)
    ob, _ = pb.communicate(timeout=BUDGET)
    seq = [x for pair in zip(oa.split(), ob.split()) for x in pair] if False else [x for pair in zip(oa.strip().split("\n"), ob.strip().split("\n")) for x in pair]
    coll = sum(1 for x, y in zip(seq, seq[1:]) if x == y)
    out["twoProcessesAlternating"] = {"writes": len(seq), "stampCollisions": coll}
    print("resolution", json.dumps(out))
    return out


def forged():
    """Rewrites at the same size that restore the old mtime."""
    out = {}
    d = SCRATCH / "forged"
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    f = d / "f.txt"

    def case(name, act):
        f.write_bytes(b"original content\n")
        time.sleep(0.01)
        before, h0 = full(f), digest(f)
        act()
        after, h1 = full(f), digest(f)
        out[name] = {
            "contentChanged": h0 != h1,
            "mtimeRestored": after["mtime"] == before["mtime"],
            "stampChanged": (after["ino"], after["size"], after["ctime"]) != (before["ino"], before["size"], before["ctime"]),
        }

    def utime_restore():
        m = os.stat(f).st_mtime_ns
        f.write_bytes(b"ORIGINAL CONTENT\n")
        os.utime(f, ns=(m, m))

    case("rewrite, then utime to the old mtime", utime_restore)

    def touch_r():
        ref = d / "ref.txt"
        ref.write_bytes(b"")
        os.utime(ref, ns=(os.stat(f).st_atime_ns, os.stat(f).st_mtime_ns))
        f.write_bytes(b"ORIGINAL CONTENT\n")
        subprocess.run(["touch", "-r", str(ref), str(f)], check=True, timeout=10)

    case("rewrite, then touch -r", touch_r)

    def cp_p():
        src = d / "src.txt"
        src.write_bytes(b"ORIGINAL CONTENT\n")
        os.utime(src, ns=(os.stat(f).st_atime_ns, os.stat(f).st_mtime_ns))
        subprocess.run(["cp", "-p", str(src), str(f)], check=True, timeout=10)

    case("cp -p over it, same size and mtime", cp_p)

    def tar_x():
        src = d / "t" / "f.txt"
        src.parent.mkdir(exist_ok=True)
        src.write_bytes(b"ORIGINAL CONTENT\n")
        os.utime(src, ns=(os.stat(f).st_atime_ns, os.stat(f).st_mtime_ns))
        tb = d / "t.tar"
        with tarfile.open(tb, "w") as t:
            t.add(src, arcname="f.txt")
        subprocess.run(["tar", "-xf", str(tb), "-C", str(d)], check=True, timeout=10)

    case("tar -x over it, same size and mtime", tar_x)
    print("forged", json.dumps(out))
    return out


def mmap_case():
    f = SCRATCH / "mm.bin"
    f.write_bytes(b"\0" * 4096)
    time.sleep(0.01)
    s0 = stamp(f)
    fd = os.open(f, os.O_RDWR)
    m = mmap.mmap(fd, 4096)
    m[:5] = b"hello"
    time.sleep(0.05)
    s_store = stamp(f)
    m.flush()
    s_msync = stamp(f)
    m[5:10] = b"world"
    m.close()
    os.close(fd)
    s_unmap = stamp(f)
    out = {
        "changedAfterStore": s_store != s0,
        "changedAfterMsync": s_msync != s0,
        "secondStoreThenUnmapWithoutMsyncChanged": s_unmap != s_msync,
        "contentOnDisk": Path(f).read_bytes()[:10].decode(),
    }
    print("mmap", json.dumps(out))
    return out


def rename():
    f = SCRATCH / "rn.txt"
    f.write_bytes(b"same size\n")
    s0 = stamp(f)
    tmp = SCRATCH / ".rn.tmp"
    tmp.write_bytes(b"SAME SIZE\n")
    os.rename(tmp, f)
    s1 = stamp(f)
    out = {"inodeChanged": s1[0] != s0[0], "ctimeChanged": s1[2] != s0[2], "stampChanged": s1 != s0}
    print("rename", json.dumps(out))
    return out


if __name__ == "__main__":
    SCRATCH.mkdir(parents=True, exist_ok=True)
    steps = {"resolution": resolution, "forged": forged, "mmap": mmap_case, "rename": rename}
    for s in sys.argv[1:]:
        r = steps[s]()
        (HERE / f"results-{s}.json").write_text(json.dumps(r, indent=1) + "\n")
