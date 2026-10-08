# S140 — A host's slot can be refilled once none of its lanes runs, and a new source then reaches every lane; a second slot beside it shares files at once but loses appends

- **Status:** Answered
- **Led to:** ADR-0118

Follows S130 and S131. For ADR-0118.

**Question.** ADR-0118 has the host's owner register sources, folders a
thread's lane mounts, and lets a thread add one later, "at its next start".
On Linux a lane's mounts are Docker binds of the host's paths. On the Mac
every directory a host's lanes mount is an entry of that host's slot in the
lane VM, filled once when the host leases it, and never replaced while the
host runs (ADR-0103). Can a source registered while the host runs reach its
lanes on the Mac, and how?

1. **Refill in place:** once none of the host's containers runs, refill its
   slot with the old entries and the new one. Does a new container read and
   write both? Does a stopped container, started again, still work, or must
   it be removed first (as `sweepSlot` does)?
2. **A second slot:** while a container runs bound into the host's slot,
   fill a second slot with the same directories and the new one, for the
   lanes that start next. Do containers on the two slots see each other's
   writes to a directory both mount (a live source, `.plans`), and how fast?
   Does a file one rewrites read fresh through the other? Are appends to one
   file through both at once all kept?

**Kill criterion.** Way 1 fails if a new container on the refilled slot
cannot read and write both the kept entry and the new one. Way 2 fails if a
write through one slot is not seen through the other within a second, a
rewrite reads stale for longer, or an append is lost. If both fail, a source
registered while a host runs reaches its lanes on the Mac only when the host
restarts.

**Throw away.** The probe's folder (`s140-source-slots/` in the shared plans
folder): its script and its results. It builds S131's launcher and copies
S131's kernel and first stage, and uses S128's system image; its data disk
and test folders are deleted when it ends.

## What the record answers already

Read from S130, S131 and the source, not run:

- **On Linux nothing new is needed.** A lane's mounts are part of its
  runtime's arguments (`runArgs`), hashed into its container's
  `pinetrie.spec` label (`specHashOf`, `packages/lanes/plan.ts`). A lane
  whose mounts change is recreated on its own disk at its next start, as
  one whose shared directories change is (ADR-0035,
  `packages/lanes/TECHNICAL.md`, Containers).
- **Replacing a slot's share is possible on a running VM.** S131 replaced
  slot 0 under 1 ms, and a container started afterwards read the kept
  entry. "Filled once" is a rule the launcher (`lease.filled`,
  `packages/vm/launcher/launcher.swift`) and the host (`fill`,
  `packages/vm/lease.ts`) enforce, not a limit of Virtualization.
- **What it costs is every running bind into the slot** (S130, S131): cut,
  with nothing in the guest's log. Lanes' containers stop at each run's end
  (`runEnded`), so a host has moments with none running, but a busy team's
  host may have none for hours.
- **The host already refills its slot once**, when its lease is lost
  (`keepLease`): it sweeps the slot's containers, fills it, and each lane is
  made again at its next start. Way 1 is that, on purpose.
- **Slots are apart** (S131): filling one leaves binds into the others
  working. Way 2 rests on it. Neither spike mounted one Mac directory
  through two slots at once.
- **A VM has 20 slots, 16 by default** (S131, ADR-0103). Way 2 holds two
  slots per host while its old lanes finish.

## How to run it

On the Mac, in pine·trie's repo: `bash .plans/s140-source-slots/run.sh`.
About two minutes. It needs `swiftc`, `codesign` and the docker CLI, S131's
folder (`.plans/s131-share-slots/`) and S128's system image
(`.plans/s128-launcher/system-trim2-lz4hc.erofs`), both present on
2026-10-08. The VM boots with 4 slots, mounted in the guest at
`/mnt/slots/<i>`.

- **A.** Slot 0 holds `k1`. One container on it is stopped and kept,
  another removed. Slot 0 is refilled with `k1` and `k2`. A new container
  reads and writes both; the stopped one is started again and tried.
- **B.** Slot 1 holds `k1` and `sh`; a container bound into it appends to
  `k1/held.txt` and writes a counter in `sh` every 0.1 s. Slot 2 is filled
  with `k1`, `sh` and `k2`, and a second container bound into it. Each sees
  the other's new file; a rewrite of `sh/shared.txt` by slot 2, then by the
  Mac, is read through each; slot 2's container appends 20 lines to
  `held.txt` while slot 1's appends on. Then slot 1's container is removed,
  slot 1 emptied, and slot 2's tried again.

## How it ran

Duane ran it once on the Mac (Apple M3 Max, macOS 26.7.1, docker CLI
29.8.1), on 2026-10-08, with the pine·trie host and its lane VM running
beside the probe's VM. Every replacement took under 1 ms (the launcher's
timing). Times "seen in" are from a poll of `docker exec` every 50 ms, each
exec about 30 ms: 33 ms is the first poll, so "at once" within what the
probe can tell.

## Answers

1. **Way 1 works: refilling the slot once none of its containers runs.**
   - After slot 0 was refilled with `k1` and `k2`, the guest's mount listed
     both.
   - A new container read both, its writes reached the Mac, and the Mac's
     reached it.
   - **A container stopped before the refill and started after it works
     too**: it read `k1`, its write reached the Mac, and the Mac's reached
     it. Docker binds again at each start, so the sweep before a fill is
     needed only for containers that might be *running*: a dead host's
     (`sweepSlot`), not this host's stopped lanes.
2. **Way 2 shares a directory through two slots at once:**
   - slot 1's running container went on writing after slot 2 was filled
     (100 → 130 bytes in 0.6 s), as S131 found;
   - a new file written through either slot was seen through the other in
     33 ms;
   - a file rewritten through slot 2 read fresh through slot 1 in 33 ms,
     and one rewritten on the Mac read fresh through both;
   - emptying slot 1 after its container was removed left slot 2's
     container working.
3. **Way 2 loses appends.** For 2 s, slot 2's container appended 20 lines
   to `k1/held.txt` while slot 1's appended every 0.1 s:
   - the Mac's file kept 15 of the 20, and 38 of slot 1's;
   - it held 54 lines, of which 53 were whole: one was torn;
   - slot 2 counted 39 of slot 1's lines where the Mac had 38.

   Each slot is its own FUSE session in the guest, and each computes an
   append's offset from its own idea of the file's end. Within one session
   the guest's kernel orders appends to an inode. That reading is from how
   virtiofs works, not measured: **the probe had no control**, two
   containers appending through one slot, or the Mac and one container. So
   whether one slot keeps every append, as lanes of one host rely on today
   in a shared directory, is unknown.
4. **The guest's kernel logged nothing** but FUSE's start.

## What this means

- **Kill criterion:** met for way 2 (an append lost), not for way 1.
- **A source registered while a host runs reaches the Mac's lanes by
  refilling the host's slot** at a moment none of its lanes' containers
  runs. Containers stop at each run's end, so such a moment comes; a host
  with a refill waiting holds new runs' starts until the running ones end,
  then refills (under 1 ms) and starts them. Stopped containers need not
  be removed first.
- **Not a second slot.** It would let a run start at once, but two lanes of
  one host appending to a file in a live source could lose lines while both
  slots are filled.
- **Answered since by S141:** appends through one slot are all kept;
  appends from the Mac and a lane at once lose most of the Mac's; and two
  slots sharing one directory also refuse creates.
