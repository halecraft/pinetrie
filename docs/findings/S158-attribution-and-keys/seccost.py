#!/usr/bin/env python3
"""S158, part 3: what seccomp user notification costs, and what it sees, against strace. Disposable.

    python3 seccost.py [task ...]

Each of S157's tasks runs from the same state three times: untraced, under strace
(tracer2), and under `seccall`. seccall's log gives reads (opens for reading of
files that exist), writes, and lookups of files that do not exist. Writes
results-seccost.json.
"""

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from keys import ENV, NM, CORPUS  # noqa: E402
from tracer2 import traced  # noqa: E402

SECCALL = "/workspace/sandbox/probes/seccall"
TASKS = {
    "pnpm install": ("pinetrie", NM, "pnpm install --frozen-lockfile"),
    "tsc": ("pinetrie", "true", "pnpm run typecheck"),
    "vite build": ("pinetrie", "rm -rf packages/web/dist", "pnpm run build"),
    "vitest": ("pinetrie", "true", "pnpm exec vitest run packages/rules packages/interface"),
    "cargo build": ("ripgrep", "cargo clean -q", "cargo build -q"),
    "uv sync": ("flask", "rm -rf .venv", "uv sync -q"),
    "pytest": ("flask", "true", "uv run pytest -q -x"),
}
O_ACCMODE, O_CREAT, O_DIRECTORY = 0o3, 0o100, 0o200000
LIMIT = 300  # seconds for any one command


def descendants(pid: int) -> list[int]:
    kids = {}
    for d in os.listdir("/proc"):
        if d.isdigit():
            try:
                ppid = int(open(f"/proc/{d}/stat").read().rsplit(")", 1)[1].split()[1])
            except OSError:
                continue
            kids.setdefault(ppid, []).append(int(d))
    out, todo = [], [pid]
    while todo:
        p = todo.pop()
        for c in kids.get(p, []):
            out.append(c)
            todo.append(c)
    return out


def describe(pids: list[int]) -> list[str]:
    out = []
    for p in pids:
        try:
            cmd = open(f"/proc/{p}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="replace")[:120]
            wchan = open(f"/proc/{p}/wchan").read()
            state = open(f"/proc/{p}/stat").read().rsplit(")", 1)[1].split()[0]
            out.append(f"{p} {state} {wchan} {cmd}")
        except OSError:
            pass
    return out


def supervised(cmd: str, root: Path, log: Path, done: Path) -> dict:
    """Run under seccall; the call ends when its shell does. Whatever it leaves running
    is listed, then killed, so that nothing outlives the measurement."""
    done.unlink(missing_ok=True)
    t = time.perf_counter()
    proc = subprocess.Popen([SECCALL, str(done), str(log), cmd], cwd=root, env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    while not done.exists() and time.perf_counter() - t < LIMIT:
        time.sleep(0.05)
    secs = time.perf_counter() - t
    finished = done.exists()
    time.sleep(1.0)
    left = descendants(proc.pid)
    lingering = describe(left)
    for p in left:
        try:
            os.kill(p, signal.SIGKILL)
        except OSError:
            pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    return {"seconds": round(secs, 2), "finished": finished, "exit": done.read_text().strip() if finished else None, "leftRunning": lingering}


def sec_sets(log: Path):
    reads, writes, absent, events = set(), set(), set(), 0
    for line in log.read_text(errors="replace").splitlines():
        parts = line.split(" ", 4)
        if len(parts) < 5:
            continue
        events += 1
        _, op, flags, exists, path = parts
        flags = int(flags, 16)
        paths = path.split("\t")
        if op == "open":
            if flags & O_ACCMODE or flags & O_CREAT:
                writes.add(paths[0])
            elif exists == "1" and not flags & O_DIRECTORY:
                reads.add(paths[0])
            elif exists == "0":
                absent.add(paths[0])
        elif op in ("stat", "access", "readlink") and exists == "0":
            absent.add(paths[0])
        elif op in ("rename", "link") and len(paths) == 2:
            writes.add(paths[1])
        elif op in ("mkdir", "symlink"):
            writes.add(paths[0])
    return reads, writes, absent, events


def run(task):
    repo, reset, cmd = TASKS[task]
    root = CORPUS / repo
    tracked = {str(root / p) for p in subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, text=True).stdout.split("\0") if p}
    sh = lambda c: subprocess.run(c, shell=True, cwd=root, env=ENV, capture_output=True, text=True, timeout=LIMIT)  # noqa: E731
    row = {"task": task, "opensOnly": "SECCALL_OPENS_ONLY" in os.environ}
    sh(reset)
    t = time.perf_counter()
    r = sh(cmd)
    row["untracedS"], row["exit"] = round(time.perf_counter() - t, 2), r.returncode
    sh(reset)
    s = traced(cmd, root, ENV)
    row["straceS"] = s["seconds"]
    sh(reset)
    log = Path("/tmp/seccost.log")
    sup = supervised(cmd, root, log, Path("/tmp/seccost.done"))
    row["seccompS"], row["seccompFinished"], row["seccompExit"], row["leftRunning"] = sup["seconds"], sup["finished"], sup["exit"], sup["leftRunning"]
    reads, writes, absent, events = sec_sets(log)
    row["seccompEvents"] = events
    truth = s["reads"] & tracked
    row["trackedReadsStrace"] = len(truth)
    row["trackedReadsSeccompRecall"] = round(len(truth & reads) / len(truth), 3) if truth else None
    inside = lambda ps: {p for p in ps if p.startswith(str(root) + "/") or p.startswith(ENV["HOME"] + "/")}  # noqa: E731
    sa, ca = inside(s["absent"]), inside(absent)
    row["lookupsStrace"], row["lookupsSeccomp"] = len(sa), len(ca)
    row["lookupsStraceSeenBySeccomp"] = round(len(sa & ca) / len(sa), 3) if sa else None
    row["lookupsMissedSample"] = sorted(sa - ca)[:8]
    print(json.dumps(row), flush=True)
    return row


if __name__ == "__main__":
    out = HERE / ("results-seccost-opens-only.json" if "SECCALL_OPENS_ONLY" in os.environ else "results-seccost.json")
    rows = json.loads(out.read_text()) if out.exists() else {}
    for t in sys.argv[1:] or TASKS:
        rows[t] = run(t)
        out.write_text(json.dumps(rows, indent=1) + "\n")
