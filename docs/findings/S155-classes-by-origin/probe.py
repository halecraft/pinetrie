#!/usr/bin/env python3
"""Probe A: what each of a project's usual commands writes, against what git ignores.

    python3 probe.py <repo> [<repo> ...]      # repos: pinetrie, ripgrep, flask

Clones each repo fresh under $PROBES/corpus, runs its commands one at a time,
and stat-walks the repo and $HOME around each. Writes results-<repo>.json and
prints a summary. Disposable.
"""

import json
import os
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

PROBES = Path("/workspace/sandbox/probes")
HOME = PROBES / "home"
CORPUS = PROBES / "corpus"
OUT = Path(__file__).resolve().parent

ENV = {
    **os.environ,
    "HOME": str(HOME),
    "PATH": f"{HOME}/.cargo/bin:{HOME}/.local/bin:{os.environ['PATH']}",
    "CI": "1",
}

REPOS = {
    "pinetrie": {
        "clone": ["git", "clone", "-q", "/workspace"],
        "commands": [
            "pnpm install --frozen-lockfile",
            "pnpm run typecheck",
            "pnpm run lint",
            "pnpm run format",
            "pnpm run record",
            "pnpm run build",
            "pnpm exec vitest run packages/rules packages/interface",
        ],
    },
    "ripgrep": {
        "clone": ["git", "clone", "-q", "--depth", "1", "https://github.com/BurntSushi/ripgrep"],
        "commands": ["cargo build", "cargo test -q", "cargo fmt", "cargo build --release"],
    },
    "flask": {
        "clone": ["git", "clone", "-q", "--depth", "1", "https://github.com/pallets/flask"],
        "commands": ["uv sync", "uv run pytest -q -x", "uv build", "uvx ruff format ."],
    },
}


def walk(root: Path, skip: set[str]) -> dict[str, tuple]:
    out = {}
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            it = list(os.scandir(d))
        except (FileNotFoundError, PermissionError):
            continue
        for e in it:
            rel = os.path.relpath(e.path, root)
            if rel in skip:
                continue
            try:
                s = e.stat(follow_symlinks=False)
            except FileNotFoundError:
                continue
            if e.is_dir(follow_symlinks=False):
                out[rel] = ("d",)
                stack.append(Path(e.path))
            else:
                kind = "l" if e.is_symlink() else "f"
                out[rel] = (kind, s.st_ino, s.st_size, s.st_mtime_ns, s.st_mode)
    return out


def diff(before, after):
    added = [p for p in after if p not in before]
    deleted = [p for p in before if p not in after]
    modified = [p for p, v in after.items() if p in before and before[p] != v and v[0] != "d"]
    return added, modified, deleted


def topmost(paths: list[str]) -> list[str]:
    """The paths with none of their ancestors also in the list."""
    s = set(paths)
    out = []
    for p in sorted(paths):
        parts = p.split("/")
        if not any("/".join(parts[:i]) in s for i in range(1, len(parts))):
            out.append(p)
    return out


def group(paths: list[str], depth: int) -> dict[str, int]:
    c = Counter("/".join(p.split("/")[:depth]) for p in paths)
    return dict(c.most_common(25))


def git_lines(repo: Path, args: list[str], stdin: str | None = None) -> list[str]:
    r = subprocess.run(["git", *args], cwd=repo, input=stdin, capture_output=True, text=True)
    return [x for x in r.stdout.split("\0") if x]


def classify(repo: Path, tracked: set[str], paths: list[str]) -> dict[str, list[str]]:
    ignored = set(git_lines(repo, ["check-ignore", "-z", "--stdin", "--no-index"], "\0".join(paths)))
    out = defaultdict(list)
    for p in paths:
        if p in tracked:
            out["tracked"].append(p)
        elif p in ignored:
            out["ignored"].append(p)
        else:
            out["untracked, not ignored"].append(p)
    return out


def run(name: str):
    spec = REPOS[name]
    repo = CORPUS / name
    subprocess.run(["rm", "-rf", str(repo)], check=True)
    subprocess.run([*spec["clone"], str(repo)], check=True, env=ENV)
    tracked = set(git_lines(repo, ["ls-files", "-z"]))
    tracked_dirs = {"/".join(p.split("/")[:i]) for p in tracked for i in range(1, p.count("/") + 1)}
    result = {"repo": name, "head": git_lines(repo, ["rev-parse", "HEAD"]), "trackedFiles": len(tracked), "commands": []}
    for cmd in spec["commands"]:
        rb, hb = walk(repo, {".git"}), walk(HOME, set())
        t0 = time.time()
        r = subprocess.run(cmd, shell=True, cwd=repo, env=ENV, capture_output=True, text=True)
        secs = round(time.time() - t0, 1)
        ra, ha = walk(repo, {".git"}), walk(HOME, set())
        added, modified, deleted = diff(rb, ra)
        # Directories that existed in git's view are not the command's output.
        added_files = [p for p in added if ra[p][0] != "d" or p not in tracked_dirs]
        written = added_files + modified
        cls = classify(repo, tracked, written + deleted)
        h_added, h_modified, h_deleted = diff(hb, ha)
        entry = {
            "command": cmd,
            "exit": r.returncode,
            "seconds": secs,
            "stderrTail": r.stderr[-600:] if r.returncode else "",
            "added": len(added_files),
            "modified": len(modified),
            "deleted": len(deleted),
            "byClass": {k: len(v) for k, v in cls.items()},
            "tracked": {
                "modified": [p for p in modified if p in tracked],
                "deleted": [p for p in deleted if p in tracked],
            },
            "ignoredTopmost": topmost(cls.get("ignored", []))[:40],
            "ignoredWhere": group(cls.get("ignored", []), 2),
            "untrackedNotIgnored": topmost(cls.get("untracked, not ignored", []))[:40],
            "home": {
                "added": len(h_added),
                "modified": len(h_modified),
                "deleted": len(h_deleted),
                "where": group(h_added + h_modified + h_deleted, 3),
            },
        }
        result["commands"].append(entry)
        print(json.dumps({k: entry[k] for k in ("command", "exit", "seconds", "added", "modified", "deleted", "byClass")}))
        print("  tracked changed:", entry["tracked"])
        print("  ignored where:", entry["ignoredWhere"])
        print("  untracked, not ignored:", entry["untrackedNotIgnored"][:12])
        print("  home:", entry["home"])
        if r.returncode:
            print("  stderr:", entry["stderrTail"][-300:])
    (OUT / f"results-{name}.json").write_text(json.dumps(result, indent=1) + "\n")


if __name__ == "__main__":
    for n in sys.argv[1:] or list(REPOS):
        run(n)
