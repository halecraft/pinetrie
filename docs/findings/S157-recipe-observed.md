# S157 — A command's reads can be watched for free with inotify or fsatrace, and every lockfile-only key misses real inputs; running a recipe again gives the same bytes only up to timestamps and the absolute path, which every lane shares

Numbered S153 until 2026-10-11, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** ADR-0131 names a recipe's output by a key: the recipe, its
declared inputs' content, the image and the build's version. pine·trie's
own recipe declares `pnpm-lock.yaml` alone (`decodeLaneConfig` in
`packages/lanes/plan.ts`). S155 classified paths by what each command read,
using strace, and found strace far too slow to run on every command. Can a
recipe and its inputs be learned by watching instead of declared?
1. **Watching.** Which way of seeing a command's reads is cheap enough to
   run every time, works without privilege in a lane, and sees the same
   source files strace does? The candidates:
   - fsatrace, with `LD_PRELOAD`;
   - inotify `IN_OPEN` on every directory;
   - atime, under the lane's `relatime` mount;
   - fanotify.
2. **Inputs.** What does each install actually read, against the one
   lockfile it declares?
3. **Replay.** Does running a recipe on a fresh copy give the same bytes,
   at the same path and at another path? Where it does not, why not?

**Kill criterion.**
- If every way of watching costs more than twice an untraced run, a
  recipe's key stays declared (`installWhen`).
- If replays differ beyond timestamps, "derived" cannot be checked by
  comparing bytes, and rests on origin alone (S155).

