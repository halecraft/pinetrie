# S88 — rg, fd and sd for every lane, and how they behave as tools

`PLAN-2026-10-03-lane-search` gives every lane of its own `rg`, `fd` and `sd`
through the lane runtime (S44), and gives the agent `grep` and `find` tools
that run them. pi's prompt already told every lane to "use bash for file
operations like ls, rg, find", and no lane had `rg`. This records the probes
the plan rests on, run in a lane on Debian trixie (aarch64), against Pineta's
own repo at `/workspace`.

**Answers.**

1. **Static musl builds exist for all three.** The release assets
   `ripgrep-15.2.0-aarch64-unknown-linux-musl.tar.gz`,
   `fd-v10.5.0-aarch64-unknown-linux-musl.tar.gz` and
   `sd-v1.1.0-aarch64-unknown-linux-musl.tar.gz` each hold one binary, in a
   directory named as the archive. `ldd` says "not a dynamic executable" for
   each, so they run on musl and glibc images alike, as jj does. Sizes: rg
   4.5 MB, fd 3.1 MB, sd 2.0 MB.
2. **sd 1.1.0 reports itself as `sd 1.0.0`** (`sd --version`). Do not check
   its version by that string.
3. **Debian's builds cannot be carried.** trixie's `ripgrep` 14.1.1 links
   `libpcre2-8` and `libgcc_s`, and `fd-find` 10.2.0 links `libgcc_s`; fd
   installs as `fdfind`. Copied into the runtime, they would not start on a
   musl image.
4. **Exit codes differ.**
   - `rg`: 0 with matches, 1 with none, 2 on an error. A bad regex (`x(`) and
     a missing path both exit 2, with the message on stderr.
   - `fd`: 0 when it ran, with or without results. A search path that is not a
     directory exits 1 (`[fd error]: Search path 'nope' is not a directory.`).
5. **fd matches a glob against the basename** unless `--full-path` is given.
   With `--full-path` it matches the absolute path, so `**/e2e/lanes/*.ts`
   matches and `e2e/lanes/*.ts` alone does not. pi's own `find` prefixes
   `**/` for this reason (`pi-coding-agent/dist/core/tools/find.js`).
6. **Ignored paths are skipped unless named.** From `/workspace`, `rg --hidden
   -l .` and `fd --hidden -t f` list 630 files each, none under
   `node_modules/`, `.plans/` (gitignored, and a shared directory), `.git/`
   or `.jj/`. Naming the directory as the search path searches it: `rg -l .
   .plans` and `fd . .plans` list its files.
7. **`--max-columns 300 --max-columns-preview`** keeps a long line's start
   and marks the rest omitted; with `-n --no-heading --with-filename`, a match
   prints as `path:12:text` and a context line as `path-11-text`.
8. **pi's `ensureTool`** (`pi-coding-agent/dist/utils/tools-manager.js`,
   0.87.1) returns a path in pi's bin directory when the program is there,
   else a bare name for one on `PATH` (fd also as `fdfind`), else downloads
   the release for the platform into that directory. It honours `PI_OFFLINE` and returns `undefined`
   when it cannot. Its `getToolPath` runs `spawnSync <program> --version` on
   every call. It is not in pi-coding-agent's export map.
9. **`env.exec`'s capture keeps the head on request** (`retain: "head"`,
   `ShellOutputLimits` in pi-agent-core's `harness/types.d.ts`), and does not
   stop the process when the limit is crossed: rg runs to its end.
