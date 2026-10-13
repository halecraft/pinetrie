#!/usr/bin/env python3
"""S182's probe: catch-ups and accepts on a graph of states, an accept recorded
as a merge. git stands in for the graph only (a state is a commit with the
parents ADR-0142 gives it; `git merge-base --all` finds the bases); the merge
is the path merge, `git merge-file` for text. Each flow is merged three ways:
with the graph's base, with the linear base a lane's start would give (no
accept recorded as a merge, as a jj project's copy is), and, where the graph
gives several bases, with each one and with them merged first (recursive).

    python3 probe.py   (writes results.json beside itself)
"""
import json, os, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = tempfile.mkdtemp(prefix="s182-")
ENV = {**{k: v for k, v in os.environ.items() if not k.startswith("GIT_CONFIG")},
       "GIT_DIR": os.path.join(REPO, ".git"), "GIT_CONFIG_GLOBAL": "/dev/null",
       "GIT_CONFIG_NOSYSTEM": "1", "GIT_AUTHOR_NAME": "s", "GIT_AUTHOR_EMAIL": "s@s",
       "GIT_COMMITTER_NAME": "s", "GIT_COMMITTER_EMAIL": "s@s"}
subprocess.run(["git", "init", "-q", REPO], env=ENV, check=True)


def git(*args, input=None):
    return subprocess.run(["git", *args], env=ENV, input=input, capture_output=True,
                          check=True).stdout


CONTENT = {}  # state id -> {path: bytes}


def state(files, *parents):
    """A state: its files, and the parents ADR-0142 records."""
    entries = []
    for p, data in sorted(files.items()):
        blob = git("hash-object", "-w", "--stdin", input=data).decode().strip()
        entries.append(f"100644 blob {blob}\t{p}")
    tree = git("mktree", input=("\n".join(entries) + "\n").encode()).decode().strip()
    args = ["commit-tree", tree, "-m", "s"]
    for p in parents:
        args += ["-p", p]
    sid = git(*args).decode().strip()
    CONTENT[sid] = dict(files)
    return sid


def bases(a, b):
    out = subprocess.run(["git", "merge-base", "--all", a, b], env=ENV,
                         capture_output=True).stdout.decode().split()
    return out


def merge_text(o, a, b):
    with tempfile.TemporaryDirectory() as d:
        for n, v in (("o", o), ("a", a), ("b", b)):
            open(os.path.join(d, n), "wb").write(v)
        r = subprocess.run(["git", "merge-file", "-p", *(os.path.join(d, n) for n in "aob")],
                           capture_output=True)
        return (r.stdout, r.returncode == 0)


def merge(base, ours, theirs, markers=False):
    """The path merge: one side changed takes it; alike once; else text, three
    ways. With `markers`, a conflicted text keeps git's markers (a virtual base)."""
    out, conflicts = {}, []
    for p in sorted(set(base) | set(ours) | set(theirs)):
        o, a, b = base.get(p), ours.get(p), theirs.get(p)
        if a == b:
            v = a
        elif a == o:
            v = b
        elif b == o:
            v = a
        elif a is None or b is None:
            conflicts.append(p); v = a
        else:
            m, clean = merge_text(o or b"", a, b)
            v = m if (clean or markers) else a
            if not clean:
                conflicts.append(p)
        if v is not None:
            out[p] = v
    return out, conflicts


def virtual_base(bs):
    """Several bases merged into one, as git's recursive strategy does."""
    if len(bs) == 1:
        return CONTENT[bs[0]], []
    first, rest = bs[0], bs[1:]
    acc, inner = CONTENT[first], []
    for other in rest:
        bb = bases(first, other)
        b0, c0 = virtual_base(bb) if bb else ({}, [])
        acc, c = merge(b0, acc, CONTENT[other], markers=True)
        inner += c0 + c
    return acc, inner


def lines(*ls):
    return ("\n".join(ls) + "\n").encode()


results = []


def check(name, ours, theirs, linear_base, expected, story):
    bs = bases(ours, theirs)
    row = {"flow": name, "story": story, "bases": len(bs)}
    vb, inner = virtual_base(bs)
    got, conf = merge(vb, CONTENT[ours], CONTENT[theirs])
    row["graph"] = "right" if (not conf and got == expected) else f"conflict {conf}" if conf else "wrong"
    if len(bs) > 1:
        row["graph"] += " (recursive)" + (f", inner conflicts {inner}" if inner else "")
        for i, b in enumerate(bs):
            g, c = merge(CONTENT[b], CONTENT[ours], CONTENT[theirs])
            row[f"base {i + 1} alone"] = "right" if (not c and g == expected) else f"conflict {c}" if c else "wrong"
    g, c = merge(CONTENT[linear_base], CONTENT[ours], CONTENT[theirs])
    row["linear base, no accept as a merge"] = "right" if (not c and g == expected) else f"conflict {c}" if c else "wrong"
    results.append(row)


F = "f.txt"
X = "x.txt"

