#!/usr/bin/env python3
"""Probe B, part 1: naming a state by git's tree format. Disposable.

    python3 identity.py verify      # our hash == git's tree id, and its cost
    python3 identity.py lane        # the whole lane's disk, hashed in full
    python3 identity.py turn        # an update after a typical turn, and after an install
    python3 identity.py survey      # what git's format cannot hold, in the lane and corpus
"""

import json
import os
import random
import stat
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

from gittree import Tree

CORPUS = Path("/workspace/sandbox/probes/corpus")
REPOS = ["pinetrie", "ripgrep", "flask", "linux"]
OUT = Path(__file__).resolve().parent
LANE_SKIP = {".jj", ".git", "sandbox", ".plans"}
results = {}


def git(repo, *args, stdin=None):
    return subprocess.run(["git", *args], cwd=repo, input=stdin, capture_output=True, text=True, check=True).stdout


def tracked(repo):
    out = []
    for line in git(repo, "ls-files", "-s", "-z").split("\0"):
        if not line:
            continue
        meta, path = line.split("\t", 1)
        if meta.split()[0] != "160000":
            out.append(path)
    return out


def walk(root: Path, skip=frozenset()):
    files, dirs = [], []
    stack = [""]
    while stack:
        d = stack.pop()
        for e in os.scandir(root / d if d else root):
            rel = f"{d}/{e.name}" if d else e.name
            if not d and e.name in skip:
                continue
            if e.is_dir(follow_symlinks=False):
                dirs.append(rel)
                stack.append(rel)
            else:
                files.append(rel)
    return files, dirs


def timed(fn):
    t = time.perf_counter()
    v = fn()
    return v, round((time.perf_counter() - t) * 1000, 1)


def verify():
    out = {}
    for name in REPOS:
        repo = CORPUS / name
        git(repo, "checkout", "-q", "--", ".")
        paths = tracked(repo)
        size = sum(os.lstat(repo / p).st_size for p in paths)
        want = git(repo, "rev-parse", "HEAD^{tree}").strip()
        row = {"files": len(paths), "MB": round(size / 1e6, 1), "gitTree": want}
        for algo in ("sha1", "sha256"):
            t = Tree(str(repo), algo)
            oid, ms = timed(lambda: t.build(paths))
            row[f"{algo}Ms"] = ms
            if algo == "sha1":
                row["equal"] = oid.hex() == want
        _, row["statWalkMs"] = timed(lambda: walk(repo, {".git"}))
        out[name] = row
        print(name, row)
    results["verify"] = out


def lane():
    root = Path("/workspace")
    (files, dirs), walk_ms = timed(lambda: walk(root, LANE_SKIP))
    size = sum(os.lstat(root / p).st_size for p in files)
    row = {"files": len(files), "dirs": len(dirs), "GB": round(size / 1e9, 2), "statWalkMs": walk_ms}
    t = Tree(str(root), "sha1")
    _, row["sha1Ms"] = timed(lambda: t.build(files))
    no_store = [p for p in files if not p.startswith(".pnpm-store/")]
    row["filesWithoutStore"] = len(no_store)
    row["GBWithoutStore"] = round(sum(os.lstat(root / p).st_size for p in no_store) / 1e9, 2)
    t2 = Tree(str(root), "sha1")
    _, row["sha1WithoutStoreMs"] = timed(lambda: t2.build(no_store))
    print("lane", row)
    results["lane"] = row