**Throw away.** The scripts and their output are kept in
`docs/findings/S157-recipe-observed/`:
- `observe.py` runs each command four times from the same state:
  untraced; under strace (S155's `tracer.py`, the ground truth); under
  fsatrace; and with inotify and atime watching together. It writes
  `results-observe.json`.
- `inputs.py` lists what each install read under strace. It writes
  `results-inputs.json`.
- `replay.py` runs each recipe on three fresh clones, two at one path and
  one at another, and compares the outputs file by file. It writes
  `results-replay.json`.

Run in a lane (Debian 13, arm64, 16 cores), with no added capability, on
S155's corpus. fsatrace was built from `jacereda/fsatrace` (its default
branch, 2026-10-11). Caches were warm (pnpm's store, cargo's registry,
uv's cache), as they are between a lane's runs.

## Answers

1. **inotify, atime and fsatrace each saw every tracked file strace saw
   read, at no measurable cost. fanotify is refused.**

   | command | untraced | strace | fsatrace | inotify + atime | tracked files read (strace) | seen by all three |
   |---|---|---|---|---|---|---|
   | `pnpm install`, store warm | 1.06 s | 1.70 s | 0.98 s | 0.97 s | 22 | 22 |
   | `tsc` (typecheck) | 11.9 s | 13.2 s | 12.0 s | 12.0 s | 878 | 878 |
   | `vite build` | 2.81 s | 57.2 s (20×) | 2.56 s | 2.57 s | 331 | 331 |
   | `vitest`, two packages | 3.94 s | 7.3 s | 3.85 s | 3.90 s | 354 | 354 |
   | `cargo build` | 3.36 s | 3.50 s | 3.28 s | 3.30 s | 99 | 98 |
   | `uv sync`, cache warm | 0.17 s | 1.1 s (6.5×) | 0.25 s | 0.25 s | 2 | 2 |
   | `pytest` | 0.96 s | 0.90 s | 0.66 s | 0.74 s | 33 | 33 |

   - **The one miss** in `cargo build` is `HomebrewFormula`, a tracked
     symlink. strace reported it by the name opened; the others reported
     its target.
   - **inotify needed** 63 to 2,962 watches, against a limit of 96,622.
     Its queue never overflowed (the limit is 16,384 events).
   - **Resetting atime** on every project file took at most 50 ms.
   - **fanotify is refused:** `fanotify_init` fails with `EPERM`, even with
     `FAN_REPORT_FID`, which the kernel allows without privilege. Docker's
     default seccomp profile allows the call only with `CAP_SYS_ADMIN`.
   - **They differ in what they cannot see:**
     - **inotify and atime** see every process in the lane: static binaries
       too, but also a background process, which they cannot tell from the
       command (S155's open question).
     - **atime** also changes every file's ctime, which tools that cache by
       stat data notice: git's index, for one.
     - **fsatrace** sees only the command's own processes, but nothing a
       statically linked binary reads. Here that cost nothing: vite reads
       through Node and its native addons, and rustc and uv link
       dynamically.
     - **None of the three** sees a lookup that found nothing. That is how
       `.npmrc` is consulted (answer 2).
     - **The "all project files" columns of `results-observe.json`** are
       lower for inotify and atime than for fsatrace. That is the files the
       command itself created and read back, under directories that did not
       exist when the watching began: outputs, not inputs.
2. **Every install reads more than its declared lockfile.**
   - **`pnpm install` (declares `pnpm-lock.yaml`)** read 22 tracked files:
     the lockfile, `pnpm-workspace.yaml`, and all 20 `package.json` files.
     - It looked for `.npmrc`, `.corepack.env`, `~/.npmrc` and
       `~/.config/pnpm/rc`, none present. An `.npmrc` that appears changes
       the install: its registry, `node-linker`, hoisting.
     - It read 11 `package.json` files outside the repo, through
       `../../../kyneta` (S155).
     - It read 17,621 files of the store under `~/.local/share/pnpm`.
   - **`cargo build` (`Cargo.lock`)** read all 99 tracked sources it
     compiles, as a build must. It also read ripgrep's
     `.git/HEAD`, `.git/index` and its refs, because ripgrep's build script
     embeds the revision. That makes the VCS itself an input. It looked for
     `rust-toolchain(.toml)`, `~/.cargo/config`, `~/.gitconfig` and
     `~/.config/git/config`, and read the toolchain under `~/.rustup/`.
   - **`uv sync` (`uv.lock`)** read `pyproject.toml` as well as the
     lockfile, and `/etc/os-release`. It looked for `uv.toml` and
     `~/.config/uv/uv.toml`.
3. **The same path gives the same bytes, except timestamps. Another path
   does not.**

   | recipe | files | differ, same path | why | differ, other path | why |
   |---|---|---|---|---|---|
   | `pnpm install` | 19,985 | 2 | `.modules.yaml`'s `prunedAt` time, and one file naming the run's path | 66 | 65 hold the absolute path (bin shims, `.modules.yaml`) |
   | `vite build` | 2 | 0 | | 0 | |
   | `cargo build` | 370 | 4 | fingerprints that record a source file's mtime | 82 | 76 hold the path (`.d`, `.rlib`, `.rmeta`); 6 are fingerprints |
   | `cargo build --release` (`rg`) | 1 | 0 | | 1 | the path, in the binary |
   | `uv sync` | 8,523 | 2 | `uv_cache.json`'s timestamps, and flask's own `RECORD` | 40 | 27 hold the path (script shebangs); 13 are `RECORD` files, whose hashes are of those scripts |

   - **The kill criterion fires** in the plain sense. Replays differ beyond
     timestamps, because outputs embed the absolute path, directly or
     through a hash of a file that does. So "derived" is decided by origin
     (S155), not by comparing bytes.
   - **Within pine·trie it barely matters.** Every lane mounts its disk at
     `/workspace`, so every run of a recipe in any lane is a same-path run.
     What differs then is timestamps alone. An output named by its key is
     interchangeable between lanes, up to those timestamps.

**Against the kill criteria.**
- **The first does not fire.** Watching costs nothing measurable, by
  inotify (with atime as a cross-check) or fsatrace. So a recipe's key can
  be learned, not declared.
- **The second fires,** and changes nothing: S155 already rests "derived"
  on origin. Reproducibility at `/workspace` is what makes an output named
  by its key safe to share.

**What a learned key would be.**
- **The content of every source file the recipe read.** That is the
  `package.json` files and `pnpm-workspace.yaml` for pnpm, and
  `pyproject.toml` for uv. Every lockfile-only key here misses some.
- **Plus the presence or absence of every config file it looked for.**
  Only strace saw those lookups. Learning them once, under strace, costs
  little for an install (1.6× for pnpm, about a second for uv), unlike a
  build. A later run whose watched reads leave that set (a new
  `package.json`, say) would learn them again.
- **Plus what is outside the project.** That is the image, `$HOME`'s
  config, and paths outside the repo, such as pine·trie's `../kyneta`.
  smart-dolphin's open point stands: putting `$HOME` on the lane's disk is
  the general fix for `$HOME`.

**Open.**
- **Choosing between inotify and fsatrace:** whole-lane visibility against
  per-process attribution. That depends on how background processes are
  handled, which S155 left open.
- **Whether learning lookups by strace, once per change to the set of
  inputs, holds up** across more ecosystems than these three.
