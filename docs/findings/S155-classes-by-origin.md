# S155 — A path's class follows from what wrote it and what that read, matching git on every file three real repos' commands wrote. Only a lockfile's first write, and what must stay local, need someone's intent; strace is too slow to trace every command

Numbered S151 until 2026-10-11, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0135, ADR-0142

**Question.** pine·trie's model gives each path in a state a class:
- **source:** authored;
- **derived:** a command wrote it, and rebuilding it is the default;
- **precious:** local, never sent.

Today git's ignore rules draw these lines. A project with no VCS has no
ignore rules. Can the class come from origin instead: which command wrote
the path, and what that command read?
1. In fresh clones of real repos, run the usual commands one at a time,
   and diff the disk around each one. Does each written path's class by
   origin match git's (tracked means source, ignored means derived)?
2. In a project with no VCS, where an agent writes some files and runs
   commands that write others, does the same rule give the intended
   classes?
3. Which signals that need no configuration exist besides origin?
4. What does it cost to know what a command read?

**Kill criterion.** The rule is "a command wrote it, and the path is not
tracked by the codec or listed by the person". If it needs more than one
short list a person can see and edit, classes by origin is not enough to
drop ignore files, and ignore files stay as the codec's input.

**Throw away.** The scripts and their output are kept in
`docs/findings/S155-classes-by-origin/`:
- `probe.py` runs each repo's commands with a stat walk of the repo and of
  `$HOME` around each. Its output is `results-<repo>.json`.
- `classify.py` runs each command twice under strace (`tracer.py`, which
  follows child processes and their working directories). It classifies
  every path the first run wrote, then compares the classes with git, or,
  for the project with no VCS, with the intended labels. Its output is
  `results-classes-<repo>.json`.
- The git repos' classify results predate one change to the rule: a
  derived file a later command rewrites stays derived. That change cannot
  alter their outcome, because no file in them was classified twice.

## The rule tested

