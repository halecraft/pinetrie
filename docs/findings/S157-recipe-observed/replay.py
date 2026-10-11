#!/usr/bin/env python3
"""Probe C, part 3: does running a recipe again on a fresh copy give the same bytes? Disposable.

    python3 replay.py [task ...]

For each task: clone the repo fresh to path A, run the recipe (after any setup),
and hash its outputs; move the clone away, clone again to the same path A, run it
again; then clone to another path B and run it a third time. Outputs are compared
file by file (type, permission bits, content or symlink target). A file that
differs is put down to the absolute path if it contains A's or B's path, and
listed otherwise. Caches (pnpm's store, cargo's registry, uv's cache) stay warm,
as they would between a lane's runs. Writes results-replay.json.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from observe import CORPUS, ENV  # noqa: E402

BASE = Path("/workspace/sandbox/probes/replay")
TASKS = {
    "pnpm install": ("pinetrie", "true", "pnpm install --frozen-lockfile", ["node_modules", "packages/web/node_modules"]),
    "vite build": ("pinetrie", "pnpm install --frozen-lockfile", "pnpm run build", ["packages/web/dist"]),
    "cargo build": ("ripgrep", "true", "cargo build -q", ["target/debug/rg", "target/debug/deps", "target/debug/build", "target/debug/.fingerprint"]),
    "cargo build --release": ("ripgrep", "true", "cargo build -q --release", ["target/release/rg"]),
    "uv sync": ("flask", "true", "uv sync -q", [".venv"]),
}


def tree(root: Path, outs: list[str]) -> dict[str, tuple]:
    res = {}
    for o in outs:
        p = root / o
        items = [p] if p.is_file() or p.is_symlink() else [Path(d) / f for d, ds, fs in os.walk(p) for f in fs + [x for x in ds if (Path(d) / x).is_symlink()]]
        for f in items:
            r = str(f.relative_to(root))
            st = os.lstat(f)
            if os.path.islink(f):
                res[r] = ("l", os.readlink(f))
            else:
                res[r] = ("f", oct(st.st_mode & 0o777), hashlib.sha256(f.read_bytes()).hexdigest())
    return res


def run_at(where: Path, repo: str, setup: str, cmd: str, outs):
    if where.exists():
        shutil.rmtree(where)
    where.parent.mkdir(parents=True, exist_ok=True)
    kyneta = where.parent / "kyneta"
    if not kyneta.exists():
        kyneta.symlink_to("/kyneta")
    subprocess.run(["git", "clone", "-q", str(CORPUS / repo), str(where)], check=True)
    for c in (setup, cmd):
        r = subprocess.run(c, shell=True, cwd=where, env=ENV, capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(f"{c}: {r.stderr[-400:]}")
    return tree(where, outs)


def compare(x: dict, y: dict, roots: list[Path], ry: Path):
    diff = sorted(set(x) ^ set(y)) + sorted(p for p in set(x) & set(y) if x[p] != y[p])
    causes = Counter()
    other = []
    for p in diff:
        if p not in x or p not in y:
            causes["present in one only"] += 1
            other.append(p)
            continue
        f = ry / p
        data = f.read_bytes() if not os.path.islink(f) else os.readlink(f).encode()
        if any(str(r).encode() in data for r in roots):
            causes["contains the absolute path"] += 1
        elif x[p][0] == "f" and y[p][0] == "f" and x[p][1] != y[p][1]:
            causes["mode"] += 1
        else:
            causes["other"] += 1
            other.append(p)
    return {"files": len(x), "differ": len(diff), "causes": dict(causes), "otherSample": other[:15]}


def main():
    out = {}
    for name in sys.argv[1:] or list(TASKS):
        repo, setup, cmd, outs = TASKS[name]
        a, b = BASE / "a" / repo, BASE / "b" / "elsewhere" / repo
        first = run_at(a, repo, setup, cmd, outs)
        moved = BASE / "a" / f"{repo}-first"
        if moved.exists():
            shutil.rmtree(moved)
        a.rename(moved)
        second = run_at(a, repo, setup, cmd, outs)
        third = run_at(b, repo, setup, cmd, outs)
        out[name] = {
            "samePath": compare(first, second, [a, moved], a),
            "otherPath": compare(second, third, [a, b], b),
        }
        print(name, json.dumps(out[name]))
        shutil.rmtree(moved)
    (HERE / f"results-replay.json").write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
