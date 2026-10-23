# S327 — A lock on every host: macOS's own perl and Linux's `flock` hold one alike, freed when the holding host dies, but a Ctrl-C takes it from a child in the host's process group, and a removed lock file is a free lock

- **Status:** Answered
- **Led to:** ADR-0211

**Question.** `@pinetrie/lock` (`packages/lock`) holds a lock through a
child, `flock -n <file> sh -c 'echo held; exec cat'`, measured only in the
lanehost image (S326). The host's other locks (a served session's
`host.pid`, the session registry's `sessions.json.lock`, a VM image build's
`images/<key>.lock`) are pids in files, wrong both ways: a reused pid looks
alive, and two takers of a dead holder's file can both win
(`apps/pinetrie/host/sessions.ts`, `packages/vm/build.ts`). Moving them onto
the package needs the same protocol wherever a host runs.

1. Does macOS's `/usr/bin/perl`, holding `flock` on a file on APFS with the
   same protocol (`held` once held, exit 1 for a lock another holds, held
   until its stdin ends), refuse a second taker, free the lock when its
   host is killed with `SIGKILL`, and wait for one when asked? Is
   `/usr/bin/perl` there on every macOS pine·trie supports (13 and later,
   `vmHostRefusal` in `packages/vm/plan.ts`)? macOS's own `/usr/bin/lockf`
   would be the other system tool.
2. Is `flock` on the Linux hosts pine·trie runs on, and in the lane image
   (`node:24-trixie-slim`, `packages/lanes/image/Containerfile`), where a
   nested host runs, and does it behave as perl does?
3. A host's Ctrl-C signals its whole process group. Does it kill the child,
   freeing the lock while its host lives? And does a removed lock file, or
   a pid written into it, change who holds it?
4. What does one hold and release cost: a measurement for the registry's
   lock, taken at each host's start, not a check.

**Kill criterion.** If neither OS has a tool for this already installed, the
backend is a helper we build (the launcher's Swift, `swiftc` on demand), and
the plan is written against that. If a child cannot outlive a Ctrl-C of its
host's group, the lock is held in-process another way.

**Throw away.** The spike VM's containers. The probe and its outputs are
kept in its folder of sources.

## Answers

1. **Yes, macOS's perl holds it as `flock` does.** On macOS 26.7.1 with
   perl 5.34.1 (`perl-macos.txt`):
   - A second taker exits 1 at once.
   - A host killed with `SIGKILL` frees the lock: its child's stdin ends,
     and the next taker holds it at the first try.
   - A waiter (`LOCK_EX` without `LOCK_NB`) says `held` only once the holder
     lets go.

   **perl is on every macOS pine·trie supports.** This rests on the public
   record, not on a measurement (no macOS 13 or 14 machine was at hand):
   - macOS 13 ships 5.30.3 by default, with 5.34 beside it.
   - macOS 14 ships 5.30 and 5.34.
   - macOS 15 ships 5.34.1.
   - macOS 26 ships 5.34.1 (measured here).

   `flock` and `Fcntl` are core perl in each. Apple's 2019 note that
   scripting runtimes would leave macOS removed Python 2 in 12.3, and perl
   is still there in 26.

   **`/usr/bin/lockf` is out:** it ships only from macOS 15 (Homebrew's
   `utils/lock` and other projects' issues report it missing on 12 to 14).
2. **Yes: `flock` is in every Linux image tried, minimal ones too**
   (`flock-on-linux.txt`):

   | image | `flock` |
   |---|---|
   | `node:24-trixie-slim` (the lane image's base) | util-linux 2.41.5 |
   | `debian:bookworm-slim` | util-linux 2.38.1 |
   | `ubuntu:24.04` | util-linux 2.39.3 |
   | `ubuntu:22.04` | util-linux 2.37.2 |
   | `fedora:42` | util-linux 2.40.4 (`/usr/sbin`) |
   | `rockylinux:9-minimal` | util-linux 2.37.4 |
   | `opensuse/leap:15.6` | util-linux 2.39.3 |
   | `alpine:3.23` | busybox |

   util-linux is Essential in Debian, so a slim image keeps it. Arch has no
   arm64 image to try. The probe's every case reads as perl's under
   util-linux (in `node:24-trixie-slim`) and under busybox (in
   `node:24-alpine`) (`flock-linux.txt`).
3. **A Ctrl-C takes the lock from a child in its host's process group, on
   both OSes.** The group's `SIGINT` killed the child while its host,
   ignoring it, lived: the lock was free. Spawned `detached` (a process
   group of its own), the child kept it through the `SIGINT`, and still
   freed it when its host was killed with `SIGKILL`: its stdin ended either
   way. `holdLock` spawns its child in its caller's group today, which is
   harmless only in a lanehost server, which no terminal signals.

   **A removed lock file is a free lock.** A second taker, after the file
   was removed while held, opened a new file and held its lock beside the
   first. So a lock file is never removed while anyone may take it; today
   the session's `host.pid` is removed by `dropSessionDirs` and
   `renameSession`, and a build's `.lock` by prune.

   **A pid written into the file is only words.** Writing the holder's pid
   into the held file left the lock held: a second taker still exited 1.
4. **A hold and release costs about 5.3 ms with perl on the Mac, and
   0.6 ms (busybox) to 0.8 ms (util-linux) on Linux**, the mean of 50 in a
   row: spawning a child, its `held`, then its exit.

## Evidence

The probe (`probe.mjs`) takes a backend (`perl`, `flock`) and runs each
case against a temporary file, printing one line per case. It ran on the
Mac with `/usr/bin/perl`, and in the spike VM's Docker
(`sandbox/machine-spikes/vm.sh`) in `node:24-trixie-slim` and
`node:24-alpine` with `flock`. `flock-on-linux.txt` is `command -v flock`
and its version in each image. The macOS perl versions are from Brian d
foy's list of Perls in Mac releases, Apple's community forums (14.7.2 and
15.2 at 5.34.1), and Homebrew's pull requests for Sonoma support
(#15522) and for `lockf` (#18516).

**Note (2026-10-23), probed on the Mac, not a spike of its own.** macOS's
`/usr/bin/perl` `flock` (the lock package's backend there) and libc's
`flock(2)`, which the lane VM's launcher calls on `launcher.lock`, refuse
each other in both directions on one file: a host holding the launcher's
lock through the package keeps any launcher out, and a running launcher
keeps the package's taker out. The package opens the file for appending and
writes its holder's pid into it; the launcher writes nothing there, so the
two share the file harmlessly.
