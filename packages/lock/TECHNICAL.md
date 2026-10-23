# `@pinetrie/lock`: technical notes

One responsibility: a lock a live process owns and the kernel frees with
it, refused to anyone else, whatever the OS (ADR-0210, S326). It declares
nothing and imports only Node's built-ins (`workspace.test.ts`), so
lanehost's server runs it from pine·trie's install.

| file | owns |
|---|---|
| `lock.ts` | `holdLock`, the lock held through a child; `lockCommand`, the child's command by platform; `holdOutcome`, what the child said as a hold, pure |

## Rules

- **A child holds the lock.** Node has no `flock`, and a pid in a file
  means nothing across containers and is fooled by a reused one. The child
  (`flock -n <file> sh -c 'echo held; exec cat'` on Linux, busybox's or
  util-linux's) takes the lock without waiting, prints `held` once the
  kernel gave it, and holds it until its stdin ends; the kernel frees it
  when the child dies, `SIGKILL` included (S326).
- **A hold is a value** (`Hold`): `held`, `held-by-another` (`flock -n`'s
  exit 1, said nothing) or `failed` with the child's words. The holder
  knows it holds the lock only by `held`, never by a wait: no time is
  judged.
- **`until` is required.** A holder whose input has ended stays alive for
  good while its child's stdin is open, since that pipe keeps Node's event
  loop running (S326, `== B`). So the package ends the child's stdin when
  `until`, the caller's own input, ends. It never reads `until`, whose
  data is the caller's: `until` ends only once the caller reads it to its
  end, as a server's channel does.
- **A lock lost is said** (`Held.lost`): a child that exits unasked has
  let the lock go, and its holder must stop.
- **Backends by platform** (`LockPlatform`): Linux's `flock`, which is in
  the lanehost image (busybox 1.37.0) and on every Linux host with
  util-linux. macOS's own `/usr/bin/perl` holds a `flock` with the same
  protocol (S327), and comes with the host's other locks (`host.pid`, the
  session registry's, a build's `images/<key>.lock`), proposed in
  ADR-0211. The launcher's `launcher.lock`
  (`packages/vm/launcher/launcher.swift`) keeps the same contract in Swift,
  which cannot import this package: the one lock outside it.

## Tests

`lock.test.ts`: `holdOutcome` as a table; `holdLock` over each command the
machine has (`flock` where it is, perl's stand-in with the same protocol on
the Mac): a second taker refused, a lock released and taken again, a
holder killed with `SIGKILL` and one whose input ended each freeing it; a
child that fails, one that cannot start, and one that exits after it held.
Mutations in `scripts/mutations/lock.ts`.
