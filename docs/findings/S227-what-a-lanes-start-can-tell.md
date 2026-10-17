# S227 — a lane with no revision record has no files of its own, and one with a record has had some: what a start can tell from the store and the disks, and what it cannot

- **Status:** Answered
- **Led to:** ADR-0167

Measured on a copy of Duane's store (`pinetrie.db`, 2026-10-17 13:07,
host stopped), read with Python's `sqlite3` by replaying each document's
compacted record and the batches since it (`census.py`). The listing of
the project's `lanes/` and `snapshots/` directories in the lane VM was
read through a lanehost container (`classify.py`), and the probe of S226
supplied the text-only run. The rest is read from source.

## Brief

**Question.** At a lane's start the host can gather whether its disk
exists, its revision records, which of their snapshots exist, and, for
a folder, its states. Which of these tell a lane whose files were never
its own (a fork never finished) from one whose files are lost? What do
Duane's lanes look like by those facts today?

**Kill criterion.** If the facts a start can gather already tell every
case apart, no new record is needed.

**Throw away.** The copy of the store (`/tmp/census.db`), the listings,
`lanes.json`.

## Answers

1. **Every run's prompt turn is recorded with a snapshot, a text-only run
   too.** `planTurnRecord` (`packages/rules/work.ts`) always records an
   own lane's prompt turn, and `turnDone` (`apps/pinetrie/host/work/turns.ts`)
   gives it a snapshot. In S226's probe, a run that only said "hello" left
   one record, its snapshot set, its point the lane's newest commit.

2. **A failed snapshot leaves `snapshot: null` on a turn whose commit is
   recorded.** `turnDone` writes the record with a null snapshot when the
   snapshot step throws. Duane's store has 4 such records, in 3 lanes. So
   "no snapshot" does not mean "no files". "No revision record" does: the
   lane never finished a turn, so its files are its fork's, except what
   an unrecorded turn wrote on a disk that is itself gone.

3. **Archiving keeps what a restore needs for any lane that recorded a
   snapshot** (read from source). `planRetention` keeps each lane's
   newest non-null snapshot and the snapshot nearest each thread's end,
   and a reopened lane starts from its newest that exists
   (`startContainer`). A lane with no snapshot of its own is retired after
   a reopen, though forking it again would rebuild exactly its files.

4. **Duane's 319 lanes, by what a start sees:**

   | disk | revision records | their snapshots | lanes |
   |---|---|---|---|
   | yes | yes | some kept | 70 |
   | yes | yes | every one gone | 155 |
   | no | yes | some kept | 89 |
   | no | yes | every one gone | 3 |
   | no | none | none | 2 |

   Every lane keeps a jj history with a copy of its own; every disk has a
   lane record; `pinetrie.files-lost` is empty. The two with neither disk
   nor record are safe-walnut (2026-10-17) and famous-panther
   (2026-10-02), each a root thread whose first run never recorded a
   turn: forks never finished (S226), whose files would be rebuilt exactly
   by forking again. The three with records and nothing left are lost:
   retired is the truth for them.

5. **Every snapshot from before 2026-10-07 19:42 is gone.** The 155 lanes
   with disks and no snapshot left were made between 09-29 and 10-07; the
   snapshots there run from 10-07 19:42 to 10-17. The cause was not
   looked for. A branch from one of their turns begins from its base
   (`forkSource`'s lost snapshot), and archiving one would leave it
   retired, which is true: its recorded files would be gone.

6. **What the facts can and cannot tell:**
   - No disk, no revision record: never had files of its own. Forking
     again is exact (answers 1, 2).
   - No disk, a snapshot of its own exists: restore its newest.
   - No disk, records, none of their snapshots exist: lost.
   - A disk: nothing in the store says, for jj, whether the fork that
     made it finished (S226 answer 3). For a folder, the lane's start
     state says it: a folder lane with no start state has not begun.

## What it points to

- "Has a revision record" is the fact that tells "never had files" from
  "lost"; no new record is needed for that.
- "The fork finished" needs a record for jj, which nothing else holds;
  for a folder its start state already is one, written by the same code.
- The kill criterion holds for a lane with no disk, and fails for a lane
  with one.
