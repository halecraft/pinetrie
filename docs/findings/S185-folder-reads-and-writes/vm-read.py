#!/usr/bin/env python3
"""S185's VM half: reading a folder on the Mac into a btrfs disk, through the
read-only virtiofs share every lane has. Run in a lane on the Mac:
    python3 vm-read.py <share> <btrfs scratch dir>
    python3 vm-read.py --torn <dir in the share> [seconds]   (question 2)
It never writes to <share>. `.git` and `.jj` are skipped, as a folder
project's read would skip them. Prints JSON."""
import json, os, shutil, subprocess, sys, time

if sys.argv[1] == "--torn":
    # Question 2: while `mac-write.mjs torn <dir>` rewrites files on the Mac in
    # place (same size, one byte value per rewrite), read each with its stamp
    # before and after. Equal stamps around mixed bytes is a torn read nobody saw.
    d, seconds = sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 60
    end = time.time() + seconds
    reads = changed = clean = torn = 0
    while time.time() < end:
        for name in sorted(os.listdir(d)):
            p = os.path.join(d, name)
            a = os.lstat(p); data = open(p, "rb").read(); b = os.lstat(p)
            reads += 1
            if (a.st_size, a.st_ctime_ns) != (b.st_size, b.st_ctime_ns):
                changed += 1
            elif len(set(data)) > 1:
                torn += 1
            else:
                clean += 1
    print(json.dumps({"reads": reads, "stampMoved": changed, "clean": clean,
                      "tornWithEqualStamps": torn}))
    sys.exit(0)

share, scratch = sys.argv[1], sys.argv[2]
SKIP = {".git", ".jj"}

def walk(root):
    """Every file's stamp (size, ctime) and its parent directories, by lstat."""
    out, stack = {}, [""]
    while stack:
        rel = stack.pop()
        with os.scandir(os.path.join(root, rel)) as it:
            for e in it:
                p = f"{rel}/{e.name}" if rel else e.name
                if rel == "" and e.name in SKIP:
                    continue
                st = e.stat(follow_symlinks=False)
                if e.is_dir(follow_symlinks=False):
                    stack.append(p)
                else:
                    out[p] = (st.st_size, st.st_ctime_ns, e.is_symlink())
    return out

def timed(f):
    t = time.perf_counter(); v = f(); return v, round(time.perf_counter() - t, 3)

res = {}
first, res["statWalkFirstS"] = timed(lambda: walk(share))
_, res["statWalkAgainS"] = timed(lambda: walk(share))
res["files"] = len(first)
res["bytes"] = sum(s for s, _, l in first.values() if not l)

os.makedirs(scratch, exist_ok=True)
dest = os.path.join(scratch, "state")
if os.path.exists(dest):
    subprocess.run(["btrfs", "property", "set", dest, "ro", "false"], stderr=subprocess.DEVNULL)
    subprocess.run(["btrfs", "subvolume", "delete", dest], stdout=subprocess.DEVNULL)
subprocess.run(["btrfs", "subvolume", "create", dest], check=True, stdout=subprocess.DEVNULL)

def copy_all():
    for p, (_, _, link) in first.items():
        src, dst = os.path.join(share, p), os.path.join(dest, p)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if link:
            os.symlink(os.readlink(src), dst)
        else:
            shutil.copyfile(src, dst)
            os.chmod(dst, os.stat(src).st_mode & 0o777)
    os.sync()
_, res["fullCopyS"] = timed(copy_all)
res["fullCopyMBps"] = round(res["bytes"] / 1e6 / res["fullCopyS"], 1)

# A read that copies only what changed, found by the VM's own walk: nothing
# changed, so this is the walk alone.
again, res["vmFindsChangesS"] = timed(lambda: walk(share))
res["vmFoundChanged"] = sum(1 for p in again if again[p] != first.get(p))

# A read that is told which paths changed (by the Mac's scan): copy N files.
files = sorted((p for p, v in first.items() if not v[2]), key=lambda p: first[p][0])
small = files[: len(files) // 2]
for n in (1, 100, 1000):
    pick = small[:: max(1, len(small) // n)][:n]
    def told():
        for p in pick:
            src, dst = os.path.join(share, p), os.path.join(dest, p)
            before = os.lstat(src)
            shutil.copyfile(src, dst + ".tmp"); os.replace(dst + ".tmp", dst)
            after = os.lstat(src)
            assert (before.st_size, before.st_ctime_ns) == (after.st_size, after.st_ctime_ns)
    _, res[f"told{n}FilesS"] = timed(told)

big = files[-5:]
def bigcopy():
    for p in big:
        shutil.copyfile(os.path.join(share, p), os.path.join(dest, p) + ".big")
    os.sync()
_, s = timed(bigcopy)
bb = sum(first[p][0] for p in big)
res["largest5"] = {"bytes": bb, "s": s, "MBps": round(bb / 1e6 / s, 1)}
print(json.dumps(res, indent=1))
