# S246 — after the refresh fix, a working session's waits are a run's end compacting a 45 MB session, a lane's start listing every snapshot inside a step, and a second of jj per refresh

- **Status:** Answered

Read from Duane's host log of 2026-10-17/18 (about two and a half hours
with the root trace on, several runs and three acceptances), his trace
(`day6.jsonl`), and the code at this revision.

## Brief

**Question.** With a refresh no longer loading roots (S222), what does the
host still wait on in a working session, and which of its stall lines are
the host's?

**Kill criterion.** None: a reading of one log, to choose what to change
next.

**Throw away.** The log and trace.

## Answers

1. **Four stalls of 131 s to 1,042 s were the Mac asleep, not the host.**
   Nothing ran during them, and the host went on as before. Node's delay
   histogram counts a sleep as a stall; the stall line now gives the
   stall's CPU time, and words one mostly off the CPU as a pause
   (`stallWords`, `apps/pinetrie/host/stalls.ts`).
2. **Every run's end stalls the host twice, about a second each.** The
   pattern repeats for each of about fifteen runs: `run … done`, a stall
   of 0.5-1.6 s, `a step (upkeep) … ran 1,019-1,405 ms`, a stall of
   1.0-1.5 s. The trace's upkeeps after a run compact the run's root and
   the session's three documents (`planUpkeep` after a settle). The
   session is 45 MB (S222), 36 MB of it shared lineages, 33 MB of those
   two folders that still exist (`sandbox/.pnpm-store`, 17,715 paths;
   `media/noun-icons`, 16,923). Each run's end rewrites all of it. The
   run's root is compacted too: one of them was 41 MB in S221.
3. **A lane's start can hold every command behind it for 10 s.** `a step
   (drain:…) ran 10,590 ms` came with `[lanehost] disks snapshots 9,002 ms`,
   and three steps waited 4-6 s behind it. A begun lane whose container
   must be made (the host had removed the slot's containers at its start)
   gathers its facts (`made`, `apps/pinetrie/host/work/containers.ts`): its
   disk, its revisions' snapshots, its kept snapshot, and a listing of
   every snapshot of the project. The listing stats each snapshot
   directory (`snapshotsIn`, `packages/lanehost/disks.ts`): 9 s cold, then
   388-451 ms at each later start. The plan reads it only to find the
   newest of the lane's own snapshots that exists, and only when the
   lane's disk is gone (`planLaneStart`). It runs inside the drain, a step
   of the documents' keeper, so every command and drain waits for it.
4. **An unchanged lane's refresh is about a second of jj.** A lane's
   refreshes after each of its turns ran 1,006-1,217 ms with no command
   over 500 ms, so it is several jj processes of 100-200 ms each. After an
   acceptance every lane is refreshed, one after another: the last ones
   waited 17-26 s. Not counted here: how many commands an unchanged
   refresh runs.
5. **The tab still asked for 17 roots at connect** (S245).
6. **One start ran the store's migrations for 17 s,** once.
7. **`privileged diff` took 1.4-3.4 s now and then,** with no stall beside
   it: lanehost's own time, not the host's.

## What it points to

- **Compact a large document less often:** when its stored records since
  its last compaction are a share of its size, not at every settle, and
  delete the two bulk folders, which the trim of S224 then lets go of.
- **A lane's start checks only the snapshots it may start from,** newest
  first, and only once its disk is known gone; and no lanehost call is
  awaited inside a step of the documents' keeper.
- **Count an unchanged refresh's jj commands,** as a test's value, and cut
  them; S100 began on one read for every lane.
- **A tab holds the canvas on screen and its inventory** (S245).
