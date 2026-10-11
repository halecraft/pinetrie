#!/usr/bin/env python3
"""Probe A, part 2: classify each path a command writes by its origin, and compare with git.

    python3 classify.py <repo> [<repo> ...]   # pinetrie, ripgrep, flask, novcs

Each command runs twice under strace (trace.py). From the first run:
- a path the command changed that existed before and that it read: an edit in
  place, so source;
- a path written by a command that read no source file: authored through a
  command, so source;
- anything else the command wrote: derived.
The second run says which outputs the same command reads back (a lockfile, or a
cache) and whether it rewrites them. For git repos the result is compared with
git's tracked and ignored sets, file by file; for novcs, with the intended labels.
Writes results-classes-<repo>.json. Disposable.
"""

import json
import os
import random
import subprocess
import sys
from collections import Counter
from pathlib import Path

from probe import CORPUS, ENV, HOME, OUT, REPOS, diff, git_lines, group, topmost, walk
from tracer import traced

NOVCS_BUILD = r"""
import { marked } from "marked"
import fs from "node:fs"
fs.mkdirSync("site/img", { recursive: true })
fs.mkdirSync(".cache", { recursive: true })
const done = {}
for (const f of fs.readdirSync("notes")) {
  const html = marked(fs.readFileSync(`notes/${f}`, "utf8"))
  fs.writeFileSync(`site/${f.replace(/\.md$/, ".html")}`, html)
  done[f] = html.length
}
for (const f of fs.readdirSync("images")) fs.copyFileSync(`images/${f}`, `site/img/${f}`)
fs.writeFileSync(".cache/build.json", JSON.stringify(done))
"""


def tool_write(root: Path, rel: str, data: bytes):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


NOVCS_STEPS = [
    ("tool", "write notes, images, a 50 MB asset, build.mjs, package.json", lambda r: [
        tool_write(r, "notes/plan.md", b"# Plan\n\nfoo and more\n"),
        tool_write(r, "notes/ideas.md", b"# Ideas\n\n- foo\n"),
        tool_write(r, "images/logo.png", random.Random(1).randbytes(200_000)),
        tool_write(r, "assets/scene.glb", random.Random(2).randbytes(50_000_000)),
        tool_write(r, "build.mjs", NOVCS_BUILD.encode()),
        tool_write(r, "package.json", b'{"name":"site","private":true,"type":"module","dependencies":{"marked":"^15.0.0"}}\n'),
    ]),
    ("cmd", "cat > notes/todo.md <<'EOF'\n# Todo\n\n- ship\nEOF"),
    ("cmd", "npm install --no-audit --no-fund"),
    ("cmd", "node build.mjs"),
    ("tool", "edit notes/plan.md", lambda r: tool_write(r, "notes/plan.md", b"# Plan\n\nfoo, edited\n")),
    ("cmd", "node build.mjs"),
    ("cmd", "sed -i 's/foo/bar/' notes/ideas.md"),
    ("tool", "add a dependency to package.json", lambda r: tool_write(r, "package.json", b'{"name":"site","private":true,"type":"module","dependencies":{"marked":"^15.0.0","yaml":"^2.0.0"}}\n')),
    ("cmd", "npm install --no-audit --no-fund"),
]
NOVCS_EXPECTED = [
    ("node_modules/", "derived"),
    ("site/", "derived"),
    (".cache/", "derived"),
    ("package-lock.json", "source"),
    ("notes/", "source"),
]


def inside(root: Path, paths) -> set[str]:
    r = str(root) + "/"
    return {p[len(r):] for p in paths if p.startswith(r)}


def classify_run(before, after, run, existed_source: set[str], root: Path, derived: set[str]):
    added, modified, deleted = diff(before, after)
    changed = [p for p in added + modified if after[p][0] != "d"]
    reads = inside(root, run["reads"])
    inputs = {p for p in reads if p in existed_source and p not in changed}
    out = {}
    for p in changed:
        if p in derived:
            out[p] = ("derived", "rewrote a derived file")
        elif p in before and p in reads:
            out[p] = ("source", "edited in place")
        elif not inputs:
            out[p] = ("source", "no source read")
        else:
            out[p] = ("derived", "made from source")
    return out, inputs, deleted


