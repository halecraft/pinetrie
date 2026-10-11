#!/usr/bin/env python3
"""S158, part 2: can a key stand in for the lookups strace sees, with directory listings? Disposable.

    python3 keys.py

1. A glob: `build2.mjs` lists notes/ and renders each note. After it runs, a new
   note is added. Does the key still hold (a stale output carried) or break?
2. For S157's recipes and builds, every lookup strace saw fail (outside derived
   directories and $HOME's caches), and whether the listing of its directory is in
   the key, under three rules:
   - opened: directories the command listed;
   - parents: those, plus each read file's directory;
   - ancestors: those, plus every directory above them, up to the project or $HOME.
   A lookup counts as covered when the listing of the deepest directory on its
   path that exists is in the key: creating the file changes that listing. Lookups
   under $HOME are listed apart, for a key that includes $HOME's configuration whole.
   And how many listings each rule puts in the key: each is a way an unrelated new
   file breaks it.
Writes results-keys.json.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from tracer2 import traced  # noqa: E402

PROBES = Path("/workspace/sandbox/probes")
HOME = PROBES / "home"
CORPUS = PROBES / "corpus"
ENV = {**os.environ, "HOME": str(HOME), "PATH": f"{HOME}/.cargo/bin:{HOME}/.local/bin:{os.environ['PATH']}", "CI": "1"}
NM = "rm -rf node_modules packages/*/node_modules apps/*/node_modules"
DERIVED = ("node_modules", ".venv", "target", "dist", ".pytest_cache")
HOME_CACHES = (".cache/", ".local/share/pnpm", ".cargo/registry", ".rustup/toolchains", ".npm/")

RECIPES = {
    "pnpm install": ("pinetrie", NM, "pnpm install --frozen-lockfile"),
    "vite build": ("pinetrie", "rm -rf packages/web/dist", "pnpm run build"),
    "cargo build": ("ripgrep", "cargo clean -q", "cargo build -q"),
    "uv sync": ("flask", "rm -rf .venv", "uv sync -q"),
    "pytest": ("flask", "true", "uv run pytest -q -x"),
}


def scope(p: str, root: Path):
    """('project'|'home', relative path), or None outside both or inside derived files and caches."""
    for base, name in ((root, "project"), (HOME, "home")):
        b = str(base) + "/"
        if p.startswith(b):
            r = p[len(b) :]
            if name == "project" and any(part in DERIVED for part in r.split("/")):
                return None
            if name == "home" and r.startswith(HOME_CACHES):
                return None
            return name, r
    return None


def listing_sets(t: dict, root: Path):
    opened = {p for p in t["dirs"] if scope(p + "/x", root)}
    parents = opened | {os.path.dirname(p) for p in t["reads"] if scope(p, root)}
    ancestors = set(parents)
    for d in parents:
        for base in (str(root), str(HOME)):
            if d == base or d.startswith(base + "/"):
                x = d
                while x != base and x.startswith(base):
                    x = os.path.dirname(x)
                    ancestors.add(x)
    return {"opened": opened, "parents": parents, "ancestors": ancestors}


def glob_case():
    root = PROBES / "c2-glob"
    if root.exists():
        shutil.rmtree(root)
    (root / "notes").mkdir(parents=True)
    (root / "notes/a.md").write_text("a\n")
    (root / "notes/b.md").write_text("b\n")
    (root / "build2.mjs").write_text(
        'import fs from "node:fs"\nfs.mkdirSync("site2", { recursive: true })\n'
        'for (const n of fs.readdirSync("notes")) fs.writeFileSync(`site2/${n}.html`, fs.readFileSync(`notes/${n}`, "utf8"))\n'
    )
    t = traced("node build2.mjs", root, ENV)
    reads = sorted(p for p in t["reads"] if p.startswith(str(root) + "/"))
    sets = listing_sets(t, root)

    def key(rule: str | None) -> str:
        h = hashlib.sha256()
        for p in reads:
            h.update(p.encode() + b"\0" + (Path(p).read_bytes() if os.path.exists(p) else b"<absent>"))
        if rule:
            for d in sorted(sets[rule]):
                h.update(d.encode() + b"\0" + "\0".join(sorted(os.listdir(d))).encode() if os.path.isdir(d) else b"")
        return h.hexdigest()

    before = {r: key(r) for r in (None, "opened", "parents", "ancestors")}
    (root / "README.md").write_text("unrelated\n")
    after_unrelated = {r: key(r) for r in before}
    (root / "notes/c.md").write_text("c\n")
    after_new_note = {r: key(r) for r in before}
    name = lambda r: r or "readsOnly"  # noqa: E731
    out = {
        "newNoteBreaksKey": {name(r): after_unrelated[r] != after_new_note[r] for r in before},
        "unrelatedFileBreaksKey": {name(r): before[r] != after_unrelated[r] for r in before},
    }
    print("glob", out)
    return out


def recipe_case(name: str):
    repo, reset, cmd = RECIPES[name]
    root = CORPUS / repo
    subprocess.run(reset, shell=True, cwd=root, env=ENV, capture_output=True)
    t = traced(cmd, root, ENV)
    sets = listing_sets(t, root)
    absent = sorted({p for p in t["absent"] if scope(p, root)})
    project = [p for p in absent if scope(p, root)[0] == "project"]
    home = [p for p in absent if scope(p, root)[0] == "home"]

    def nearest_existing(p: str) -> str:
        d = os.path.dirname(p)
        while not os.path.isdir(d):
            d = os.path.dirname(d)
        return d

    row = {"exit": t["exit"], "lookupsFailedInProject": len(project), "lookupsFailedInHome": [scope(p, root)[1] for p in home]}
    for rule, dirs in sets.items():
        dirs = dirs | {str(root)} if rule == "ancestors" else dirs
        uncovered = [p for p in project if nearest_existing(p) not in dirs]
        row[rule] = {
            "listingsInKey": len(dirs),
            "projectLookupsCovered": len(project) - len(uncovered),
            "uncovered": [scope(p, root)[1] for p in uncovered][:12],
        }
    print(name, json.dumps(row))
    return row


def main():
    out = {"glob": glob_case()}
    for name in RECIPES:
        out[name] = recipe_case(name)
    (HERE / "results-keys.json").write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