def turn():
    out = {}
    rnd = random.Random(7)
    for name in ("pinetrie", "linux"):
        repo = CORPUS / name
        git(repo, "checkout", "-q", "--", ".")
        git(repo, "clean", "-qfd", "-e", "node_modules")
        paths = tracked(repo)
        t = Tree(str(repo), "sha1")
        t.build(paths)
        edited = rnd.sample([p for p in paths if not os.path.islink(repo / p)], 5)
        for p in edited:
            with open(repo / p, "a") as f:
                f.write("\n// a turn's edit\n")
        added = ["probe-new/a.txt", "probe-new/deeper/b.txt"]
        for p in added:
            (repo / p).parent.mkdir(parents=True, exist_ok=True)
            (repo / p).write_text("new\n")
        deleted = [rnd.choice([p for p in paths if p not in edited])]
        for p in deleted:
            os.remove(repo / p)
        oid, ms = timed(lambda: t.update(edited + added + deleted))
        git(repo, "add", "-A")
        want = git(repo, "write-tree").strip()
        git(repo, "reset", "-q", "--hard")
        git(repo, "clean", "-qfd", "-e", "node_modules")
        out[name] = {"changedPaths": 8, "updateMs": ms, "equalsGitWriteTree": oid.hex() == want}
        print(name, out[name])
    # An install, in a whole-disk identity: every file pnpm writes.
    repo = CORPUS / "pinetrie"
    env = {**os.environ, "HOME": "/workspace/sandbox/probes/home", "CI": "1"}
    subprocess.run(["rm", "-rf", "node_modules"], cwd=repo, check=True)
    for d in repo.glob("*/*/node_modules"):
        subprocess.run(["rm", "-rf", str(d)], check=True)
    before, _ = walk(repo, {".git"})
    t = Tree(str(repo), "sha1")
    t.build(before)
    subprocess.run(["pnpm", "install", "--frozen-lockfile"], cwd=repo, env=env, capture_output=True, check=True)
    after, _ = walk(repo, {".git"})
    new = sorted(set(after) - set(before))
    _, ms = timed(lambda: t.update(new))
    out["pnpmInstall"] = {"changedPaths": len(new), "updateMs": ms}
    print("install", out["pnpmInstall"])
    results["turn"] = out


def survey_one(root: Path, files, dirs):
    c = Counter()
    modes = Counter()
    sizes = Counter()
    inodes = Counter()
    lower = Counter()
    for d in dirs:
        try:
            if not any(True for _ in os.scandir(root / d)):
                c["emptyDirs"] += 1
        except OSError:
            pass
    for p in files:
        full = root / p
        st = os.lstat(full)
        m = st.st_mode
        if stat.S_ISLNK(m):
            c["symlinks"] += 1
        elif not stat.S_ISREG(m):
            c["special"] += 1
        else:
            perm = oct(m & 0o7777)
            if perm not in ("0o644", "0o755"):
                modes[perm] += 1
            if st.st_nlink > 1:
                c["hardlinked"] += 1
                inodes[st.st_ino] += 1
            if st.st_size > 1 << 20:
                sizes[">1MiB (jj's default limit)"] += 1
            if st.st_size > 100 << 20:
                sizes[">100MB"] += 1
        try:
            if os.listxattr(full, follow_symlinks=False):
                c["withXattrs"] += 1
        except OSError:
            pass
        try:
            p.encode("utf-8")
        except UnicodeEncodeError:
            c["nonUtf8Names"] += 1
        lower[p.lower()] += 1
    c["caseCollisions"] = sum(1 for v in lower.values() if v > 1)
    return {"files": len(files), **c, "modesOtherThan644or755": dict(modes.most_common(8)), "sizes": dict(sizes)}


def survey():
    out = {}
    root = Path("/workspace")
    files, dirs = walk(root, LANE_SKIP)
    out["lane (whole disk)"] = survey_one(root, files, dirs)
    src = set(tracked(root))
    src_dirs = {"/".join(p.split("/")[:i]) for p in src for i in range(1, p.count("/") + 1)}
    out["lane (tracked)"] = survey_one(root, sorted(src), sorted(src_dirs))
    for name in REPOS:
        repo = CORPUS / name
        f, d = walk(repo, {".git"})
        out[name] = survey_one(repo, f, d)
    for k, v in out.items():
        print(k, v)
    results["survey"] = out


if __name__ == "__main__":
    for step in sys.argv[1:]:
        globals()[step]()
        path = OUT / f"results-{step}.json"
        path.write_text(json.dumps(results[step], indent=1) + "\n")
