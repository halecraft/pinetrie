"""S172: checks the observer's events against what the workload did. Disposable.
   check.py <W> <events-main.tsv> [events-flood2.tsv]
Prints one line per check, PASS or FAIL with why, then the cost table."""
import statistics, sys
from collections import defaultdict

W, main = sys.argv[1], sys.argv[2]
flood2 = sys.argv[3] if len(sys.argv) > 3 else None
COLS = "kind run pid cgroup fid dev ino stamp flags fmode mnt cut path path2 ustamp lag".split()

def load(path):
    evs, lost, lost_run, meta = [], 0, {}, []
    for line in open(path, errors="replace"):
        line = line.rstrip("\n")
        if line.startswith("#lost total"): lost = int(line.split()[2])
        elif line.startswith("#lost run"):
            _, _, r, n = line.split(); lost_run[int(r)] = int(n)
        elif line.startswith("#"): meta.append(line)
        else:
            f = line.split("\t")
            if len(f) != len(COLS): continue
            e = dict(zip(COLS, f)); e["run"] = int(e["run"]); e["fmode"] = int(e["fmode"], 16)
            evs.append(e)
    return evs, lost, lost_run, meta

def expect(name):
    try: return open(f"{W}/expect/{name}").read().split("\n")
    except FileNotFoundError: return None

results = []
def check(name, ok, why=""):
    results.append((name, ok, why))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({why})" if why else ""), flush=True)

evs, lost, lost_run, meta = load(main)
print(f"# {len(evs)} events, {lost} lost; {' '.join(meta)}")
by_run = defaultdict(list)
for e in evs: by_run[e["run"]].append(e)
def has(run, kind, path, path2=None, write=None):
    for e in by_run[run]:
        if e["kind"] == kind and e["path"] == path and (path2 is None or e["path2"] == path2):
            if write is None or bool(e["fmode"] & 2) == write: return e
    return None
def release_of(run, path):
    o = [e for e in by_run[run] if e["kind"] == "open" and e["path"] == path and e["fmode"] & 2]
    if not o: return None
    fids = {e["fid"] for e in o}
    r = [e for e in by_run[run] if e["kind"] == "release" and e["fid"] in fids]
    return r[-1] if r else None
def stamp_expected(name, file):
    for l in expect(name) or []:
        if l.startswith(file + "\t"): return l.split("\t")[1]
    return None
end_index = {}
for i, e in enumerate(evs):
    if e["kind"] == "end": end_index[e["run"]] = i

# 1
x = expect("r1") or []
check("r1: the command's exit is its own", "exit 3" in x, x[0] if x else "no expect")
p = f"{W}/r1"
miss = [d for d, ok in [
    ("start", any(e["kind"] == "start" for e in by_run[1])),
    ("open a.txt for write", has(1, "open", f"{p}/a.txt", write=True)),
    ("mkdir d", has(1, "mkdir", f"{p}/d")),
    ("rename a.txt to d/b", has(1, "rename", f"{p}/a.txt", f"{p}/d/b")),
    ("symlink s", has(1, "symlink", f"{p}/s", "target")),
    ("link d/b to hard", has(1, "link", f"{p}/d/b", f"{p}/hard")),
    ("truncate or open d/b for write", has(1, "truncate", f"{p}/d/b") or has(1, "open", f"{p}/d/b", write=True)),
    ("unlink hard", has(1, "unlink", f"{p}/hard")),
    ("unlink d/b", has(1, "unlink", f"{p}/d/b")),
    ("rmdir d", has(1, "rmdir", f"{p}/d")),
    ("end", 1 in end_index),
] if not ok]
check("r1: every kind of call is seen, with its path", not miss, "missing: " + ", ".join(miss) if miss else "")
r = release_of(1, f"{p}/final.txt"); want = stamp_expected("r1", f"{p}/final.txt")
check("r1: a release's stamp is the file's after the run", r is not None and r["stamp"] == want, f"release {r and r['stamp']}, stat {want}")
check("r1: the observer's lstat at release is the file's after the run", r is not None and r["ustamp"] == want, f"lstat {r and r['ustamp']}, stat {want}")
# 2
r = release_of(2, f"{W}/r2/daemon.txt"); want = stamp_expected("r2", f"{W}/r2/daemon.txt")
check("r2: a daemon's write after its command returned is its run's", r is not None and r["stamp"] == want, f"release {r and r['stamp']}, stat {want}")
ri = evs.index(r) if r else -1
check("r2: the run ends after its daemon's last release", r is not None and end_index.get(2, -1) > ri, f"release at {ri}, end at {end_index.get(2)}")
# 3, 4
for run, other in ((3, 4), (4, 3)):
    mine = [e for e in evs if e["kind"] == "open" and f"/r34/p{run}-" in e["path"]]
    wrong = [e for e in mine if e["run"] != run]
    check(f"r{run}: two runs at once: each write is its own run's", len(mine) == 200 and not wrong, f"{len(mine)} opens, {len(wrong)} attributed to another run")
