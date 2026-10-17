# ADR-0167 — A lane's fork is a record, owed from the send until its last step; every start decides from it and what is there; and a lane is retired only when files it recorded are gone

- **Status:** Accepted (Duane, 2026-10-17)
- **Area:** `packages/lanes/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`,
  `packages/rules/TECHNICAL.md`, `packages/jj/TECHNICAL.md`,
  `packages/reads/TECHNICAL.md`
- **Evidence:** S226, S227, S42
- **Amends:**
  - ADR-0034: a lane with no disk and no snapshot is retired only when it
    recorded a turn; one that never did is forked again, and a fork a host
    stopped part way is run again at the lane's next start.
- **Revised:**
  - 2026-10-17 (S226): where a lane begins is read from its thread's record
    (`forkEntry`), not stored on the fork record, which holds the WIP it
    starts from and its state.

**Context.**

- **A new lane's fork is work nobody waits for, and nothing records it.**
  The send writes the lane's record (`LANE`), then queues the fork in
  memory. The fork waits for lanes to be ready (the images, the base
  snapshot), then clears and clones the disk, then runs the adapter's
  setup. A host that dies meanwhile leaves the record and loses the fork.
  An ordinary shutdown waits for it, so it takes a crash, a kill or a
  second Ctrl-C; at a host's start the wait can be an image build (S226).
- **What the next host makes of it depends on where the fork stopped**
  (S226):
  - With no disk yet, the lane is called retired, and its tools refuse.
    That was safe-walnut, and famous-panther before it (S227).
  - With its clone made and its setup not run, a jj lane runs on its
    source's disk, and nothing reports it. A branch keeps its parent's
    bookmark and immutable config, and its first commit takes the change
    of its parent's working copy: your repo then holds both lanes' tips as
    one divergent change, the case ADR-0034's `jj new` exists to prevent
    (S42). A root lane has no immutable config at all.
  - A folder lane in that state has no start state, so every turn's record
    fails.
- **Only the jj case cannot be told from what is there.** A lane's files
  are its fork plus its recorded turns. Every run's prompt turn is
  recorded with a snapshot, a text-only run too, so a lane with no
  revision record never had files of its own, and forking it again
  rebuilds them exactly (S227). A folder lane's start state says it began,
  and the project keeps the snapshot of each lane's newest state
  (`packages/folder/live.ts`). But a jj lane's disk looks the same
  whether or not its setup ran: what the setup made is on that disk alone.
- **Retired was meant for something else.** ADR-0034 retires "a lane from
  before lane containers". Duane's store has three lanes whose recorded
  snapshots and disks are all gone, for which retired is true, and two
  whose forks never finished, for which it is not (S227).
- **Running the fork again is safe for jj and not for a folder lane that
  began.** The fork starts by removing whatever disk and container the
  lane has. A folder lane given a second start state has two newest
  states, and every read of its history throws (S226).
- **The fork needs one thing only the send knew:** the WIP it starts from.
  Where it begins can be read again from the thread's record (S226).

**Decision.**

