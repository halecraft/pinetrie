#!/usr/bin/env python3
"""S161 in a lane: a shared folder as a single line of states. Disposable.

    python3 probe.py observe concurrent views volume cost

- observe: does the supervisor see writes into the shared mount, and capture
  the version each one leaves?
- concurrent: two tool calls, each reading a shared file and then writing it, in
  100 rounds at random offsets. Captures are put on a line, as the host would
  put them, and checked against what each call wrote.
- views: the lane's read-write mount and the read-only mount of the working copy:
  one cache, or a lag between them?
- volume: how much the shared folder holds, and how recently it changed.
- cost: what capture mode adds to an open and close.
Every command runs under a time limit; the run stops after ten minutes.
Writes results-<step>.json beside this file.
"""

import json
import os
import random
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRATCH = HERE / "scratch"
BIN = Path("/workspace/sandbox/s161")
SHARED = Path("/workspace/.plans")
OTHER_VIEW = Path("/mnt/host-working-copy/.plans")
ENV = {**os.environ, "SECCALL_CAPTURE_ROOT": str(SCRATCH), "SECCALL_OPENS_ONLY": "1"}
LIMIT = 60
DEADLINE = time.monotonic() + 600


def fnv(b: bytes) -> str:
    x = 1469598103934665603
    for c in b:
        x = ((x ^ c) * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    return format(x, "x")


def call(cmd: str, log: Path, cwd: Path):
    done = log.with_suffix(".done")
    done.unlink(missing_ok=True)
    return subprocess.Popen([str(BIN / "seccall"), str(done), str(log), cmd], cwd=cwd, env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def finish(p: subprocess.Popen):
    try:
        p.wait(timeout=LIMIT)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait()
        raise


def captures(log: Path):
    out = []
    for line in log.read_text(errors="replace").splitlines():
        parts = line.split(" ")
        if len(parts) >= 6 and parts[1].startswith("capture-"):
            out.append({"pid": int(parts[0]), "kind": parts[1], "hash": parts[2], "size": int(parts[3]), "path": parts[4], "t": int(parts[5])})
    return out


def observe():
    d = SCRATCH / "observe"
    subprocess.run(["rm", "-rf", str(d)], check=True)
    d.mkdir(parents=True)
    log = BIN / "observe.log"
    script = r"""
printf 'one\n' > a.txt
echo two >> a.txt
mv a.txt b.txt
python3 -c "
import mmap,os
fd=os.open('c.bin',os.O_RDWR|os.O_CREAT,0o644); os.ftruncate(fd,4096); m=mmap.mmap(fd,4096); m[:5]=b'hello'; m.flush(); m.close(); os.close(fd)"
node -e "require('fs').writeFileSync('n.txt','from node\n')"
sd node NODE n.txt
cat b.txt > /dev/null
rm b.txt
mkdir sub
cd sub && printf 'relative\n' > r.txt
(sleep 0.3; echo late > ../late.txt) &
"""
    p = call(script, log, d)
    finish(p)
    lines = log.read_text().splitlines()
    under = [ln for ln in lines if str(d) in ln]
    ops = Counter(ln.split(" ")[1] for ln in under)
    caps = captures(log)
    last = {}
    for c in caps:
        if c["kind"] != "capture-open":
            last[c["path"]] = c["hash"]
    on_disk = {str(p): fnv(p.read_bytes()) for p in d.rglob("*") if p.is_file() and not p.is_symlink()}
    out = {
        "opsSeenUnderTheMount": dict(ops),
        "renameSeen": any(" rename " in ln and "b.txt" in ln for ln in under),
        "unlinkSeen": any(" unlink " in ln and "b.txt" in ln for ln in under),
        "relativePathResolved": any("sub/r.txt" in ln for ln in under),
        "lastCaptureEqualsDisk": {os.path.relpath(p, d): last.get(p) == h for p, h in on_disk.items()},
    }
    print("observe", json.dumps(out))
    return out


def concurrent(rounds=100):
    d = SCRATCH / "concurrent"
    subprocess.run(["rm", "-rf", str(d)], check=True)
    d.mkdir(parents=True)
    f = d / "shared.txt"
    rnd = random.Random(11)
    stats = Counter()
    examples = []
    for r in range(rounds):
        if time.monotonic() > DEADLINE:
            stats["stopped at the time budget"] = 1
            break
        f.write_text(f"base {r}\n")
        head = fnv(f.read_bytes())
        content = {"A": f"A wrote {r} {rnd.random()}", "B": f"B wrote {r} {rnd.random()}"}
        procs = {}
        for who, delay in (("A", 0.0), ("B", rnd.uniform(0, 0.12))):
            time.sleep(delay if who == "B" else 0)
            think = rnd.uniform(0, 0.06)
            cmd = f"cat shared.txt > /dev/null; sleep {think:.3f}; printf '%s\\n' '{content[who]}' > shared.txt"
            procs[who] = (call(cmd, BIN / f"c-{who}.log", d), think)
        for p, _ in procs.values():
            finish(p)
        events = []
        for who in ("A", "B"):
            for c in captures(BIN / f"c-{who}.log"):
                if c["path"] == str(f):
                    events.append({**c, "who": who})
        events.sort(key=lambda e: e["t"])
        # The host's line: a call's base is what it last read; a write is clean
        # if its base is the head, concurrent otherwise.
        base, wrote, flagged, attribution_ok = {}, {}, set(), True
        for e in events:
            if e["kind"] == "capture-open":
                base.setdefault(e["who"], e["hash"])
            elif e["size"] > 0:
                if base.get(e["who"]) != head:
                    flagged.add(e["who"])
                wrote[e["who"]] = (e["hash"], e["t"])
                head = e["hash"]
        for who in ("A", "B"):
            if wrote.get(who, (None,))[0] != fnv((content[who] + "\n").encode()):
                attribution_ok = False
        # The truth: did one call write after the other had written, from a base it read before that?
        reads = {who: min((e["t"] for e in events if e["who"] == who and e["kind"] == "capture-open"), default=None) for who in ("A", "B")}
        writes = {who: wrote[who][1] for who in wrote}
        lost = any(
            writes.get(x) and writes.get(y) and writes[x] < writes[y] and reads[y] is not None and reads[y] < writes[x]
            for x, y in (("A", "B"), ("B", "A"))
        )
        stats["rounds"] += 1
        stats["a write overwrote another it never read (truth)"] += lost
        stats["flagged concurrent by the line"] += bool(flagged)
        stats["truth and line agree"] += lost == bool(flagged)
        stats["each capture holds its own writer's content"] += attribution_ok
        if lost != bool(flagged) or not attribution_ok:
            examples.append({"round": r, "lost": lost, "flagged": sorted(flagged), "attributionOk": attribution_ok, "events": [(e["who"], e["kind"], e["size"]) for e in events]})
    out = {"stats": dict(stats), "mismatches": examples[:10]}
    print("concurrent", json.dumps(out["stats"]))
    return out


def views(trials=50):
    d = SCRATCH / "views"
    d.mkdir(parents=True, exist_ok=True)
    other = OTHER_VIEW / d.relative_to(SHARED)
    out = {"devSame": os.stat(SHARED).st_dev == os.stat(OTHER_VIEW).st_dev, "lagsMs": [], "newFileLagsMs": []}
    for i in range(trials):
        for kind in ("lagsMs", "newFileLagsMs"):
            name = "lag.txt" if kind == "lagsMs" else f"new-{i}.txt"
            data = f"{kind} {i} {time.time_ns()}\n"
            t = time.perf_counter()
            (d / name).write_text(data)
            seen = None
            while time.perf_counter() - t < 3:
                try:
                    if (other / name).read_text() == data:
                        seen = (time.perf_counter() - t) * 1000
                        break
                except OSError:
                    pass
            out[kind].append(round(seen, 3) if seen is not None else None)
    for kind in ("lagsMs", "newFileLagsMs"):
        v = sorted(x for x in out[kind] if x is not None)
        out[kind] = {"median": v[len(v) // 2] if v else None, "max": v[-1] if v else None, "neverSeen": out[kind].count(None)}
    print("views", json.dumps(out))
    return out


def volume():
    now = time.time()
    files = []
    for p in SHARED.rglob("*"):
        if p.is_file() and SCRATCH not in p.parents and HERE not in p.parents:
            st = p.stat()
            files.append((p, st.st_size, now - st.st_mtime))
    sizes = sorted(s for _, s, _ in files)
    tops = Counter(str(p.relative_to(SHARED)).split("/")[0] if "/" in str(p.relative_to(SHARED)) else "(top level)" for p, _, _ in files)
    out = {
        "files": len(files),
        "MB": round(sum(sizes) / 1e6, 2),
        "medianKB": round(sizes[len(sizes) // 2] / 1e3, 1) if sizes else 0,
        "largestMB": round(sizes[-1] / 1e6, 2) if sizes else 0,
        "changedInLastHour": sum(1 for *_, age in files if age < 3600),
        "changedInLastDay": sum(1 for *_, age in files if age < 86400),
        "changedInLastWeek": sum(1 for *_, age in files if age < 7 * 86400),
        "topFolders": dict(tops.most_common(8)),
    }
    print("volume", json.dumps(out))
    return out


def cost():
    inside = SCRATCH / "cost.txt"
    inside.write_text("x" * 4096)
    out = {}
    m = lambda n, path: [str(BIN / "seccall"), str(BIN / "m.done"), str(BIN / "m.log"), f"{BIN / 'micro'} {n} {path}"]  # noqa: E731
    # Opens of a file on the shared mount are slow in themselves (virtiofs), so
    # those runs are shorter.
    runs = {
        "plain, /etc/hostname": ([str(BIN / "micro"), "100000", "/etc/hostname"], {}),
        "plain, shared file": ([str(BIN / "micro"), "2000", str(inside)], {}),
        "opens only, /etc/hostname": (m(100000, "/etc/hostname"), {"SECCALL_CAPTURE_ROOT": None}),
        "capture mode, /etc/hostname": (m(100000, "/etc/hostname"), {}),
        "capture mode, shared file": (m(2000, inside), {}),
    }
    for name, (argv, extra) in runs.items():
        env = {**ENV}
        for k, v in extra.items():
            if v is None:
                env.pop(k, None)
        r = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=LIMIT, stdin=subprocess.DEVNULL)
        out[name] = r.stdout.strip()
    print("cost", json.dumps(out))
    return out


if __name__ == "__main__":
    for step in sys.argv[1:]:
        res = globals()[step]()
        (HERE / f"results-{step}.json").write_text(json.dumps(res, indent=1) + "\n")
