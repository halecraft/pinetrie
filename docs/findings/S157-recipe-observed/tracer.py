"""Run a command under strace and return the paths it read, wrote and deleted.

strace -ff writes one file per process, so no line is split between processes.
A child's working directory is its parent's at the clone, so the tree of
processes is replayed from the root down. Disposable.
"""

import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

CALLS = "openat,open,creat,rename,renameat,renameat2,unlink,unlinkat,rmdir,mkdir,mkdirat,chdir,fchdir,clone,clone3,fork,vfork"
LINE = re.compile(r"^(\w+)\((.*)\)\s+=\s+(-?\d+|\?)")
STRING = re.compile(r'"((?:[^"\\]|\\.)*)"')
FD = re.compile(r"^(?:AT_FDCWD|\d+<([^>]*)>)")


def _resolve(cwd: str, dirfd: str | None, p: str) -> str:
    if p.startswith("/"):
        return os.path.normpath(p)
    base = dirfd if dirfd else cwd
    return os.path.normpath(os.path.join(base, p))


def _dirfd(arg: str) -> str | None:
    m = FD.match(arg.strip())
    return m.group(1) if m and m.group(1) else None


def _replay(files: dict[int, list[str]], root_pid: int, root_cwd: str):
    reads, writes, deletes, absent = set(), set(), set(), set()
    queue = [(root_pid, root_cwd)]
    seen = set()
    while queue:
        pid, cwd = queue.pop()
        if pid in seen or pid not in files:
            continue
        seen.add(pid)
        for line in files[pid]:
            m = LINE.match(line)
            if not m:
                continue
            call, args, ret = m.groups()
            ok = ret != "?" and int(ret) >= 0
            strs = [s.encode().decode("unicode_escape", errors="ignore") for s in STRING.findall(args)]
            parts = args.split(", ")
            if call in ("clone", "clone3", "fork", "vfork"):
                if ok:
                    queue.append((int(ret), cwd))
            elif call == "chdir" and ok and strs:
                cwd = _resolve(cwd, None, strs[0])
            elif call == "fchdir" and ok:
                d = _dirfd(parts[0])
                if d:
                    cwd = d
            elif call in ("openat", "open", "creat") and strs:
                d = _dirfd(parts[0]) if call == "openat" else None
                p = _resolve(cwd, d, strs[0])
                flags = args.split('", ', 1)[1] if '", ' in args else ""
                write = call == "creat" or any(f in flags for f in ("O_WRONLY", "O_RDWR", "O_CREAT"))
                if not ok:
                    if not write:
                        absent.add(p)
                elif write:
                    writes.add(p)
                elif "O_DIRECTORY" not in flags:
                    reads.add(p)
            elif call.startswith("rename") and ok and len(strs) >= 2:
                if call == "rename":
                    old, new = _resolve(cwd, None, strs[0]), _resolve(cwd, None, strs[1])
                else:
                    segs = re.split(r',\s*(?=(?:AT_FDCWD|\d+<))', args)
                    old = _resolve(cwd, _dirfd(segs[0]), strs[0])
                    new = _resolve(cwd, _dirfd(segs[1]) if len(segs) > 1 else None, strs[1])
                deletes.add(old)
                writes.add(new)
            elif call in ("unlink", "unlinkat", "rmdir") and ok and strs:
                d = _dirfd(parts[0]) if call == "unlinkat" else None
                deletes.add(_resolve(cwd, d, strs[0]))
            elif call in ("mkdir", "mkdirat") and ok and strs:
                d = _dirfd(parts[0]) if call == "mkdirat" else None
                writes.add(_resolve(cwd, d, strs[0]))
    return reads, writes, deletes, absent


def traced(cmd: str, cwd: Path, env: dict) -> dict:
    tmp = Path(tempfile.mkdtemp(prefix="trace-"))
    try:
        t0 = time.time()
        r = subprocess.run(
            ["strace", "-ff", "-qq", "-y", "--seccomp-bpf", "-s", "4096", "-e", f"trace={CALLS}", "-o", str(tmp / "t"), "sh", "-c", cmd],
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
        )
        secs = time.time() - t0
        files = {}
        for f in tmp.iterdir():
            files[int(f.name.split(".")[-1])] = f.read_text(errors="replace").splitlines()
        children = set()
        for lines in files.values():
            for line in lines:
                m = LINE.match(line)
                if m and m.group(1) in ("clone", "clone3", "fork", "vfork") and m.group(3).lstrip("-").isdigit():
                    children.add(int(m.group(3)))
        roots = [p for p in files if p not in children]
        reads, writes, deletes, absent = set(), set(), set(), set()
        for root in roots:
            a, b, c, d = _replay(files, root, str(cwd))
            reads |= a
            writes |= b
            deletes |= c
            absent |= d
        return {
            "exit": r.returncode,
            "seconds": round(secs, 1),
            "stderr": r.stderr[-600:],
            "processes": len(files),
            "reads": reads,
            "writes": writes,
            "deletes": deletes,
            "absent": absent,
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
