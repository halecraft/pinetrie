# ADR-0211 — Every lock a host takes is the kernel's, held by a child in a process group of its own, so its owner is alive exactly while it is held

- **Status:** Proposed
- **Area:** `packages/lock/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`,
  `packages/vm/TECHNICAL.md`
- **Evidence:** S326, S327
- **Amends:**
  - ADR-0210: `@pinetrie/lock` gains a macOS backend and a wait, and takes the
    host's own locks too.

**Context.** Five locks in the repo share one responsibility: while a
process lives, it alone owns a name; anyone else is refused or waits; its
ownership ends with the process. One is `@pinetrie/lock`'s, a disks
server's project lock (ADR-0210, S326), and one is the launcher's
`launcher.lock`, a `flock` in Swift. The other three are pids in files: a
served session's `host.pid`, the session registry's `sessions.json.lock`,
and a VM image build's `images/<key>.lock`. A pid file is wrong both ways:
a reused pid looks alive, and two takers of a dead holder's file can both
win, which the registry's own code admits. `host.pid` refuses nothing: a
second host on a session takes nothing, and only its store's SQLite lock
refuses it.

Node has no `flock`. S327 measured what each host has: macOS's own
`/usr/bin/perl`, on every macOS pine·trie supports, holds a `flock` with
the protocol busybox's `flock` had in S326, and every Linux image tried has
`flock`. It also found that a Ctrl-C to a host's process group kills a
child holding a lock while the host lives on, and that a lock file removed
while held is a free lock to the next taker.

**Decision.**

- **A lock is held by a child, by platform:** `flock` on Linux, macOS's
  `/usr/bin/perl` on the Mac, each printing `held` once held, exiting 1 for
  a lock another holds, and holding it until its stdin ends. An OS with
  neither has no lock, worded.
- **The child is spawned in a process group of its own**, so a terminal's
  Ctrl-C never takes the lock from a living host. It still lets go when its
  host dies, since its stdin ends.
- **A lock ends with its owner's input, or only at its release**, named by
  the caller: a lanehost server's life is its input; a host's is not.
- **A wait is an event**: a taker that would wait first tries without
  waiting, says once whom it waits for, then waits for `held`. No timeout.
- **The holder writes its pid into the held file, for words only.** Nothing
  decides by it.
- **A lock file is never removed while anyone may take it.** A session's
  `host.pid` is taken and removed only under the registry's lock, and a
  rename moves it held. The registry's and the build's lock files are never
  removed.
- **The host's three pid files move onto the package.** `host.pid` (its
  name kept, since it still holds a pid) refuses a second host on a session
  at its start, naming the first; a host whose session lock is lost shuts
  down. The registry's lock is waited for. One `images/build.lock` serves
  every image's build.
- **`launcher.lock` stays in Swift**, which cannot import the package: the
  one lock outside it.

**Consequences.**

- No pid decides anything: `livePid`, `takeHostPid`, `planLock` and the
  registry's linked lock go, and with them the race of two takers.
- The registry's `locked` problem, and its 5 s wait, go: a hung holder is
  named to whoever waits for it, not timed out.
- A second host on a session is refused before it opens anything, with the
  first host's pid.
- Two builds of different images wait for each other, a build's time in a
  rare case (two versions of pine·trie at once).
- A hold costs a child: about 5 ms on the Mac, under 1 ms on Linux (S327),
  taken at a host's start and a rename.

**Alternatives rejected.**

- **macOS's `/usr/bin/lockf`:** it ships only from macOS 15, below the
  floor of 13 (S327).
- **A Swift helper built on demand, as the launcher is:** it needs Xcode's
  tools on a Mac that runs no lane VM, and a build step where perl needs
  none.
- **Keeping pid files, checked better:** a reused pid still looks alive,
  and taking a dead holder's file over is still a race.
- **Renaming `host.pid`:** every session's directory would keep an old
  `host.pid`, which a session's attach counts as a file it holds.
- **A lock per image build:** each would be a file that is never removed
  once used, one per image ever built, for builds that seldom overlap.
