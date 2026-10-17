# S226 — a fork a host stops part way is never finished: with no disk the lane is called retired, and with its clone made it runs on a disk whose setup never ran, silently

- **Status:** Answered
- **Led to:** ADR-0167

Measured with a disposable scenario in the lanes suite on the Mac's lane
VM (`lifecycle-probe.scenario.ts`, its output `probe.log`), a unit probe
of the folder graph (`folder-begun-twice.ts`), and safe-walnut's host
logs and root traces (`sandbox/root-trace/day4.jsonl`, `day5.jsonl`,
2026-10-17). The rest is read from source at this revision, and says so.

## Brief

**Question.** A new thread's lane is recorded (`recordLane`), and its
fork (`prepareLane` in `apps/pinetrie/host/work/create.ts`) runs later,
as work nobody awaits. What does a host that stops between those steps,
or inside the fork, leave, and what does the next host make of it? Is
running the fork again safe? What does the fork need that only the send
knew?

**Kill criterion.** If the next host already finishes or redoes a fork
stopped part way, there is no gap to design for.

**Throw away.** The probe scenario (kept here as a source, never run
again), its projects and store, and the folder probe.

## Answers

1. **The fork is a sequence with no record of its progress.** In order:
   wait for the turn records being written (`pendingRecords`), wait for
   lanes to be ready (`Setup.ready`: the images, the base snapshot), read
   where it begins (`Destination.begin`), write `FILES_LOST` if its
   source's snapshot is gone, `removeLane`, then `planFork`'s steps (the
   disk restored from the source's snapshot, the container made and
   started, the pre-rename folder removed, the adapter's setup steps),
   then `LaneHistory.begun`. Only the `LANE` record, written before all
   of it, is stored. For jj, `begun` writes nothing
   (`packages/jj/lane/history.ts`). For a folder, it snapshots the disk
   and writes the lane's start state (`apps/pinetrie/host/folder/history.ts`).

2. **Stopped before the disk is made, the lane is retired.** Its next
   start (`startContainer`, `apps/pinetrie/host/work/containers.ts`) finds
   no disk and no snapshot, and `planStartFrom` returns `retired`. That
   is safe-walnut: its `LANE` record was written at 13:04:59, its host
   stopped at 13:05:33 (the last line of `day4.jsonl`), and the next host
   resumed its run and refused every tool. The disks directory held no
   `t-01a14b40-…`.

3. **Stopped after the clone and before the setup, a jj lane runs on its
   source's disk, and nothing reports it.** The probe made two lanes
   whole, then put back each one's disk as `planFork`'s first step leaves
   it: B, branched from A's turn, restored from A's turn snapshot; C, a
   root lane, restored from the base. It then started a host again over
   the same store. Both ran tool calls and recorded turns, and the host
   logged no failure.
   - **B** had A's bookmark and none of its own, and A's immutable
     config (`immutable_heads()` naming A's base, not A's turn). Its first
     commit took the change of A's working copy. After A's next turn,
     your repo held both lanes' tips as one divergent change
     (`qkmkrmknrsnx`, `divergent` true on both), the case ADR-0034's
     `jj new` exists to prevent (S42 item 2).
   - **C** had no `.pinetrie-lane/jj.toml`, so its `immutable_heads()`
     was jj's builtin alone and accepted work's commits were mutable in
     the lane. It had no `base: accepted work` commit; its first commit
     sat on accepted work's commit itself.

4. **A folder lane stopped the same way records no turn** (read from
   source). The folder's fork has no setup steps, so the cut is between
   the clone and `begun`: the disk exists, the lane has no start state,
   and every turn's `newestOf` throws "has no state yet", so every turn's
   record fails while its runs go on.

5. **Running the fork again is safe for jj, and breaks a folder lane that
   already began.** The fork starts with `removeLane`, which clears a
   half-made disk and its container. A folder's second `begun` writes a
   second start state, and its lane then has two newest states:
   `laneNewest` throws `… has 2 newest states: start-a, start-b`
   (`folder-begun-twice.ts`). The start state and `LANE` are both
   session records, so a record of the fork's end could be written in the
   same batch as the start state, and so could never disagree with it.

6. **An ordinary shutdown waits for the fork; only a host that dies
   leaves it undone** (read from source). The fork is `keeper.track`ed,
   `LaneWork.quiet` waits for the keeper's `idle`, which waits for
   tracked work, and the shutdown's `quiet` step waits for that. A second
   signal gets Node's default action (`apps/pinetrie/host/server.ts`), and
   a crash or a kill skips it all. The fork waits on `Setup.ready`, so at
   a host's start the window is the image build and the base snapshot.

7. **safe-walnut's fork waited on an image build for its host's whole
   life.** The next host built `pinetrie-lane:172dbe914973`, and
   `ensureImage` (`packages/lanes/image.ts`) logs a build only when the
   tag is missing, so the host before it never finished building that
   image. The next host also "removed 7 containers left in slot 0 by a
   host that stopped holding it": the host before did not shut down.
   This is inferred from the logs; nothing timed the build.

8. **What the fork needs that only the send knew: the WIP it starts
   from.** `prepareLane` takes `at` and `base` (a WIP bookmark's name, or
   null for accepted work). `base` is held nowhere else: `pinetrie.base`
   is written from your repo after the lane's first fetch, and
   safe-walnut has none. `at` can be read again from the thread's
   `pinetrie.thread` record (`origin`: a fork's entry, or the root).
   `createAndRun` passes the thread's end instead, and the entries
   between are this thread's own chat, which carry no revision records,
   so `nearestRevision` gives the same answer. This is read from source,
   not measured.

9. **A fork that runs late begins from accepted work as it is then,
   already.** `forkFacts` asks `Destination.begin` inside the queued step,
   after `Setup.ready`, so a fork that ran again at the next start would
   begin as a slow fork does today.

10. **No check covers a fork stopped part way.** ADR-0034 defines
    retired as "a lane from before lane containers". The `lanes` suite's
    `main` scenario proves retired by deleting a whole lane's disk and
    snapshots, and its mutations (`scripts/mutations/app.ts`,
    `scripts/mutations/lanes.ts`) prove that check.

## What it points to

- Something durable must say a lane's fork is owed, carrying `base` and
  `at`, written with `LANE`; and something must say it finished, written
  only after its last step. For jj, nothing else can say it: the disk
  alone looks whole (answer 3).
- A start that finds a fork owed runs it again from `removeLane`. A
  folder lane's start state and the fork's end go in one batch, so a fork
  run again never meets a start state already written (answer 5).
- Retired keeps one meaning: files that were recorded and are gone
  (S227).
