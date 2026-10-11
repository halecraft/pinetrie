#!/usr/bin/env python3
"""S158, part 1: which tool call wrote each file, three ways, against a known answer. Disposable.

    python3 scenario.py

A folder with no VCS. A tool writes notes and scripts; then tool calls run, some
in parallel and one leaving a daemon behind. Each call runs under `call` (a child
subreaper), with:
- strace -ff around it: every process the call started, daemons included, so
  its reads and writes by process tree. That is what fanotify with a subreaper
  would report, and it stands in for it here.
- fsatrace inside it (LD_PRELOAD): the call's processes that keep the variable.
- one inotify watcher on the whole folder, which attributes by when each call ran.
Each method's attribution is put through S155's rule, with anything unattributed
or claimed by a call that says source treated as source. The result is scored
against the known class of every file the calls wrote:
- loss: source called derived;
- noise: derived called source.
Writes results-scenario.json.
"""

import ctypes
import json
import os
import select
import shlex
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from tracer2 import parse, strace_argv  # noqa: E402

PROBES = Path("/workspace/sandbox/probes")
ROOT = PROBES / "c2"
CALL = PROBES / "call"
SECCALL = str(PROBES / "seccall")
FSATRACE = PROBES / "tools/fsatrace/fsatrace"
NODE = shutil.which("node")
ENV = {**os.environ, "HOME": str(PROBES / "home"), "CI": "1"}

FILES = {
    "notes/a.md": "# A\n\nfoo\n",
    "notes/b.md": "# B\n\nfoo too\n",
    "src/app.js": "import { lib } from './lib.js'\nconsole.log(lib())\n",
    "src/lib.js": "export const lib = () => 'lib'\n",
    "package.json": '{"name":"c2","private":true,"type":"module","dependencies":{"esbuild":"0.25.12"}}\n',
    "build.mjs": """import fs from "node:fs"
const names = fs.readdirSync("notes").filter(n => n.endsWith(".md"))
const texts = names.map(n => [n, fs.readFileSync(`notes/${n}`, "utf8")])
await new Promise(r => setTimeout(r, 1000))
fs.mkdirSync("site", { recursive: true })
for (const [n, t] of texts) fs.writeFileSync(`site/${n.replace(".md", ".html")}`, `<pre>${t}</pre>`)
""",
    "build2.mjs": """import fs from "node:fs"
fs.mkdirSync("site2", { recursive: true })
for (const n of fs.readdirSync("notes")) fs.writeFileSync(`site2/${n}.html`, fs.readFileSync(`notes/${n}`, "utf8"))
""",
    "watcher.mjs": """import fs from "node:fs"
import net from "node:net"
fs.mkdirSync(".cache", { recursive: true })
setInterval(() => {
  const all = fs.readdirSync("notes").map(n => fs.readFileSync(`notes/${n}`, "utf8"))
  fs.writeFileSync(".cache/watch.json", JSON.stringify(all))
}, 300)
try { fs.unlinkSync("/tmp/c2.sock") } catch {}
net.createServer(s => {
  fs.mkdirSync("out", { recursive: true })
  fs.writeFileSync("out/ipc.html", fs.readFileSync("notes/b.md", "utf8"))
  s.end("done")
}).listen("/tmp/c2.sock")
""",
    "client.mjs": """import net from "node:net"
const s = net.connect("/tmp/c2.sock")
s.on("data", () => s.end())
""",
    "mm.py": """import mmap, os
data = open("notes/b.md", "rb").read()
os.makedirs("out", exist_ok=True)
fd = os.open("out/mm.bin", os.O_RDWR | os.O_CREAT, 0o644)
os.ftruncate(fd, 4096)
m = mmap.mmap(fd, 4096)
m[: len(data)] = data
m.flush(); m.close(); os.close(fd)
""",
}

# (id, command, start after the previous call's start (s), wait for it)
CALLS = [
    ("T0 npm install", "npm install --no-audit --no-fund --loglevel=error", 0, True),
    ("T2 build (slow)", "node build.mjs", 0, False),
    ("T1 cat > notes/c.md", "sleep 0.4; printf '# C\\n' > notes/c.md", 0, True),
    ("T3 start daemon", "setsid nohup node watcher.mjs >/dev/null 2>&1 &", 1.5, True),
    ("T4 sd edits a note", "sleep 0.5; sd foo bar notes/a.md", 0, True),
    ("T5 esbuild (static)", "node_modules/.bin/esbuild src/app.js --bundle --log-level=error --outfile=dist/app.js", 0, True),
    ("T6 env -i node", f"env -i {NODE} build2.mjs", 0, True),
    ("T7 mmap writer", "python3 mm.py", 0, True),
    ("T8 client asks daemon", f"{NODE} client.mjs", 0, True),
]

