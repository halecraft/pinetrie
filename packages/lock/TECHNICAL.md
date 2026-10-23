# `@pinetrie/lock`: technical notes

One responsibility: a lock a live process owns and the kernel frees with
it, refused to anyone else or waited for, whatever the OS (ADR-0210,
ADR-0211, S326, S327). It declares nothing and imports only Node's
built-ins (`workspace.test.ts`), so lanehost's server runs it from
pine·trie's install.

| file | owns |
|---|---|
| `lock.ts` | `tryLock` and `awaitLock`, a lock held through a child; `withLock`, a short section under one; `lockCommand`, the child's command by platform; `holdOutcome`, what the child said, pure; `holderPid` and `removeLockFile` |
| `testing.ts` | `@pinetrie/lock/testing`: `childHoldingLock`, a holder in another process, to kill or signal |

## Rules

- **A child holds the lock** (ADR-0211). Node has no `flock`, and a pid in
  a file is fooled by a reused one, and two takers of a dead holder's file
  can both win. The kernel frees the lock when the child dies, `SIGKILL`
  included (S326, S327).
- **One child per hold, speaking lines**: `waiting` while another holds
  the lock and the hold waits, `held` once held; a hold that does not wait
  exits 1 where it would have said `waiting`. Any other end is `failed`,
  with the child's words.
- **Backends by platform** (`lockCommand`, from `NodeJS.Platform`): on
  Linux, `sh` opens the file on fd 9 and `flock` locks it, busybox's or
  util-linux's, in every Linux image tried and the lane image (S327); a
  missing `flock` exits 127, never read as another's lock. On macOS, its
  own `/usr/bin/perl`, on every macOS from 13 (S327): `/usr/bin/lockf` is
  only from 15. Any other OS has no lock: a `failed` hold, worded.
- **The child is in a process group of its own** (`detached`). A
  terminal's Ctrl-C signals its host's group, and would end the child, and
  so the lock, while the host lives on (S327). It still lets go when its
  host dies: its stdin ends.
- **`heldWhile` is required**: the caller's own input, or
  `"until-released"`. A holder whose input has ended stays alive for good
  while its child's stdin is open, since that pipe keeps Node's event loop
  running (S326, `== B`); so with an input, the package ends the child's
  stdin when the input ends. It never reads the input, whose data is the
  caller's: it ends only once the caller reads it to its end, as a
  server's channel does. A host's lock lasts until released, or until it
  dies.
- **What a taker can get back is its type.** `tryLock` gives a
  `LockAttempt`: `held`, `held-by-another` or `failed`. `awaitLock` gives
  `held` or `failed`, never a refusal, and calls `onWaiting` once if it
  must wait. No timeout: a holder that never lets go is named to whoever
  waits. `withLock` releases after its work, also when it throws.
- **A pid is for words only** (`SaidPid`). A hold given `writePid` writes
  its process's pid into the file once held, and `holderPid` reads it for
  a waiter's (`OnWaiting`) or a refusal's words. It comes as an object, not
  a branded number: a brand stops a plain number being passed as one, not
  one being passed as a plain number, so `process.kill` would take it.
  Only words read `.saidPid`. A lanehost server writes none: a pid in a container's
  namespace means nothing to another.
- **Only a holder removes its lock's file** (`removeLockFile`). A file
  removed while held is a free lock: the next taker opens a new file
  beside it (S327).
- **A lock lost is said** (`HeldLock.lockLost`): a child that exits unasked
  has let the lock go, and its holder must stop.
- **Its users**: lanehost's project lock (`PROJECT_LOCK`), the host's
  session registry and each served session's lock
  (`apps/pinetrie/host/sessions.ts`), and the lane VM's image build
  (`BUILD_LOCK`, `packages/vm`).
- **The launcher's `launcher.lock`** (`packages/vm/launcher/launcher.swift`)
  keeps the same contract in Swift, which cannot import this package: the
  one lock outside it.

## Tests

`lock.test.ts`: `holdOutcome` as a table; `lockCommand` by platform; on
each platform the machine has (macOS's perl on the Mac, `flock` where it
is): a second taker refused, a lock released and taken again, a holder
killed with `SIGKILL` and one whose input ended each freeing it, a Ctrl-C
to a holder's group leaving it held, a waiter told once whom it waits for,
the holder's pid, `withLock` releasing on a throw, `removeLockFile`; a
child that fails, one that cannot start, and one that exits after it held.
The Linux script is run on the Mac only through the lanes suite, whose
lanehost image has busybox's `flock`. Mutations in
`scripts/mutations/lock.ts`.
