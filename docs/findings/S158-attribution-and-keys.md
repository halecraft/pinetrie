# S158 — A seccomp listener per tool call, needing no privilege, attributes every write to the call that caused it and sees its lookups too, at 1.0–1.25× for opens; attributing by time loses work under parallel calls, and fsatrace crashes background processes

Numbered S154 until 2026-10-11, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0135

**Context.** S155 classifies a command's writes by origin: derived if the
command read source and did not edit the file in place, source otherwise.
That needs two things for every command:
1. its writes, attributed to it;
2. whether it read any source.

S157 found three cheap ways to see reads, at about 1×: inotify, atime and
fsatrace. None of them is both complete and attributed:
- **inotify and atime** see every process in the lane, so a background
  process looks like part of the command;
- **fsatrace** sees only processes that keep its `LD_PRELOAD`. pine·trie's
  own runtime programs (`rg`, `fd`, `sd`, `jj`) are static builds, so
  `sd` editing a file is invisible to it.

S157 also found that a recipe's key, to be complete, needs the files the
recipe looked for and did not find (`.npmrc`, `~/.npmrc`, `uv.toml`). Only
strace saw those, at up to 20× on a build.

**The model being tested.** A *recipe* is not declared. It is a recorded
run of a command that made derived files:
- the command line and the image;
- the inputs it read;
- the outputs it wrote.

Its *key* is a hash of the command, the image, each input's blob id (which
the state's tree already holds, S156), and enough about the directories it
looked in to notice a file appearing there. pine·trie never schedules a
run; it observes the runs the agent or the person makes. When it makes a
disk for a new state (a fork, the base, a catch up), it carries each
recorded output whose recipe's key still holds on that state, and leaves
out the rest, for whoever works there to rebuild.