EXPECTED = [
    ("node_modules/", "derived"),
    ("package-lock.json", "derived"),
    ("site/", "derived"),
    ("site2/", "derived"),
    ("dist/", "derived"),
    (".cache/", "derived"),
    ("out/", "derived"),
    ("notes/", "source"),
]

libc = ctypes.CDLL(None, use_errno=True)
IN_ACCESS, IN_MODIFY, IN_CLOSE_WRITE, IN_MOVED_TO, IN_CREATE, IN_ISDIR, IN_Q_OVERFLOW = 0x1, 0x2, 0x8, 0x80, 0x100, 0x40000000, 0x4000
MASK = IN_ACCESS | IN_MODIFY | IN_CLOSE_WRITE | IN_MOVED_TO | IN_CREATE


class Watcher:
    def __init__(self, root: Path):
        self.fd = libc.inotify_init1(os.O_NONBLOCK)
        self.dirs: dict[int, str] = {}
        self.events: list[tuple[float, str, str]] = []
        self.overflows = 0
        self.stop = False
        self._add_tree(str(root))
        self.thread = threading.Thread(target=self._run)
        self.thread.start()

    def _add_tree(self, top: str):
        for d, _, _ in os.walk(top):
            wd = libc.inotify_add_watch(self.fd, d.encode(), MASK)
            if wd >= 0:
                self.dirs[wd] = d

    def _run(self):
        while True:
            r, _, _ = select.select([self.fd], [], [], 0.05)
            if not r:
                if self.stop:
                    return
                continue
            buf = os.read(self.fd, 1 << 20)
            now = time.monotonic()
            i = 0
            while i < len(buf):
                wd, mask, _, n = struct.unpack_from("iIII", buf, i)
                name = buf[i + 16 : i + 16 + n].rstrip(b"\0").decode(errors="replace")
                i += 16 + n
                if mask & IN_Q_OVERFLOW:
                    self.overflows += 1
                    continue
                if wd not in self.dirs:
                    continue
                p = os.path.join(self.dirs[wd], name)
                if mask & IN_ISDIR:
                    if mask & (IN_CREATE | IN_MOVED_TO):
                        self._add_tree(p)
                    continue
                kind = "read" if mask & IN_ACCESS else "write"
                self.events.append((now, kind, p))

    def close(self):
        time.sleep(0.3)
        self.stop = True
        self.thread.join()
        os.close(self.fd)


def walk(root: Path) -> dict[str, tuple]:
    out = {}
    for d, _, files in os.walk(root):
        for f in files:
            p = os.path.join(d, f)
            st = os.lstat(p)
            out[os.path.relpath(p, root)] = (st.st_ino, st.st_size, st.st_mtime_ns)
    return out


def expected(p: str) -> str:
    for prefix, c in EXPECTED:
        if p == prefix or p.startswith(prefix):
            return c
    return "source"


def rel(paths) -> set[str]:
    r = str(ROOT) + "/"
    return {p[len(r) :] for p in paths if p.startswith(r)}


def fsatrace_log(path: Path) -> dict[str, set[str]]:
    out = {"reads": set(), "writes": set()}
    if not path.exists():
        return out
    for line in path.read_text(errors="replace").splitlines():
        parts = line.split("|")
        if parts[0] == "r":
            out["reads"].add(parts[1])
        elif parts[0] in ("w", "t"):
            out["writes"].add(parts[1])
        elif parts[0] == "m":
            out["writes"].add(parts[1])
    return out


def classify(order, attribution, initial, changed):
    """S155's rule, per method. attribution: call -> {reads, writes} (paths relative to ROOT)."""
    classes: dict[str, str] = {p: "source" for p in initial}
    existed = set(initial)
    result = {}
    for call in order:
        a = attribution.get(call, {"reads": set(), "writes": set()})
        written = a["writes"] & changed
        source_now = {p for p, c in classes.items() if c == "source"}
        for p in written:
            inputs = (a["reads"] & source_now) - {p}
            if p in existed and p in a["reads"]:
                c = "source"
            elif inputs:
                c = "derived"
            else:
                c = "source"
            prev = result.get(p)
            result[p] = "source" if "source" in (prev, c) else c
        for p in written:
            classes[p] = result[p]
            existed.add(p)
    for p in changed:
        result.setdefault(p, "source")  # unattributed
    return result