A tool write (the agent's write or edit) is **source**. For a command, a
path it changed is:
- **derived**, if it was already derived (a rebuild rewriting its own
  output);
- **source**, if it existed before and the command read it: an edit in
  place, such as a formatter or `sed -i`;
- **source**, if the command read no source file: authoring through a
  command, such as `cat > notes.md`;
- **derived**, otherwise: made from source.

## Answers

Run in a lane (Debian 13, arm64, 16 cores), on fresh clones in
`/workspace/sandbox/probes/corpus/`, with `HOME` pointed at
`/workspace/sandbox/probes/home` so that its writes could be walked:
- **pine·trie**, cloned from this lane's repo on 2026-10-11;
- **ripgrep** (`BurntSushi/ripgrep`, its default branch, depth 1);
- **flask** (`pallets/flask`, its default branch, depth 1, which uses uv).

1. **The rule matched git on every file the commands wrote: 29,712 of
   29,712.**

   | repo | commands | files written | as git says |
   |---|---|---|---|
   | pine·trie | `pnpm install`, `typecheck`, `lint`, `format`, `record`, `build`, `vitest` | 20,074 | 20,074 derived |
   | ripgrep | `cargo build`, `cargo test`, `cargo fmt`, `cargo build --release` | 822 | 822 derived |
   | flask | `uv sync`, `pytest`, `uv build`, `ruff format` | 8,816 | 8,815 derived; `README.md`, which `ruff format` edited in place, source |

   - Every command that made derived files read source to do it, from 5
     files (`uv sync`) to 1,180 (`pnpm run record`).
   - Derived files are scattered through the source tree, not only at the
     top: pnpm wrote `packages/*/node_modules/`, and Python wrote
     `__pycache__/` beside every module.
   - A formatter edits tracked files in place, and the rule calls that
     source. In flask, `ruff format` reformatted `README.md`. In pine·trie,
     in `probe.py`'s run, `biome format` rewrote one JSON file, written
     earlier in this thread, that had never been formatted.
2. **With no VCS, the rule got every path right except the lockfile.** A
   script played an agent:
   - it wrote notes, an image, a 50 MB asset, `build.mjs` and
     `package.json`;
   - it ran `cat > notes/todo.md`, `npm install`, `node build.mjs` (twice,
     around an edit), and `sed -i` on a note;
   - it then added a dependency and ran `npm install` again.

   The results: 7 source paths and 257 derived ones as intended. The notes,
   including the one written by `cat` and the one edited by `sed`, are
   source. `node_modules/`, `site/` and `.cache/` are derived.

   **`package-lock.json` came out derived:** `npm install` made it from
   `package.json`. Nothing in the system calls tells it apart from a cache:
   - the next `npm install` read back both `package-lock.json` and
     `node_modules/.package-lock.json`, and rewrote both;
   - `cargo build` likewise reads back 141 files of `target/`, and `uv
     sync` reads back `.venv/`.

   A lockfile is source only because people keep it. In a git repo the
   tracked set says so. A lockfile that is updated rather than created is
   rewriting a file that is already source, so it stays source. Only the
   first write needs intent from somewhere.

   **What must stay local is invisible to origin too.** The person's own
   working copy holds ignored paths that no command wrote:
   - `.pinetrie/`: pine·trie's own database, 0.8 GB, with eight backups
     taken before migrations;
   - `sandbox/`: scratch scripts written by hand;
   - `e2e/browser-screenshot.png`: output of a test that no longer writes
     there.

   Origin calls the first two source, and they must not be sent anywhere.
   That is the second list.
3. **Tools mark their own output, but not in JavaScript.** Cargo writes
   `target/CACHEDIR.TAG` (the Cache Directory Tagging specification). uv,
   pytest and ruff write `CACHEDIR.TAG` and a `.gitignore` of `*` into
   `.venv/`, `.pytest_cache/` and `.ruff_cache/`. `uv build` writes
   `dist/.gitignore`. pnpm, npm, vite and vitest write neither in
   `node_modules/`, `dist/` or `node_modules/.vite/`. The markers confirm
   what origin finds; they cannot replace it.
4. **strace is too slow to trace every command; reading the outputs costs
   nothing.**

   | command | untraced | under strace |
   |---|---|---|
   | `pnpm run build` (vite) | 2.5 s | 183.5 s (73×) |
   | `vitest run`, two packages | 3.6 s | 36.4 s (10×) |
   | `pnpm run typecheck` | 11.2 s | 12.1 s |
   | `pnpm install`, store warm | 1.0 s | 1.8 s |

   This was with `--seccomp-bpf`, tracing 17 file and process calls. The
   rule needs the reads only to tell "made from source" apart from
   "authored through a command", and "an edit in place" apart from "made
   from source". The writes come from the disk diff around the command
   (S146's `send` diff in a lane), at no cost to the command. Cheaper ways
   to get reads (fanotify from lanehost's privileged role, `LD_PRELOAD`,
   atime) are probe C's question.

**Inputs outside the project.** The traces show what each command read, or
looked for, outside the repo:
- **pnpm:** looked for `~/.npmrc`, `~/.config/pnpm/rc` and `.npmrc`, none
  present, and read corepack's cache.
- **cargo:** read `~/.cargo/registry/` and the toolchain under
  `~/.rustup/`, and looked for `~/.cargo/config`, `rust-toolchain.toml` and
  `~/.config/git/config`.
- **uv:** read `~/.cache/uv/` and looked for `uv.toml` and
  `~/.config/uv/uv.toml`.

A recipe's key built from its lockfiles misses every one of them. pine·trie
itself depends on files outside its folder: `packages/web/package.json`
links `@kyneta/*` from `../../../kyneta/`. A fresh clone does not
typecheck, test or build until that path exists. So a state of pine·trie
is not the whole input to its own build.

**Against the kill criterion.** It does not fire. Origin draws the line
between source and derived for every file in three ecosystems, and needs
two short lists, both statements of intent:
- **outputs that are kept** (a lockfile at its first write);
- **paths that stay local** (pine·trie's own state, scratch, secrets).

In a project with a VCS, the codec supplies both: the tracked set says what
is kept, and the ignore rules say what stays local. In a project without
one, the person or the agent writes them, and they are short:
`package-lock.json`, `.env`, a scratch folder.

**What this leaves open:**
- **Commands that overlap.** Attribution here rests on commands running one
  at a time, which is how an agent's commands run, except for background
  processes. A dev server or a watcher started in one turn writes during
  later ones, and a diff around a command attributes its writes to that
  command. A tracer attached to the command sees only its own processes.
- **Ordering.** The rule reads a command's reads as a set. A command that
  writes a file and then reads it back is not an edit in place, and the
  rule as run does not see the order, because it checks only whether the
  file existed before.
