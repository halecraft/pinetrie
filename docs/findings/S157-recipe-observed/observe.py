#!/usr/bin/env python3
"""Probe C, part 1: what a command read, seen four ways, against strace. Disposable.

    python3 observe.py [task ...]

For each task (a command and how to reset its state), run it four times from the
same state:
- untraced, for its time;
- under strace (S155's tracer): every file opened for reading, the ground truth;
- under fsatrace (LD_PRELOAD): cheap, but blind to static binaries;
- with two passive watchers at once:
  - inotify, IN_OPEN on every directory of the project;
  - atime: every project file's atime set back before the run (relatime
    then updates it on the first read), and compared after.
Each method's reads are compared with strace's, for the project's tracked files
and for all its files. Writes results-observe.json.
"""

import ctypes
import json
import os
import select
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from tracer import traced  # noqa: E402

PROBES = Path("/workspace/sandbox/probes")
CORPUS = PROBES / "corpus"
HOME = PROBES / "home"
FSATRACE = PROBES / "tools/fsatrace/fsatrace"
ENV = {**os.environ, "HOME": str(HOME), "PATH": f"{HOME}/.cargo/bin:{HOME}/.local/bin:{os.environ['PATH']}", "CI": "1"}

NM = "rm -rf node_modules packages/*/node_modules apps/*/node_modules"
TASKS = {
    "pnpm install": ("pinetrie", NM, "pnpm install --frozen-lockfile"),
    "tsc": ("pinetrie", "true", "pnpm run typecheck"),
    "vite build": ("pinetrie", "rm -rf packages/web/dist", "pnpm run build"),
    "vitest": ("pinetrie", "true", "pnpm exec vitest run packages/rules packages/interface"),
    "cargo build": ("ripgrep", "cargo clean -q", "cargo build -q"),
    "uv sync": ("flask", "rm -rf .venv", "uv sync -q"),
    "pytest": ("flask", "true", "uv run pytest -q -x"),
}

libc = ctypes.CDLL(None, use_errno=True)
IN_OPEN, IN_ISDIR, IN_Q_OVERFLOW = 0x20, 0x40000000, 0x4000


class Inotify:
    def __init__(self, root: Path):
        self.fd = libc.inotify_init1(os.O_NONBLOCK)
        self.dirs = {}
        for d, subdirs, _ in os.walk(root):
            subdirs[:] = [s for s in subdirs if not (d == str(root) and s == ".git")]
            wd = libc.inotify_add_watch(self.fd, d.encode(), IN_OPEN)
            if wd >= 0:
                self.dirs[wd] = d
        self.opened, self.overflows, self.stop = set(), 0, False
        self.thread = threading.Thread(target=self._read)
        self.thread.start()

    def _read(self):
        while True:
            r, _, _ = select.select([self.fd], [], [], 0.05)
            if not r:
                if self.stop:
                    return
                continue
            buf = os.read(self.fd, 1 << 20)
            i = 0
            while i < len(buf):
                wd, mask, _, n = struct.unpack_from("iIII", buf, i)
                name = buf[i + 16 : i + 16 + n].rstrip(b"\0").decode(errors="replace")
                i += 16 + n
                if mask & IN_Q_OVERFLOW:
                    self.overflows += 1
                elif not mask & IN_ISDIR and wd in self.dirs:
                    self.opened.add(os.path.join(self.dirs[wd], name))

    def close(self):
        time.sleep(0.2)
        self.stop = True
        self.thread.join()
        os.close(self.fd)


def project_files(root: Path):
    out = []
    for d, subdirs, files in os.walk(root):
        subdirs[:] = [s for s in subdirs if not (d == str(root) and s == ".git")]
        out.extend(os.path.join(d, f) for f in files)
    return out


def reset_atimes(files):
    for f in files:
        try:
            st = os.lstat(f)
            os.utime(f, ns=(1_000_000_000, st.st_mtime_ns), follow_symlinks=False)
        except OSError:
            pass


def atime_reads(files):
    out = set()
    for f in files:
        try:
            if os.lstat(f).st_atime_ns != 1_000_000_000:
                out.add(f)
        except OSError:
            pass
    return out


def sh(cmd, cwd):
    return subprocess.run(cmd, shell=True, cwd=cwd, env=ENV, capture_output=True, text=True)


def fsatrace_reads(cmd, cwd):
    out = Path("/tmp/fsa.out")
    t = time.perf_counter()
    r = subprocess.run([str(FSATRACE), "r", str(out), "--", "sh", "-c", cmd], cwd=cwd, env=ENV, capture_output=True, text=True)
    secs = time.perf_counter() - t
    reads = {line[2:] for line in out.read_text(errors="replace").splitlines() if line.startswith("r|")}
    return reads, secs, r.returncode


def compare(truth: set, seen: set, universe: set):
    t = truth & universe
    return {"strace": len(t), "seen": len(seen & universe), "recall": round(len(t & seen) / len(t), 3) if t else None, "extra": len((seen & universe) - t)}


def run(task: str):
    repo_name, reset, cmd = TASKS[task]
    root = CORPUS / repo_name
    tracked = {str(root / p) for p in subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, text=True).stdout.split("\0") if p}
    row = {"task": task, "command": cmd}

    sh(reset, root)
    t = time.perf_counter()
    r = sh(cmd, root)
    row["untracedS"] = round(time.perf_counter() - t, 2)
    row["exit"] = r.returncode

    sh(reset, root)
    s = traced(cmd, root, ENV)
    row["straceS"] = s["seconds"]
    truth = {p for p in s["reads"]}

    sh(reset, root)
    fsa, secs, code = fsatrace_reads(cmd, root)
    row["fsatraceS"] = round(secs, 2)
    row["fsatraceExit"] = code

    sh(reset, root)
    files = project_files(root)
    t = time.perf_counter()
    reset_atimes(files)
    row["atimeResetS"] = round(time.perf_counter() - t, 2)
    t = time.perf_counter()
    ino = Inotify(root)
    row["inotifySetupS"] = round(time.perf_counter() - t, 2)
    row["inotifyWatches"] = len(ino.dirs)
    t = time.perf_counter()
    sh(cmd, root)
    row["watchedS"] = round(time.perf_counter() - t, 2)
    ino.close()
    row["inotifyOverflows"] = ino.overflows
    at = atime_reads(files)

    universe_all = set(files) | truth & {p for p in truth if p.startswith(str(root) + "/")}
    for name, seen in (("fsatrace", fsa), ("inotify", ino.opened), ("atime", at)):
        row[name] = {"tracked": compare(truth, seen, tracked), "allProjectFiles": compare(truth, seen, universe_all)}
    missed = sorted(p[len(str(root)) + 1 :] for p in (truth & tracked) - fsa)
    row["fsatraceMissedTracked"] = missed[:12]
    print(json.dumps(row))
    return row


if __name__ == "__main__":
    tasks = sys.argv[1:] or list(TASKS)
    rows = [run(t) for t in tasks]
    (HERE / "results-observe.json").write_text(json.dumps(rows, indent=1) + "\n")