def main(mode: str):
    if ROOT.exists():
        shutil.rmtree(ROOT)
    for p, text in FILES.items():
        (ROOT / p).parent.mkdir(parents=True, exist_ok=True)
        (ROOT / p).write_text(text)
    initial = walk(ROOT)
    work = Path(tempfile.mkdtemp(prefix="c2-"))
    watcher = Watcher(ROOT)
    running = {}
    done_at: dict[str, float] = {}
    stop_poll = False

    def poll():
        while not stop_poll:
            for c, (_, _, t) in list(running.items()):
                if c not in done_at and (work / t / "done").exists():
                    done_at[c] = time.monotonic()
            time.sleep(0.01)

    poller = threading.Thread(target=poll)
    poller.start()
    for cid, cmd, delay, wait in CALLS:
        time.sleep(delay)
        tag = cid.split()[0]
        (work / tag / "strace").mkdir(parents=True)
        if mode == "seccomp":
            argv = [SECCALL, str(work / tag / "done"), str(work / tag / "sec.log"), cmd]
        elif mode == "preload":
            inner = f"{FSATRACE} rwmdt {work / tag / 'fsa.txt'} -- sh -c {shlex.quote(cmd)}"
            argv = [str(CALL), str(work / tag / "done"), inner]
        else:
            argv = [*strace_argv(str(work / tag / "strace" / "t")), str(CALL), str(work / tag / "done"), cmd]
        start = time.monotonic()
        proc = subprocess.Popen(argv, cwd=ROOT, env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        running[cid] = (proc, start, tag)
        if wait:
            while any(c not in done_at for c in running):
                time.sleep(0.02)
        print(f"{cid}: started", flush=True)
    while any(c not in done_at for c in running):
        time.sleep(0.02)
    stop_poll = True
    poller.join()
    windows = {c: (running[c][1], done_at[c]) for c in running}
    time.sleep(1.0)
    subprocess.run(["pkill", "-f", "^node watcher.mjs"])
    for proc, _, _ in running.values():
        try:
            proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            proc.kill()
    watcher.close()
    final = walk(ROOT)
    changed = {p for p in final if initial.get(p) != final[p]}

    order = [c for c, *_ in CALLS]
    by_tree, by_preload, by_window = {}, {}, {}
    for cid, (_, _, tag) in running.items():
        if mode == "seccomp":
            from seccost import sec_sets

            reads, writes, _, _ = sec_sets(work / tag / "sec.log")
            by_tree[cid] = {"reads": rel(reads), "writes": rel(writes)}
        elif mode == "tree":
            t = parse(work / tag / "strace", ROOT)
            by_tree[cid] = {"reads": rel(t["reads"]), "writes": rel(t["writes"])}
        else:
            f = fsatrace_log(work / tag / "fsa.txt")
            by_preload[cid] = {"reads": rel(f["reads"]), "writes": rel(f["writes"])}
    for cid, (s, e) in windows.items():
        ev = [(k, p) for t, k, p in watcher.events if s <= t <= e + 0.05]
        by_window[cid] = {"reads": rel(p for k, p in ev if k == "read"), "writes": rel(p for k, p in ev if k == "write")}

    report = {"mode": mode, "changedFiles": sorted(p for p in changed if not p.startswith("node_modules/")), "changedInNodeModules": sum(1 for p in changed if p.startswith("node_modules/")), "changedCount": len(changed), "inotifyOverflows": watcher.overflows, "windowsS": {c: [round(s - windows[order[0]][0], 2), round(e - windows[order[0]][0], 2)] for c, (s, e) in windows.items()}}
    methods = {"tree": (("processTree", by_tree), ("timeWindow", by_window)), "seccomp": (("seccomp", by_tree),), "preload": (("fsatrace", by_preload),)}[mode]
    for name, att in methods:
        got = classify(order, att, initial, changed)
        score = Counter()
        wrong = defaultdict(list)
        for p in changed:
            e, g = expected(p), got[p]
            if e == g:
                score["right"] += 1
            else:
                kind = "loss" if e == "source" else "noise"
                score[kind] += 1
                wrong[kind].append(p)
        claimed = Counter()
        for p in changed:
            who = [c for c in order if p in att.get(c, {"writes": set()})["writes"]]
            claimed["unattributed" if not who else ("several calls" if len(who) > 1 else "one call")] += 1
        report[name] = {
            "score": dict(score),
            "attribution": dict(claimed),
            "loss": sorted(wrong["loss"])[:20],
            "noise": sorted(p for p in wrong["noise"] if not p.startswith("node_modules/"))[:30],
            "noiseInNodeModules": sum(1 for p in wrong["noise"] if p.startswith("node_modules/")),
        }
        print(name, json.dumps(report[name]))
    att = by_preload if mode == "preload" else by_tree
    report["daemonWrites"] = sorted(att["T3 start daemon"]["writes"] & changed)
    print("daemon writes:", report["daemonWrites"])
    print("windows:", report["windowsS"])
    (HERE / f"results-scenario-{mode}.json").write_text(json.dumps(report, indent=1) + "\n")
    shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    for m in sys.argv[1:] or ["tree", "preload"]:
        main(m)