# 5
t = [e for e in by_run[5] if e["kind"] == "open" and e["path"].startswith(f"{W}/r5/t")]
check("r5: every thread's write is its run's", len(t) == 16, f"{len(t)} of 16")
# 6
t = [e for e in by_run[6] if e["kind"] == "open" and e["path"] == f"{W}/r6/f"]
check("r6: env -i and a static binary", len(t) == 10, f"{len(t)} of 10 opens")
# 7
r = release_of(7, f"{W}/r7/m.bin"); want = stamp_expected("r7", f"{W}/r7/m.bin")
check("r7: writes through a mapping after close are in the release's stamp", r is not None and r["stamp"] == want, f"release {r and r['stamp']}, stat {want}")
# 8
x = expect("r8") or []
check("r8: strace runs inside a run", x[:1] == ["exit 0"] and len(x) > 1 and x[1].strip() not in ("", "0") and has(8, "open", f"{W}/r8/s8.txt", write=True) is not None, " ".join(x).strip())
# 9
x = expect("r9") or []
bad = [l for l in x if "EINTR" in l and not l.rstrip().endswith(" 0 EINTR")]
check("r9: no watched call is cut short", bool(x) and not bad, "; ".join(l.strip() for l in bad) or f"{len([l for l in x if 'EINTR' in l])} calls checked")
# 10
x = " ".join(expect("r10") or []).strip()
if "uring: ok" in x:
    check("r10: an io_uring open is seen", has(10, "open", f"{W}/r10/u.txt", write=True) is not None, x)
else:
    check("r10: io_uring was refused here, so nothing to see", True, x)
# 11
x = expect("r11")
if x is not None:
    ok = any(l.strip() == "exit 0" for l in x)
    if ok:
        check("r11: a run in a user and pid namespace", has(11, "open", f"{W}/r11/ns.txt", write=True) is not None, " ".join(x).strip())
    else:
        check("r11: unshare was refused here", True, " ".join(x).strip())
# 12
x = expect("r12") or []
if x[:1] == ["absent"]:
    check("r12: gdb absent, not checked", True)
else:
    check("r12: gdb runs inside a run", x[:1] == ["exit 0"] and has(12, "open", f"{W}/r12/g.txt", write=True) is not None, " ".join(x).strip())
# 13
t = [e for e in evs if "untagged.txt" in e["path"]]
check("r13: a process outside every run is not seen", not t, f"{len(t)} events")
# 14, 15
check("r15: a run inside a run is the inner one's", has(15, "open", f"{W}/r14/n.txt", write=True) is not None and has(14, "open", f"{W}/r14/n.txt") is None)
# 20
x = expect("r20")
if x is None:
    check("r20: no shared directory reached, not checked", True)
else:
    lane = x[0].split("\t")[1] if x and "\t" in x[0] else None
    mac = (expect("r20mac") or [""])[0].strip()
    r = release_of(20, "/s/vfs.txt")
    rel = r and r["stamp"]
    check("r20: over virtiofs, the release's stamp is the lane's stat", rel is not None and rel == lane, f"release {rel}, lane {lane}, Mac {mac}")
    check("r20: over virtiofs, the lane's stamp is the Mac's", lane == mac, f"lane {lane}, Mac {mac}")
    check("r20: over virtiofs, the observer's lstat at release is the lane's", r is not None and r["ustamp"] == lane, f"lstat {r and r['ustamp']} after {r and r['lag']} µs, lane {lane}")
# cut paths
cut = [e for e in evs if e["cut"] != "0" and e["path"].startswith(W)]
check("no path under the workload was cut short", not cut, f"{len(cut)} cut")

lags = sorted(float(e["lag"]) for e in evs if e["kind"] == "release" and e["lag"] != "-")
if lags:
    q = lambda f: lags[min(len(lags) - 1, int(f * len(lags)))]
    print(f"# release to the observer's lstat, µs, over {len(lags)} releases: median {q(0.5):.1f}, p99 {q(0.99):.1f}, max {lags[-1]:.1f}")
nostat = [e for e in evs if e["kind"] == "release" and e["ustamp"] == "-"]
print(f"# releases the observer could not lstat: {len(nostat)}" + (f", e.g. {nostat[0]['path']} by pid {nostat[0]['pid']}" if nostat else ""))

def flood(evs, lost_run, runs, n, label, want_loss):
    for run in runs:
        got = sum(1 for e in evs if e["run"] == run and e["kind"] == "open" and e["path"] == f"{W}/flood/f")
        l = lost_run.get(run, 0)
        ok = got <= n and got + l >= n and (l > 0 or got == n)
        check(f"{label} run {run}: every event delivered or counted lost", ok, f"{got} delivered, {l} lost, of {n}")
    total_lost = sum(lost_run.get(r, 0) for r in runs)
    if want_loss:
        check(f"{label}: the small ring lost events, and said so", total_lost > 0, f"{total_lost} lost")
    else:
        print(f"# {label}: {total_lost} lost in all")

flood(evs, lost_run, range(101, 109), int((expect("flood") or ["100000"])[0]), "flood, 64 MiB ring", False)
if flood2:
    e2, l2, lr2, m2 = load(flood2)
    flood(e2, lr2, range(201, 209), int((expect("flood2n") or ["50000"])[0]), "flood, 1 MiB ring", True)

print("\n# cost (ms; bench: ns per open and close)")
rows = defaultdict(list)
for line in open(f"{W}/cost.tsv"):
    f = line.rstrip("\n").split("\t")
    if len(f) < 2: continue
    if f[0] == "tree": print("#", *f[1:]); continue
    v = f[1].split()[0]
    try: rows[f[0]].append(float(v))
    except ValueError: pass
for k in sorted(rows):
    print(f"{k:32s} median {statistics.median(rows[k]):10.1f}   runs {' '.join(f'{v:.1f}' for v in rows[k])}")
print(f"\n# {sum(1 for r in results if r[1])} passed, {sum(1 for r in results if not r[1])} failed")