**Question.**
1. **Attribution.** Each tool call runs under a small supervisor that is a
   child subreaper (`PR_SET_CHILD_SUBREAPER`), so every process the call
   starts stays its descendant, even one that daemonizes. Does fanotify,
   listening from lanehost's `privileged` role with each event's pid
   mapped to its subreaper, attribute every write and read correctly? And
   how do the unprivileged methods do on the same cases? The cases, each
   with its answer known by construction:
   1. a dev server (vite) writing its cache while the agent runs
      `cat > notes.md` and then a build;
   2. a double-forked daemon (`setsid nohup`) started by one tool call,
      writing during a later one;
   3. a static binary making derived output from source (esbuild's CLI),
      and `sd` editing source in place;
   4. a child started with `env -i`, so `LD_PRELOAD` is dropped;
   5. two tool calls at once, if pi runs tool calls in parallel (to be
      read from pi's source first).

   The methods:
   - inotify, attributing by the time a tool call ran;
   - fsatrace;
   - fsatrace and inotify together, where any write inotify sees and
     fsatrace does not is unattributed, and so source;
   - fanotify with subreapers.
2. **Keys without strace.** A command's lookups of files that do not
   exist are invisible to inotify, fsatrace and fanotify. Is a key still
   safe if, instead of the lookups, it includes the listing of every
   directory on the way to each input it read, within the project and
   `$HOME`?
   - How many of the lookups strace saw in S157's installs and builds lie
     in a directory that rule covers?
   - How often would an unrelated new file in one of those directories
     break the key? That only costs a rebuild, but it costs one.

**Scoring.** A misclassification is one of two kinds, and they are not
equal:
- **Source called derived** loses work: a rebuild deletes it. It must
  never happen, whatever the method.
- **Derived called source** is noise in a turn's record.

Every method treats what it cannot attribute as source.

**Kill criterion.**
- If fanotify with subreapers calls any source file derived, or leaves a
  case's writes unattributed, the privileged path is not the answer, and
  attribution falls back to fsatrace and inotify with source as the
  default.
- If the listing rule leaves any lookup strace saw uncovered inside the
  lane's disk, a key needs strace, and recipes stay declared.

**Throw away.** The scripts and their output are kept in
`docs/findings/S158-attribution-and-keys/`:
- `call.c` is the subreaper supervisor.
- `seccall.c` is the same supervisor with a seccomp listener (see
  Answers).
- `tracer2.py` is S155's tracer, which also keeps directory listings, with
  a time limit.
- `scenario.py` runs the scenarios under each method. It writes
  `results-scenario-<mode>.json`.
- `keys.py` answers question 2. It writes `results-keys.json`.
- `seccost.py` gives seccomp's cost and what it sees. It writes
  `results-seccost*.json`.

The fanotify part was planned to run from the Mac against the VM's Docker,
because this lane's nested Docker is rootless. It was not needed (see
Answers).

Read from the kernel source (`fs/notify/fanotify/fanotify_user.c`, in the
corpus's Linux clone): an unprivileged fanotify listener gets pid 0 for
every event another process causes, so unprivileged fanotify is no better
than inotify. The pid a privileged listener gets is in its own pid
namespace (`pid_vnr`), so it must share the lanes' pid namespace or the
host's.

## Answers

Run in this lane (Debian 13, arm64, rootless nested Docker, no added
capability), on S155's corpus. Every command ran under a five-minute limit,
with whatever it left running listed and then killed. That limit was added
after the first run of `seccost.py` hung for four hours (see "The hang"
below).

**A fifth method, added during the spike: seccomp user notification
(`seccall.c`).**
- **How it works.** The supervisor of each tool call is a child subreaper.
  It installs a seccomp filter in the call's shell before it starts. The
  filter sends every call that names a file to the supervisor: `openat`,
  `openat2`, `newfstatat`, `statx`, `faccessat(2)`, `readlinkat`,
  `renameat(2)`, `unlinkat`, `mkdirat`, `linkat` and `symlinkat`. While
  the caller waits, the supervisor reads the path from the caller's memory
  (`process_vm_readv`), resolves it against the caller's working directory
  or directory fd, notes whether it exists, logs it, and lets the call
  continue unchanged.
- **Why it attributes by construction.** A filter is inherited by every
  descendant and cannot be removed. So it follows daemons, static binaries
  and `env -i`, and nothing outside the call's process tree is ever seen.
- **What it needs:** no capability. It ran in this lane, whose Docker is
  rootless.
- **Its variant** (`SECCALL_OPENS_ONLY`) leaves the stat, access and
  readlink calls unwatched.

1. **Attribution, scored on the scenario** (`scenario.py`, nine tool calls,
   24 files written). The answer was known for every file.

   | method | right | loss (source called derived) | noise (derived called source) | unattributed |
   |---|---|---|---|---|
   | seccomp listener with a subreaper | 24 | 0 | 0 | 0 |
   | strace -f with a subreaper (stands in for fanotify) | 23 | 0 | 1 | 1 |
   | inotify, attributing by when each call ran | 15 | **1** | 8 | 8 |
   | fsatrace (`LD_PRELOAD`) | 17 | 0 | 5 | 6 |

   - **Time windows lose work.** The slow build and `cat > notes/c.md` ran
     in parallel, as pi runs a turn's tool calls by default (`toolExecution`
     is `"parallel"`, and `packages/pi/lane-helper.ts` keeps it). The
     build's reads fell inside the `cat` call's window, so the authored note
     came out derived.
   - **fsatrace crashes any process that outlives its command.** A
     background process started under it exits on a segmentation fault
     (status 139) once fsatrace has exited. The scenario's daemon never ran
     under it, and a dev server would die the same way. It also missed
     esbuild (a static binary) and the `env -i` child. **It is ruled out for
     lanes.**
   - **strace's one miss was a gap in the tracer, not in the approach:** it
     did not trace `symlinkat`, so pnpm's `.bin` link went unattributed.
   - **The seccomp listener attributed everything:** the daemon's writes
     during later calls (to the call that started it), `sd`'s edit through
     a temporary file and a rename, the static esbuild's output, the
     `env -i` child, the mmap writer's open, and both of the parallel
     calls.
2. **Cost and what it sees, against strace** (`seccost.py`).

   | command | untraced | strace | seccomp, all calls | seccomp, opens only |
   |---|---|---|---|---|
   | `pnpm install` | 1.02 s | 1.8 s | 1.52 s | 1.33 s |
   | `tsc` | 12.5 s | 13.9 s | 13.4 s | 14.0 s (untraced 13.7) |
   | `vite build` | 2.75 s | 35.9 s | 4.44 s | 2.70 s |
   | `vitest`, two packages | 3.89 s | 6.9 s | 10.4 s (853k calls) | 5.18 s (untraced 4.31) |
   | `cargo build` | 3.58 s | 3.8 s | 3.87 s | 3.72 s |
   | `uv sync`, cache warm | 0.19 s | 1.1 s | 0.72 s | 0.61 s |
   | `pytest` | 0.63 s | 0.9 s | 1.15 s | 0.94 s |

   - **Reads.** In every task, the listener saw every tracked file strace
     saw read.
   - **Lookups.**
     - The listener saw every failed open strace saw, except in cargo. The
       difference there is the linker's lookups in a temporary directory
       whose name is random on each run.
     - Watching stat and access too finds several times more lookups:
       4,885 in `tsc` against 11 failed opens.
   - **Cost.**
     - **Opens only:** 1.0 to 1.25× on everything but `uv sync`, which went
       from 0.2 s to 0.6 s.
     - **Stat calls too:** up to 2.7× (`vitest`, from Node's module
       resolution).
3. **Keys without lookups** (`keys.py`):
   - **A glob.** After a new note, a key made only of the files read still
     holds, so the stale `site/` would be carried. Every rule that includes
     the listing of the globbed directory breaks the key.
   - **Coverage.** Under the "ancestors" rule (every directory on the way
     to each input, up to the project root), every failed open strace saw
     in the project is covered, except one inside git's own store
     (`.git/objects/info/alternates`). A lookup counts as covered when the
     listing of the deepest directory on its path that exists is in the
     key.
   - **`$HOME`.** No listing rule covers lookups there (`~/.npmrc`,
     `~/.config/pnpm/rc`, `~/.cargo/config`, `~/.config/uv/uv.toml`).
     Only `$HOME`'s configuration taken whole would.
   - **The price.** Any new file at the project root breaks a key that
     includes the root's listing. A key of directories actually listed
     ("opened") avoids that, but misses `uv.toml`.

4. **Cost in time, added afterwards.**
   - **One watched call.** `micro.c` makes 100,000 calls back to back in
     one thread.
     - A stat of a missing file takes 0.27 µs plain and 26.8 µs watched.
     - An open and close takes 0.55 µs plain and 26.2 µs watched.
     - With opens only watched, a stat costs nothing extra.

     That is about 26 µs per watched call, for the round trip to the
     listener and the path it resolves. The listener is one thread per
     tool call, so a call's processes wait on it in turn.
   - **Small commands,** each the median of five runs, in the pine·trie
     clone (`results-small-commands.json`):

     | command | plain | seccomp, all calls | seccomp, opens only |
     |---|---|---|---|
     | `true` | 1.3 ms | 1.3 ms | 1.3 ms |
     | `cat` a file | 1.4 ms | 3.4 ms | 3.5 ms |
     | `ls -R packages` | 1.3 ms | 15.9 ms (182 calls) | 7.7 ms |
     | `rg` over the repo | 7.7 ms | 32.0 ms (1,347 calls) | 15.8 ms |
     | `git status` | 3.6 ms | 70.0 ms (1,566 calls) | 15.7 ms (159 calls) |
     | `fd -e ts` | 15.8 ms | 15.8 ms | 15.8 ms |
     | `node -e 1` | 16.0 ms | 16.1 ms | 16.0 ms |
     | `pnpm --version` | 168 ms | 167 ms | 166 ms |
     | `tsc`, one package | 3.91 s | 4.74 s (14,962 calls) | 4.30 s |

   - **The large commands of answer 2 were run once each.** `tsc`'s
     untraced time alone ranged from 11.2 s to 13.7 s across runs. So a
     difference under about a second for it is noise.

**Against the kill criteria.**
- **The first does not fire, and the privileged path is not needed.** The
  seccomp listener attributes by process tree with no loss, no noise and
  nothing unattributed, without `CAP_SYS_ADMIN`.
- **The second fires narrowly for listings, inside git's store and for
  `$HOME`.** It no longer matters: the listener sees lookups directly. A
  key can be made of what a call read and what it looked for and did not
  find, at the cost of watching opens. Watching stat calls too costs up to
  2.7×. A listing of the directories on the way to each input (the
  "ancestors" rule) covers the existence checks that use stat. `$HOME` has
  to be on the lane's disk, and part of a key as a whole.

**The hang.** The first run of `seccost.py` hung for four hours, until
duane stopped it.
- **The cause:** the listener's loop stopped on any error from
  `SECCOMP_IOCTL_NOTIF_RECV` except `EINTR`. When a caller dies before its
  notification is read, the ioctl fails with `ENOENT`. The loop then
  exited, and every later caller in the tool call waited forever. The
  first time, that was a `sh` in `vitest`'s launcher script.
- **Why it ran for hours:** the probe waited on the supervisor's exit with
  no limit of its own.
- **The fix:** `ENOENT` now continues the loop, and every command now runs
  under a limit, after which its process tree is listed and killed.
- **The lesson for a real implementation:** the listener is on every
  file-naming call's path. If it stops, the tool call hangs. If its file
  descriptor closes, the kernel fails watched calls with `ENOSYS`, which
  breaks running processes, daemons included. It has to be as robust as
  the helper that runs the tool call.

**What else holds for the seccomp listener, read rather than measured:**
- **`PR_SET_NO_NEW_PRIVS` is required** to install a filter without
  privilege. setuid programs (`sudo`) then cannot gain privilege inside a
  tool call. pine·trie's lanes run as root, so this costs them nothing; an
  image whose user relies on `sudo` would notice.
- **`process_vm_readv` needs the supervisor to be an ancestor of the
  caller,** under Yama's `ptrace_scope=1`, which is this lane's setting.
  A subreaper is an ancestor of everything its call starts.
- **io_uring's open operations bypass seccomp.** Whether Docker's default
  profile blocks `io_uring_setup` was not checked.
