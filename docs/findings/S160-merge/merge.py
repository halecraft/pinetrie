#!/usr/bin/env python3
"""Probe E: merging two states path by path, against jj and git, on pine·trie's own merges. Disposable.

    python3 merge.py history     # every two-parent merge in duane's repo (a mirror of it)
    python3 merge.py synthetic   # constructed cases: renames, deletes, binaries, modes

The path-by-path merge (`merge_paths`):
- a path changed on one side only takes that side;
- the same change on both sides is taken once;
- otherwise text is merged with `git merge-file` (an empty base for add/add), and
  anything else (a deletion against an edit, a mode change, a symlink, a binary)
  is a conflict, kept as a value.
For each merge it is compared with jj (`jj new p1 p2`), with git's own merge
(`git merge-tree`, which follows renames), and with the merge commit that was
recorded. Every command runs under a time limit. Writes results-<step>.json.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
E = Path("/workspace/sandbox/probes/e")
MIRROR = E / "mirror.git"
JJREPO = E / "jjrepo"
ENV = {**os.environ, "JJ_CONFIG": "/workspace/sandbox/probes/empty-jj.toml", "JJ_USER": "p", "JJ_EMAIL": "p@e", "GIT_AUTHOR_NAME": "p", "GIT_AUTHOR_EMAIL": "p@e", "GIT_COMMITTER_NAME": "p", "GIT_COMMITTER_EMAIL": "p@e"}
LIMIT = 120
BUDGET = 600  # seconds for the whole history step


def run(argv, cwd, check=True, input=None, text=True):
    r = subprocess.run(argv, cwd=cwd, env=ENV, capture_output=True, text=text, timeout=LIMIT, input=input, stdin=None if input is not None else subprocess.DEVNULL)
    if check and r.returncode:
        raise RuntimeError(f"{argv}: {r.stderr[-400:]}")
    return r


def blob_id(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def changes(git: Path, base: str, side: str) -> dict:
    out = {}
    raw = run(["git", "diff-tree", "-r", "-z", "--no-renames", base, side], git).stdout.split("\0")
    i = 0
    while i < len(raw) - 1:
        meta, path = raw[i].lstrip(":").split(" "), raw[i + 1]
        i += 2
        _, mode2, _, oid2, status = meta
        out[path] = None if status == "D" else (mode2, oid2)
    return out


def entry(git: Path, commit: str, path: str):
    r = run(["git", "ls-tree", "-z", commit, "--", path], git).stdout.split("\0")[0]
    if not r:
        return None
    meta, _ = r.split("\t", 1)
    mode, _, oid = meta.split()
    return mode, oid


def cat(git: Path, oid: str) -> bytes:
    return subprocess.run(["git", "cat-file", "blob", oid], cwd=git, capture_output=True, timeout=LIMIT, check=True).stdout


def merge_paths(git: Path, base: str, p1: str, p2: str):
    """{path: ('clean', mode, blob id) | ('conflict', why)} for paths changed on both sides,
    and the count of paths changed on one side only."""
    c1, c2 = changes(git, base, p1), changes(git, base, p2)
    both = sorted(set(c1) & set(c2))
    out = {}
    for path in both:
        e1, e2 = c1[path], c2[path]
        if e1 == e2:
            out[path] = ("clean", *e1) if e1 else ("clean", None, None)
            continue
        if e1 is None or e2 is None:
            out[path] = ("conflict", "deleted against changed")
            continue
        if e1[0] != e2[0]:
            out[path] = ("conflict", "mode")
            continue
        if e1[0] == "120000":
            out[path] = ("conflict", "symlink")
            continue
        eb = entry(git, base, path)
        a, b = cat(git, e1[1]), cat(git, e2[1])
        o = cat(git, eb[1]) if eb else b""
        if b"\0" in a or b"\0" in b or b"\0" in o:
            out[path] = ("conflict", "binary")
            continue
        with tempfile.TemporaryDirectory() as d:
            for n, data in (("ours", a), ("base", o), ("theirs", b)):
                Path(d, n).write_bytes(data)
            r = subprocess.run(["git", "merge-file", "-p", "ours", "base", "theirs"], cwd=d, capture_output=True, timeout=LIMIT)
        out[path] = ("conflict", "text") if r.returncode else ("clean", e1[0], blob_id(r.stdout))
    one_sided = len(set(c1) ^ set(c2))
    return out, one_sided, c1, c2


def jj_merge(p1: str, p2: str, paths):
    run(["jj", "new", p1, p2, "--ignore-working-copy", "-m", "probe"], JJREPO)
    x = run(["jj", "log", "-r", "@", "--no-graph", "--ignore-working-copy", "-T", "commit_id"], JJREPO).stdout.strip()
    r = run(["jj", "resolve", "--list", "-r", x, "--ignore-working-copy"], JJREPO, check=False)
    conflicted = {line.split()[0] for line in r.stdout.splitlines() if line.strip()}
    out = {}
    for path in paths:
        if path in conflicted:
            out[path] = ("conflict",)
            continue
        s = subprocess.run(["jj", "file", "show", "-r", x, "--ignore-working-copy", "--", f"root-file:{path}"], cwd=JJREPO, env=ENV, capture_output=True, timeout=LIMIT)
        out[path] = ("clean", blob_id(s.stdout)) if s.returncode == 0 else ("clean", None)
    run(["jj", "abandon", x, "--ignore-working-copy"], JJREPO, check=False)
    return out, conflicted


def ort_merge(git: Path, p1: str, p2: str, paths):
    r = run(["git", "merge-tree", "--write-tree", "--name-only", "--no-messages", p1, p2], git, check=False)
    lines = r.stdout.splitlines()
    tree = lines[0] if lines else None
    conflicted = set(lines[1:]) if r.returncode == 1 else set()
    out = {}
    for path in paths:
        if path in conflicted:
            out[path] = ("conflict",)
        else:
            e = entry(git, tree, path) if tree else None
            out[path] = ("clean", e[1] if e else None)
    return out, conflicted


def same(ours, other):
    if ours[0] == "conflict":
        return other[0] == "conflict"
    return other[0] == "clean" and other[1] == ours[2]


def history():
    # Leave out the merges this probe made through jj, which jj's refs/jj/keep
    # keep: `jj new p1 p2` makes one ("probe"), and abandoning it makes another,
    # the new working-copy commit on the same parents (no description). Run on a
    # fresh mirror and jj repo: reusing them makes every jj command slower.
    listed = run(["git", "log", "--merges", "--max-parents=2", "--all", "--format=%H %s"], MIRROR).stdout.splitlines()
    merges = [line.split()[0] for line in listed if line.split(" ", 1)[1:] not in (["probe"], [], [""])]
    deadline = time.monotonic() + BUDGET
    # jj sees only commits reachable from what it imported: name every merge once.
    run(["git", "update-ref", "--stdin"], MIRROR, input="".join(f"update refs/heads/probe-merge-{m[:12]} {m}\n" for m in merges))
    run(["jj", "git", "import", "--ignore-working-copy"], JJREPO)
    stats = Counter()
    disagreements = []
    for m in merges:
        if time.monotonic() > deadline:
            stats["stopped at the time budget"] = 1
            break
        p1, p2 = run(["git", "log", "-1", "--format=%P", m], MIRROR).stdout.split()
        bases = run(["git", "merge-base", "--all", p1, p2], MIRROR, check=False).stdout.split()
        if len(bases) != 1:
            stats["skipped: " + ("no common base" if not bases else "several bases")] += 1
            continue
        ours, one_sided, c1, c2 = merge_paths(MIRROR, bases[0], p1, p2)
        stats["merges"] += 1
        stats["paths changed on one side"] += one_sided
        stats["paths changed on both sides"] += len(ours)
        if not ours:
            stats["merges with no path changed on both sides"] += 1
        jj, jj_conf = jj_merge(p1, p2, list(ours))
        ort, ort_conf = ort_merge(MIRROR, p1, p2, list(ours))
        recorded = {p: entry(MIRROR, m, p) for p in ours}
        for path, o in ours.items():
            stats[f"ours {o[0]}" + (f" ({o[1]})" if o[0] == "conflict" else "")] += 1
            agree_jj, agree_ort = same(o, jj[path]), same(o, ort[path])
            stats["agrees with jj"] += agree_jj
            stats["agrees with git"] += agree_ort
            rec = recorded[path]
            if o[0] == "clean":
                stats["clean, and the recorded merge kept it"] += (rec[1] if rec else None) == o[2]
            if not (agree_jj and agree_ort):
                disagreements.append({"merge": m[:12], "path": path, "ours": o[0] if o[0] == "clean" else f"conflict ({o[1]})", "jj": jj[path][0], "git": ort[path][0], "recordedEqualsOurs": o[0] == "clean" and (rec[1] if rec else None) == o[2], "recordedEqualsJj": jj[path][0] == "clean" and (rec[1] if rec else None) == jj[path][1], "recordedEqualsGit": ort[path][0] == "clean" and (rec[1] if rec else None) == ort[path][1]})
        # Conflicts jj or git found outside the paths changed on both sides: renames, or a directory against a file.
        extra_jj = jj_conf - set(ours)
        extra_ort = ort_conf - set(ours)
        stats["jj conflicts outside both-changed paths"] += len(extra_jj)
        stats["git conflicts outside both-changed paths"] += len(extra_ort)
        if extra_jj or extra_ort:
            disagreements.append({"merge": m[:12], "outside": True, "jj": sorted(extra_jj)[:5], "git": sorted(extra_ort)[:5]})
    kinds = Counter()
    for d in disagreements:
        if d.get("outside"):
            kinds[f"conflicts outside both-changed paths (jj {bool(d['jj'])}, git {bool(d['git'])})"] += 1
        else:
            kinds[f"ours {d['ours']} / jj {d['jj']} / git {d['git']}; recorded = ours {d['recordedEqualsOurs']}, jj {d['recordedEqualsJj']}, git {d['recordedEqualsGit']}"] += 1
    out = {"stats": dict(stats), "disagreementKinds": dict(kinds.most_common()), "disagreements": disagreements, "disagreementCount": len(disagreements)}
    print(json.dumps(out["stats"], indent=1))
    print(json.dumps(out["disagreementKinds"], indent=1))
    return out


SYNTH = {
    "edit, edit, apart": ({"f.txt": "a\nb\nc\nd\ne\n"}, {"f.txt": "A\nb\nc\nd\ne\n"}, {"f.txt": "a\nb\nc\nd\nE\n"}),
    "edit, edit, same line": ({"f.txt": "a\nb\n"}, {"f.txt": "x\nb\n"}, {"f.txt": "y\nb\n"}),
    "same edit both": ({"f.txt": "a\n"}, {"f.txt": "b\n"}, {"f.txt": "b\n"}),
    "delete, edit": ({"f.txt": "a\n"}, {}, {"f.txt": "b\n"}),
    "rename, edit": ({"old.txt": "a\nb\nc\nd\ne\nf\n"}, {"new.txt": "a\nb\nc\nd\ne\nf\n"}, {"old.txt": "a\nb\nc\nd\ne\nF\n"}),
    "rename, rename elsewhere": ({"f.txt": "a\nb\nc\n"}, {"g.txt": "a\nb\nc\n"}, {"h.txt": "a\nb\nc\n"}),
    "directory, file": ({"x": None}, {"d/f.txt": "a\n"}, {"d": "a file\n"}),
    "binary both": ({"img.png": b"\x89PNG\0one"}, {"img.png": b"\x89PNG\0two"}, {"img.png": b"\x89PNG\0three"}),
    "add, add, same name": ({}, {"n.txt": "mine\n"}, {"n.txt": "theirs\n"}),
    "mode, edit": ({"run.sh": "echo a\n"}, {"run.sh": ("echo a\n", 0o755)}, {"run.sh": "echo b\n"}),
}


def write_tree(git: Path, files: dict) -> str:
    work = Path(tempfile.mkdtemp())
    for p, v in files.items():
        if v is None:
            continue
        mode = 0o644
        if isinstance(v, tuple):
            v, mode = v
        data = v.encode() if isinstance(v, str) else v
        (work / p).parent.mkdir(parents=True, exist_ok=True)
        (work / p).write_bytes(data)
        os.chmod(work / p, mode)
    env = {**ENV, "GIT_DIR": str(git), "GIT_WORK_TREE": str(work), "GIT_INDEX_FILE": str(work.parent / f"{work.name}.idx")}
    subprocess.run(["git", "add", "-A", "."], cwd=work, env=env, check=True, timeout=LIMIT)
    tree = subprocess.run(["git", "write-tree"], cwd=work, env=env, capture_output=True, text=True, check=True, timeout=LIMIT).stdout.strip()
    shutil.rmtree(work)
    return tree


def synthetic():
    out = {}
    for name, (base, one, two) in SYNTH.items():
        d = E / "synth"
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        run(["git", "init", "-q", "--bare", "repo.git"], d)
        git = d / "repo.git"
        b = run(["git", "commit-tree", write_tree(git, base), "-m", "base"], git).stdout.strip()
        p1 = run(["git", "commit-tree", write_tree(git, one), "-p", b, "-m", "one"], git).stdout.strip()
        p2 = run(["git", "commit-tree", write_tree(git, two), "-p", b, "-m", "two"], git).stdout.strip()
        run(["git", "update-ref", "refs/heads/one", p1], git)
        run(["git", "update-ref", "refs/heads/two", p2], git)
        jjr = d / "jj"
        jjr.mkdir()
        run(["jj", "git", "init", "--git-repo", str(git)], jjr)
        ours, _, c1, c2 = merge_paths(git, b, p1, p2)
        run(["jj", "new", p1, p2, "--ignore-working-copy", "-m", "m"], jjr)
        x = run(["jj", "log", "-r", "@", "--no-graph", "--ignore-working-copy", "-T", "commit_id"], jjr).stdout.strip()
        jj_conf = sorted(line.split()[0] for line in run(["jj", "resolve", "--list", "-r", x, "--ignore-working-copy"], jjr, check=False).stdout.splitlines() if line.strip())
        jj_files = sorted(run(["jj", "file", "list", "-r", x, "--ignore-working-copy"], jjr).stdout.split())
        r = run(["git", "merge-tree", "--write-tree", "--name-only", "--no-messages", p1, p2], git, check=False)
        lines = r.stdout.splitlines()
        ort_conf = lines[1:] if r.returncode == 1 else []
        ort_files = sorted(run(["git", "ls-tree", "-r", "--name-only", lines[0]], git).stdout.split()) if lines else []
        out[name] = {
            "ours": {p: (v[0] if v[0] == "clean" else f"conflict: {v[1]}") for p, v in ours.items()},
            "oneSided": sorted(set(c1) ^ set(c2)),
            "jjConflicts": jj_conf,
            "jjFiles": jj_files,
            "gitConflicts": ort_conf,
            "gitFiles": ort_files,
        }
        print(name, json.dumps(out[name]))
    return out


if __name__ == "__main__":
    for step in sys.argv[1:]:
        res = globals()[step]()
        (HERE / f"results-{step}.json").write_text(json.dumps(res, indent=1) + "\n")