- **A lane's fork is a record of its own,** session-wide, keyed by the
  lane, beside `LANE`, which stays written once:
  - *owed*: where the lane begins (its thread's position) and the WIP it
    starts from, null for accepted work. Written in the same write as
    `LANE`, so no lane is ever recorded without it.
  - *begun*: the same, and the snapshot its source would have cloned if
    that was not kept (null when it was). Written only after the fork's
    last step. For a folder lane it is written in the same write as the
    lane's start state, so the two never disagree.
  - It replaces `pinetrie.files-lost`: a copy's fork row reads "its files
    were not kept" from the begun record.
- **The fork is the lane's start, not the send's.** The send writes the
  two records and starts nothing. Every way into a lane already starts it
  on the lane's queue first (a run, a fetch, an update), and that start
  decides, from the fork record and what is there, in one pure plan:

  | fork | disk | its own snapshot, kept | a turn recorded | the start |
  |---|---|---|---|---|
  | owed | any | any | any | fork |
  | begun | yes | any | any | start on it |
  | begun | no | yes | any | restore the newest |
  | begun | no | no | no | fork again |
  | begun | no | no | yes | retired |

  A lane's own snapshots are its history's: for jj, those its revision
  records name; for a folder, its newest state's, which the project keeps
  for every lane, so a folder lane that began always has one and never
  begins twice.
- **Every fork is the same steps:** the record written owed (again, for a
  fork run again), whatever disk and container the lane has removed, the
  clone and the adapter's setup, then the record written begun. A fork
  that stops anywhere leaves the lane owed, and its next start runs it
  from the top.
- **A fork that runs later begins from accepted work as it is then,** or
  from its WIP as it is then, as a fork that waits on lanes being ready
  does today. A WIP that no longer exists refuses the fork, and the lane
  stays owed, its tools saying why.
- **Retired means files the lane recorded are gone.** Its tools say so,
  and to branch from it, as now.
- **The store's lanes get their records once,** by a migration: a lane
  with a revision record, or a folder lane with a start state, is begun,
  with `pinetrie.files-lost`'s snapshot when it has one; any other is
  owed, beginning where its thread does, from accepted work. Then
  `pinetrie.files-lost` is deleted.

**Consequences.**

- **No lane is retired for a fork it never finished.** safe-walnut and
  famous-panther are forked at their next start, from accepted work then.
  The three lanes whose recorded files are gone stay retired.
- **A half-made disk is never run on.** A fork that stopped after its
  clone is run again from the top, so no branch shares its parent's
  working-copy change, and every lane has its own bookmark and immutable
  config.
- **There is one way a lane starts,** and its decision is a value: each row
  of the table is a test with no I/O. The fork's own work is no longer
  queued from the send, and nothing at the host's start goes looking for
  lanes to repair.
- **A send no longer starts work it cannot finish.** The first run of a
  lane forks on the lane's queue, as its tools would wait for anyway; a
  host that stops before the run starts leaves the lane owed and whole.
- **One more record per lane** (319 in Duane's store), small, written at
  its send and at its fork's end.
- **A jj lane's begun record is the only proof its setup ran.** Losing it
  (a store restored from before a fork's end) makes the next start fork
  the lane again, which removes its disk: a lane with turns recorded and
  its record lost would lose the files of its turns after its newest
  snapshot. Begun is never written back to owed except by a fork that is
  about to run.

**Alternatives rejected.**

- **Decide from what is there, with no record.** It tells every case apart
  but one: whether a jj lane's existing disk was set up (S226, S227). That
  one is silent and corrupts your repo, so it is the case a record is for.
- **Read the setup off the disk** (the lane's bookmark, its jj config).
  It is jj's alone, a folder lane differs, and a disk cloned from a
  sibling's carries that sibling's bookmark and config, as S226 measured.
  One stored fact serves both kinds.
- **Keep the fork's progress on `LANE`.** `LANE` is written once and never
  changes, and its readers rely on that; a record of its own changes
  without touching them, as `pinetrie.files-lost` and the queue's hold do.
- **Await the fork in the send.** A send at a host's start would wait on
  the image build, and a crash still loses the fork.
- **Repair at startup:** fork every owed lane as the host starts, as a
  folder's open writes are finished at its first read. It clones disks for
  lanes nobody may run again, and is a second path to the decision every
  start already makes. A lane owed costs nothing until it is used.
- **A machine from `@kyneta/machine`.** Its `Program` keeps its state in
  memory and runs effects through a dispatcher of its own, while the
  trouble here is state that lived in memory, and every step of a lane is
  already serialised on its queue, whose fatal failure stops its tools.
  Two stored values and a five-row plan need no runtime; a plan returning
  a value is how the host decides everything else.
- **Keep retired for every lane with no disk and no snapshot.** Lanes
  whose files are exactly their fork's would stay unusable, though one
  clone rebuilds them.