def run(name: str):
    root = CORPUS / f"{name}-classes"
    subprocess.run(["rm", "-rf", str(root)], check=True)
    if name == "novcs":
        root.mkdir(parents=True)
        steps = NOVCS_STEPS
        tracked = set()
    else:
        subprocess.run([*REPOS[name]["clone"], str(root)], check=True, env=ENV)
        steps = [("cmd", c) for c in REPOS[name]["commands"]]
        tracked = set(git_lines(root, ["ls-files", "-z"]))
    derived: set[str] = set()
    classes: dict[str, tuple[str, str, str]] = {}
    report = {"repo": name, "commands": []}
    for kind, label, *fn in [(s[0], s[1], *s[2:]) for s in steps]:
        before = walk(root, {".git"})
        if kind == "tool":
            fn[0](root)
            after = walk(root, {".git"})
            added, modified, _ = diff(before, after)
            for p in added + modified:
                if after[p][0] != "d":
                    classes[p] = ("source", "tool write", label)
            report["commands"].append({"step": label, "kind": "tool", "written": len(added) + len(modified)})
            continue
        existed_source = {p for p, v in before.items() if v[0] != "d" and p not in derived}
        r1 = traced(label, root, ENV)
        after = walk(root, {".git"})
        out, inputs, deleted = classify_run(before, after, r1, existed_source, root, derived)
        for p, (c, why) in out.items():
            classes[p] = (c, why, label)
            (derived.add if c == "derived" else derived.discard)(p)
        r2 = traced(label, root, ENV)
        after2 = walk(root, {".git"})
        a2, m2, d2 = diff(after, after2)
        read_back = sorted(inside(root, r2["reads"]) & set(out))
        home_reads = inside(HOME, r1["reads"]) | {f"(absent) {p}" for p in inside(HOME, r1["absent"]) if "config" in p or p.split("/")[-1].startswith(".")}
        entry = {
            "step": label,
            "exit": r1["exit"],
            "secondsTraced": r1["seconds"],
            "processes": r1["processes"],
            "classes": dict(Counter(c for c, _ in out.values())),
            "why": dict(Counter(w for _, w in out.values())),
            "inputsRead": sorted(inputs)[:15],
            "inputsReadCount": len(inputs),
            "derivedWhere": group([p for p, (c, _) in out.items() if c == "derived"], 2),
            "sourceWritten": sorted(p for p, (c, _) in out.items() if c == "source")[:15],
            "deleted": len(deleted),
            "secondRun": {"exit": r2["exit"], "seconds": r2["seconds"], "added": len(a2), "modified": len(m2), "deleted": len(d2),
                          "rewroteWhere": group([p for p in m2 if after2[p][0] != "d"], 2)},
            "outputsReadBack": group(read_back, 2),
            "homeReads": group(sorted(home_reads), 3),
            "projectAbsentProbes": sorted(p for p in inside(root, r1["absent"]) if "/" not in p)[:20],
        }
        if r1["exit"]:
            entry["stderr"] = r1["stderr"][-300:]
        report["commands"].append(entry)
        print(json.dumps(entry, indent=None)[:1800])

    # Compare with git (or the intended labels), file by file.
    if name == "novcs":
        def expected(p):
            for prefix, c in NOVCS_EXPECTED:
                if p == prefix or p.startswith(prefix):
                    return c
            return "source"
    else:
        ignored = set(git_lines(root, ["check-ignore", "-z", "--stdin", "--no-index"], "\0".join(classes)))
        def expected(p):
            if p in tracked:
                return "source"
            return "derived" if p in ignored else "untracked, not ignored"
    agree = Counter()
    disagree = []
    for p, (c, why, step) in classes.items():
        e = expected(p)
        if e == c:
            agree[c] += 1
        else:
            disagree.append((p, c, why, e, step))
    report["agreement"] = dict(agree)
    report["disagreements"] = len(disagree)
    groups = Counter((c, why, e, step, "/".join(p.split("/")[:2])) for p, c, why, e, step in disagree)
    report["disagreementGroups"] = [
        {"origin": c, "why": why, "git": e, "step": step, "where": where, "count": n} for (c, why, e, step, where), n in groups.most_common(40)
    ]
    print("agreement", report["agreement"], "disagreements", report["disagreements"])
    for g in report["disagreementGroups"][:20]:
        print("  ", g)
    (OUT / f"results-classes-{name}.json").write_text(json.dumps(report, indent=1) + "\n")


if __name__ == "__main__":
    for n in sys.argv[1:]:
        run(n)
