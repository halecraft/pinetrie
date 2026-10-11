#!/usr/bin/env python3
"""Probe C, part 2: what an install reads, against the recipe's declared inputs. Disposable.

    python3 inputs.py

Runs each install from a clean state under strace and lists, outside the derived
directories, the tracked files it read, the files under $HOME it read, and the
files it looked for and did not find (in the project and in $HOME). Writes
results-inputs.json.
"""

import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from observe import CORPUS, ENV, HOME, NM, sh  # noqa: E402
from tracer import traced  # noqa: E402

INSTALLS = {
    "pnpm install": ("pinetrie", NM, "pnpm install --frozen-lockfile", ["pnpm-lock.yaml"], ("node_modules/", "/node_modules/")),
    "cargo build": ("ripgrep", "cargo clean -q", "cargo build -q", ["Cargo.lock"], ("target/",)),
    "uv sync": ("flask", "rm -rf .venv", "uv sync -q", ["uv.lock"], (".venv/",)),
}


def rel(root: Path, paths):
    r = str(root) + "/"
    return {p[len(r) :] for p in paths if p.startswith(r)}


def main():
    out = {}
    for name, (repo, reset, cmd, declared, derived) in INSTALLS.items():
        root = CORPUS / repo
        tracked = set(subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, text=True).stdout.split("\0"))
        sh(reset, root)
        t = traced(cmd, root, ENV)
        not_derived = lambda p: not any(p.startswith(d) or d in p for d in derived)  # noqa: E731
        reads = rel(root, t["reads"])
        absent = rel(root, t["absent"])
        home_reads = rel(HOME, t["reads"])
        home_absent = rel(HOME, t["absent"])
        row = {
            "command": cmd,
            "declared": declared,
            "trackedRead": sorted(p for p in reads if p in tracked),
            "otherProjectRead": sorted(p for p in reads if p not in tracked and not_derived(p))[:20],
            "projectLookedForAbsent": sorted(p for p in absent if not_derived(p) and "/" not in p.rstrip("/"))[:40],
            "homeReadWhere": dict(Counter("/".join(p.split("/")[:3]) for p in home_reads).most_common(15)),
            "homeLookedForAbsent": sorted(p for p in home_absent if p.count("/") <= 2 and not p.startswith(".cache/"))[:40],
            "outsideRead": sorted({p for p in t["reads"] if not p.startswith(str(root)) and not p.startswith(str(HOME)) and p.startswith(("/etc/", "/workspace", "/kyneta"))})[:20],
        }
        out[name] = row
        print(name, json.dumps(row, indent=1))
    (HERE / "results-inputs.json").write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
