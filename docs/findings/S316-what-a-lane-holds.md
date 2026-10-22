# S316 — Between tool calls a lane holds almost no memory of its own, only cache: its peaks are its commands', up to 2.7 GiB for pine·trie's typecheck

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** A person runs 4 to 20 threads at once, each in a lane limited
to 4 GiB (`LANE_MEMORY`). Admitting runs by their limits would allow two on
a 12 GiB VM (S309). What does a lane actually hold, and when: idle between
tool calls, while it installs, tests and typechecks, and with a dev server
left running? That decides how many lanes fit when they are admitted by
use and pressure instead.

**Kill criterion.** None: a measurement. It counts against admitting by use
if an idle lane holds most of its limit in memory the kernel cannot reclaim.

**Throw away.** The spike VM and its container. Kept in
`docs/findings/S316-what-a-lane-holds/`: `phases.sh`, the lane's work in
phases, sampling its own cgroup every 0.5 s; `peaks.txt`, the result.

## Answers

Measured on 2026-10-21 in the spike VM (S308's harness: 8 GiB, 8 CPUs) in
a `node:24-bookworm` container with `--memory 4g`, pine·trie's tracked
files at `/workspace`. `anon` is memory only swap or an exit frees; `file`
is page cache, which reclaim frees.

| phase | peak | anon at most | file at most | after the phase |
|---|---|---|---|---|
| idle, fresh | 50 MiB | 0 | 35 MiB | 50 MiB |
| `pnpm install --frozen-lockfile` | 1,375 MiB | 762 MiB | 513 MiB | 632 MiB |
| idle after it | 632 MiB | 0 | 514 MiB | 632 MiB |
| `vitest run packages/rules` | 1,430 MiB | 746 MiB | 546 MiB | 1,021 MiB |
| `tsc --noEmit` | 2,664 MiB | 1,932 MiB | 594 MiB | 714 MiB |
| idle after it | 714 MiB | 0 | 594 MiB | 714 MiB |
| `vite` dev server, left running | 816 MiB | 96 MiB | 595 MiB | 816 MiB |

1. **Idle, a lane's own memory is near nothing:** 0 anonymous with no
   process left, 96 MiB with a dev server. What it holds beyond is cache,
   600 to 800 MiB here, which reclaim can take (S317).
2. **Its commands peak at 1.4 to 2.7 GiB** and give it back when they
   end. So twenty open lanes fit in a 12 GiB VM while a few run a heavy
   command at once; what does not fit is many heavy commands at the same
   moment, which is what admission by pressure has to manage.
3. **Not measured:** a suite that starts nested lanes or a browser in a
   lane, which holds more for longer.
