# S321 — What keeps a snapshot is in every root's revision records, which a sweep cannot read without loading every root; and 67 of 71 inner projects, holding 19,000 snapshots, live in a lane's `/tmp`, which no inner host outlives

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** The disk upkeep (ADR-0210) deletes what nothing reaches, so
that a crash or a stop part way (Ctrl-C) only delays a cleanup. To do that
it must know:

1. What keeps a snapshot, and can a sweep read it all?
2. A nested lane's inner hosts keep projects in the lane's store, which the
   outer host cannot read the records of. When is an inner project
   abandoned?

**Kill criterion.** None: an account, read from the source and the lane
VM's disk. Each claim names which.

**Throw away.** The listing of the lane VM's inner projects (read-only, an
`alpine` container binding its lanes directory).

## Answers

1. **Every root's revision records** (`RevisionRecord`,
   `packages/core/revisions.ts`) name the snapshots its lanes' turns took;
   the base snapshot is `BASE_SNAPSHOT`; archiving keeps each lane's newest
   and the one nearest each thread's end (`planRetention`,
   `packages/rules/work.ts`); a folder project's kept states are its
   record's `kept` (`planKeep`). The records live in each root's document,
   so a sweep reading them all would load every root: 249 on 2026-10-21,
   which the upkeep exists to avoid (`apps/pinetrie/host/TECHNICAL.md`,
   "One upkeep reconciles storage and memory"). An index of the host's own,
   written where a turn's snapshot is made and read only by the sweep,
   would answer it without loading any root. The host already keeps one
   such table beside the documents in its SQLite file, the images'
   (`pinetrie_blobs`).
2. **A snapshot is in the making only as `<id>.tmp`** (`planDisk`,
   `packages/lanehost/disks.ts`). On 2026-10-21 the disk held 20 of them,
   left by snapshots whose rename failed (`ENOSPC`) or was cut short; none
   is ever read.
3. **Inner projects.** A host records its project's root in the project's
   `root` file (`recordProject`, `packages/lanehost/projects.ts`). Read on
   the lane VM: 71 inner projects across the nested lanes' stores, 67 with
   a root under `/tmp` (`/tmp/pinetrie-folder-…`,
   `/tmp/pinetrie-browser-tools-…`, `/tmp/pinetrie-lanes-…`: the suites'
   throwaway projects), holding 19,132 snapshots, and 4 under
   `/workspace`, the lane's own disk. A lane's `/tmp` is in its container,
   not on its disk. So once a nested lane's container stops (its run's
   end), no inner host is alive in it, and an inner project whose root is
   not on the lane's disk can never be reached again: it can be removed
   then. One whose root is on the lane's disk may be met again by the next
   run's inner host, and is kept within the store's budget.