# A. Accept, then the lane edits the accepted line again.
f0 = state({F: lines("a", "b", "c")})
l1 = state({F: lines("a", "B1", "c")}, f0)
f1 = state(merge(CONTENT[f0], CONTENT[f0], CONTENT[l1])[0], f0, l1)  # accept
l2 = state({F: lines("a", "B2", "c")}, l1)
check("A", l2, f1, f0, {F: lines("a", "B2", "c")},
      "accepted, then the lane changes the accepted line again; its catch-up")

# B. Accept, then you edit the accepted line in your folder.
f2 = state({F: lines("a", "Yours", "c")}, f1)
l1b = state({F: lines("a", "B1", "c"), X: lines("new")}, l1)
check("B", l1b, f2, f0, {F: lines("a", "Yours", "c"), X: lines("new")},
      "accepted, then you change the accepted line; the lane goes on elsewhere and catches up")

# C. Two accepts of one lane, then its catch-up.
g0 = state({F: lines("a", "b", "c", "d")})
m1 = state({F: lines("A", "b", "c", "d")}, g0)
g1 = state(merge(CONTENT[g0], CONTENT[g0], CONTENT[m1])[0], g0, m1)
m2 = state({F: lines("A", "B", "c", "d")}, m1)
bs = bases(g1, m2)
g2c, _ = merge(CONTENT[bs[0]], CONTENT[g1], CONTENT[m2])
g2 = state(g2c, g1, m2)
m3 = state({F: lines("A", "BB", "c", "d")}, m2)
check("C", m3, g2, g0, {F: lines("A", "BB", "c", "d")},
      "accepted twice, then the lane changes its own accepted line again")

# D. A branch caught up with its parent, both accepted, the branch catches up.
h0 = state({F: lines("1", "2", "3", "4")})
p1 = state({F: lines("P", "2", "3", "4")}, h0)
c1 = state({F: lines("P", "2", "C", "4")}, p1)  # forked from the parent at p1
p2 = state({F: lines("P", "PP", "3", "4")}, p1)
c2c, _ = merge(CONTENT[p1], CONTENT[c1], CONTENT[p2])
c2 = state(c2c, c1, p2)  # catch up with the parent
h1c, _ = merge(CONTENT[h0], CONTENT[h0], CONTENT[p2])
h1 = state(h1c, h0, p2)  # parent accepted
h2c, _ = merge(CONTENT[bases(h1, c2)[0]], CONTENT[h1], CONTENT[c2])
h2 = state(h2c, h1, c2)  # branch accepted
c3 = state({F: lines("P", "PP", "CC", "4")}, c2)
check("D", c3, h2, h0, {F: lines("P", "PP", "CC", "4")},
      "a branch caught up with its parent; both accepted; the branch changes its line again")

# E. Criss-cross: you save, the lane catches up with your save, and an offer
#    shown before that catch-up is accepted. The lane then changes its line.
k0 = state({F: lines("x", "y", "z")})
k1 = state({F: lines("x", "Y1", "z")}, k0)        # lane's turn
ky = state({F: lines("X", "y", "z")}, k0)         # your save
k2c, _ = merge(CONTENT[k0], CONTENT[k1], CONTENT[ky])
k2 = state(k2c, k1, ky)                           # lane catches up with your save
kac, _ = merge(CONTENT[bases(ky, k1)[0]], CONTENT[ky], CONTENT[k1])
ka = state(kac, ky, k1)                           # the offer shown at k1, accepted
k3 = state({F: lines("X", "Y2", "z")}, k2)        # lane changes its line again
check("E", k3, ka, k0, {F: lines("X", "Y2", "z")},
      "criss-cross: an offer shown before the lane's catch-up is accepted after it")

# E2. The same criss-cross, the two changes far apart in the file.
q0 = state({F: lines("x", "1", "2", "y", "3", "4", "z")})
q1 = state({F: lines("x", "1", "2", "Y1", "3", "4", "z")}, q0)
qy = state({F: lines("X", "1", "2", "y", "3", "4", "z")}, q0)
q2c, _ = merge(CONTENT[q0], CONTENT[q1], CONTENT[qy])
q2 = state(q2c, q1, qy)
qac, _ = merge(CONTENT[bases(qy, q1)[0]], CONTENT[qy], CONTENT[q1])
qa = state(qac, qy, q1)
q3 = state({F: lines("X", "1", "2", "Y2", "3", "4", "z")}, q2)
check("E2", q3, qa, q0, {F: lines("X", "1", "2", "Y2", "3", "4", "z")},
      "criss-cross as E, the two changes far apart")

# E3. Criss-cross where you, not the lane, change the line afterwards.
r3 = state({F: lines("X", "1", "2", "Y1", "3", "4", "Z")}, qa)  # your save after the accept
check("E3", q2, r3, q0, {F: lines("X", "1", "2", "Y1", "3", "4", "Z")},
      "criss-cross as E2; then you change another line, and the lane catches up")

json.dump(results, open(os.path.join(HERE, "results.json"), "w"), indent=2)
for r in results:
    print(json.dumps(r))
