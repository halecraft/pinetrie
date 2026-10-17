# S224 — shared-file tracking can drop a turn's reads, deleted threads' reads, and gone files' lineages without changing what it flags; three in four lineages are files gone

- **Status:** Answered
- **Led to:** ADR-0135

Read in a lane at this revision, with the shared folders as Duane's host
serves them (`/workspace/.plans`, `sandbox`, `media`, live), and S221's
census of his store. The probes were not committed.

## Brief

**Question.** S221 found 97 MB of shared-file lineages in the session
and 64 MB of turns' shared reads in revision records. What reads each
piece, so what can go without changing the one thing tracking shows (a
turn's "writes to shared files over others'"), and without touching
accepting, merging or publishing? When may a lineage go, and how does
the host learn its file is gone? Why do package stores land in shared
folders?

**Kill criterion.** If anything that accepts, merges or publishes reads a
lineage or a turn's shared record, none of it can go without a new design
for that reader.

**Throw away.** The probe project in `sandbox/`.

## Answers

1. **Nothing that accepts, merges or publishes reads any of it.** A shared
   folder is outside every state by where it is mounted (ADR-0135); a
   folder project marks each shared path ignored (`prepareShared`,
   `apps/pinetrie/host/folder/index.ts`). Nothing in `packages/folder` or
   `apps/pinetrie/host/folder` names a lineage or a turn's shared record;
   a folder accept's stamps are its own (`encodeFolderStamps`). A recipe's
   key takes the shared files a run read from the run's own accesses
   (`madeFrom`, `packages/rules/disk.ts`), never from a stored record.
2. **A turn's shared `read` list has no reader.** The turn's stats count
   only `wrote` (`packages/interface/work-stats.ts`), and `revise`
   (`apps/pinetrie/host/work/shared.ts`) rewrites only `wrote`.
3. **A lineage's `read` map has one reader:** `laneReads`, the base of
   that lane's next write to the file. A lane whose thread was deleted
   from the trash never writes again (`sweepTrash`); an archived or
   trashed one can be restored.
4. **A version is identified by its writer's turn, its path and its
   number,** whenever a record names it: `revise` finds the turn's record
   by `writer.entry`. A turn's writes are planned once, at its end, so a
   lineage dropped and begun again at 1 never gives an earlier turn's
   record a number the new lineage's writes reuse. A stamp a later turn
   reports of a dropped lineage comes back as a version made outside at
   its own ctime, which orders it as before.
5. **Three in four lineages are files gone.** On 2026-10-17 the shared
   folders held 34,668 regular files (`.plans` 1, `sandbox` 17,743, of
   which 17,715 under `.pnpm-store`, `media` 16,924); S221 counted 140,100
   lineages, so at least 105,432 (75%) are of files no longer there.
6. **The watcher drops delete events today** (`shared-watch.ts` filters
   them), and its scan at each start lists every regular file
   (`readdir`, recursive). Its listing returned no files on any error,
   which a sweep would read as every file gone; only a missing directory
   should.
7. **pnpm puts its store at the root of the mount a project is on when its
   home store is on another.** `pnpm store path` (10.18) in a project with
   its own `package.json` inside `sandbox/` named
   `/workspace/sandbox/.pnpm-store/v10`; the same in `/tmp`, an overlay,
   named `/.pnpm-store/v11` (12.14). A lane's home is on `/workspace`;
   each shared folder is a mount of its own. So a lane's `pnpm install` in
   a project under a shared folder writes its whole store there.

## What it points to

- Drop a turn's shared reads, and a deleted thread's lane from every
  lineage it read; keep archived and trashed lanes, which can be restored.
- Let a lineage go when a full scan of its directory does not find its
  file and every version is older than the host's start: no turn the
  host records later began before it.
- A listing that fails throws, so it never reads as files gone.
- Out of scope here: whether bulk folders under shared directories (a
  package store) should be left out of tracking.
