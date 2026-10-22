# S320 — A turn's snapshot costs metadata in proportion to the files the turn changed, about 3 KiB each; a branch from a turn whose snapshot is gone starts from its thread's base today, and would keep the turn's tracked files if the fork took the turn's commit

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** The disk upkeep (ADR-0210) evicts open threads' older turn
snapshots, least recently used first, to keep the store's metadata within
a budget. Two beliefs it rests on:

1. What does one turn's snapshot cost in metadata, and does deleting it
   give that back? A budget counted in snapshots is only right if each
   costs about the same.
2. A branch from a turn whose snapshot was evicted still gets that turn's
   tracked files, from its jj commit, and only its untracked files from an
   older snapshot.

**Kill criterion.** (1) is measured. (2) fails if a fork takes its tracked
files from the snapshot it clones, or fails on a snapshot that is gone.

**Throw away.** The spike VM's subvolumes. Kept in
`docs/findings/S320-what-a-snapshot-costs/`: `turns.sh`, the snapshots
taken after light and heavy turns, with the metadata used before and after;
`run1.txt`, its output.

## Answers

1. **Measured** on 2026-10-21 in the spike VM, on a lane-like subvolume
   holding pine·trie's files and its `node_modules` (25,606 files,
   473 MiB), each turn followed by a read-only snapshot, as a turn's end
   takes one:

   | turn | metadata a snapshot (logical; DUP stores it twice) |
   |---|---|
   | 5 files edited | 57 KiB |
   | 2,000 files rewritten | 6.4 MiB |

   Deleting the 200 light snapshots freed 17 MiB. So the cost follows the
   files a turn changed, about 3.2 KiB each, from 57 KiB to megabytes: a
   count of snapshots is the wrong budget. The host already knows each
   turn's changed paths (its diff, `apps/pinetrie/host/TECHNICAL.md`, "A
   turn's end is one queued step"), so it can estimate each snapshot's cost,
   and the disk's own counters (S322) give the truth to evict against. The
   lane VM's 0.8 MiB a subvolume on 2026-10-21 (S313) fits turns that
   install and build.
2. **Read from the source; corrected on 2026-10-21.** A jj fork clones
   the snapshot it is given (`planFork`, `packages/lanes/fork.ts`), then
   its setup fetches the turn's commit and runs `jj new` on it
   (`planForkSetup`, `packages/jj/lane/plan.ts`) when its start is
   `recorded`, which writes that commit's tracked files to the working
   copy. The commit and the snapshot are found apart (`nearestRevision`,
   `packages/threads/work.ts`). **But a fork whose snapshot is gone does not
   take the commit:** the fork's gather asks whether the snapshot is still
   there (`forkFacts`, `apps/pinetrie/host/work/create.ts`), and
   `forkSource` (`packages/rules/work.ts`) then clones the base and starts
   from the thread's base (`start: begin`, `lost` set), as written for an
   archived thread, whose lanes' refs are deleted. So today a branch from a
   turn whose snapshot was evicted would lose that turn's tracked work. For
   an open thread the turn's commit is an ancestor of its lane's ref, which
   a fork at any recorded turn already fetches by id; so a fork that kept
   the recorded start (`recorded`, the turn's point) and cloned the nearest
   snapshot still there, else the base, would keep the turn's tracked files
   and take untracked ones from an older turn, as wanted. A first version of
   this answer said the fork already did; it read the setup's steps and
   missed `forkSource`'s branch for a lost snapshot.
   Archiving already thins this way: it keeps each lane's newest snapshot
   and the one nearest each thread's end (`planRetention`,
   `packages/rules/work.ts`).
