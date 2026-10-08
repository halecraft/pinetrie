# S103 — A lane can catch up in the middle of a run, if the call is alone in its batch and its turn's record names the merge

- **Status:** Answered
- **Led to:** ADR-0080, ADR-0104, ADR-0105, ADR-0108

**Question.** ADR-0080 gives the agent a `catch_up` tool. Today a catch-up
runs only between runs (`prepareUpdate`, `apps/pinetrie/host/work/update.ts`),
and "a running lane is never written" (`packages/pi/TECHNICAL.md`). During a
run:

1. Can the merge run on the lane's queue while the run waits on the tool,
   without one waiting on the other?
2. How does the merge meet edits the turn has not committed?
3. Can the merge be recorded as a revision at the tool's turn, so a branch
   from there starts with the merged files?
4. How would a running thread be told its base moved: how does pi store a
   steering message, and what does that do to the prompt cache?

**Kill criterion.** A merge during a run that can lose the agent's edits, or
leave a branch without the merged files, with no fix inside pine·trie's own
code: then the tool waits for the run's end, as a queued card does.

**Throw away.** `.plans/s103-probe/` (`probe.sh`, `results.txt`): a jj
script in throwaway repos. jj 0.44.0.

## Answers

1. **No deadlock: a run does not hold the lane's queue** (read). The queue
   (`createQueue`, `packages/lanes/lane.ts`) is a chain of promises. A
   run's tool calls wait on it only when they start: the lane's `gate()`
   (`apps/pinetrie/host/work/containers.ts`) awaits `queue.idle()`, then
   hands over the channel (`laneEnv`, `packages/pi/lane-env.ts`). A turn's
   commit and snapshot are tasks on it (`turnDone`,
   `apps/pinetrie/host/work/turns.ts`). A host tool such as `catch_up` makes
   no `env` call, so it can enqueue `updateOnQueue` and await it, after
   the previous turn's snapshot. Two hazards:
   - **A call already running is not held.** pi runs a batch's calls in
     parallel (`toolExecution` defaults to `"parallel"`), and the harness
     reads only the run's setting, never a tool's own `executionMode`
     (`runtime/drive/tools.js`; the per-tool override is honoured only by
     pi-agent-core's older `agent-loop.js`). A `bash` started before the
     merge goes on running in the lane while jj rewrites the working copy.
   - **`prepareUpdate` cannot be called as it is.** It wraps the merge in
     `withLaneStarted`, whose `runEnded` stops the lane's container: in
     the middle of a run, the next tool call would find it stopped. Its
     `applySettle` appends the update to the lane, which a running lane
     must never be (S21). The tool needs `updateOnQueue` and `planSettle` without
     them, and its result in place of the appended entry.

2. **An edit not yet committed leaves the working copy** (measured, case
   B). When `mergeUpdate`'s `jj new <ours> <from>` runs over an edit a
   sibling call made, jj snapshots it into the old `@`, which is on no
   bookmark, and checks out the merge without it. `sibling.txt` is gone
   from the lane's files; the edit survives only as a head with no
   description. Between runs `commitEdits` commits such edits first (case
   C: the merge then holds them). In a run, at the moment a call alone in
   its batch executes, there is nothing to commit: `before_request` has
   just committed every earlier turn, and awaited it (`turnDone`). Edits
   are uncommitted only when sibling calls in the same batch made them.
   - **pi has stored the batch's assistant message before its calls run**
     (read: `readToolBatchSource`, `runtime/drive/tool-placement.js`), so
     the host can read the calls of the message at the lane's tip
     (`toolCallsOf`, `turns.ts`) and refuse a `catch_up` that has
     siblings. pi's `before_tool` hook can also block a call with a reason.

3. **Not as `turnDone` stands: the catch-up's turn records no commit, and
   a branch from it loses the merge** (measured, case A; read). After the
   merge, `@` is empty on the merge, and the bookmark is the merge. At the
   next request `turnDone` reads the bookmark as `before`, `commitTurn`
   plans `none` (one parent, equal to the bookmark: `planTurnCommit`), and
   `planTurnRecord` writes the turn with `commit: null` (not a prompt, so
   not `newest`). The turn's snapshot holds the merged disk, but a branch
   takes its commit from the nearest record that has one (`nearestRevision`,
   `packages/core/work.ts`), which is before the merge, and starts on it
   (`forkPoint`): its files are the lane's before catching up.
   - **The fix is in `turnDone`'s plan**: a turn in which the lane's
     bookmark moved without a commit of the turn's own (the bookmark is not
     the commit the nearest record above names) records the bookmark. A
     later turn commits on the merge as usual (case D: `next turn < merge <
     L`).
   - **The merge's message carries `Pinetrie-Base`** (`planMerge`), so the
     lane's base is read from its history as after any catch-up
     (`newestBase`). A catch-up with the parent is read differently:
     `parentNow` (`packages/rules/line.ts`) finds what the lane took from
     the update entry's `merged`, so the tool's result must carry the
     merged commits in its `details`, and `parentNow` read them there.

4. **pi's steering puts a message into the tree at the next boundary;
   appended, it keeps the cache** (read). pi's `Lane.steer` queues an
   entry in the lane's inbox (`enqueue`, `runtime/lane.js`).
   `planBoundaryInbox` (`runtime/drive/boundary.js`) inserts it after the
   batch's tool results, before the next request, as an ordinary entry of
   the branch: in the timeline and in what the model reads, at a place
   decided by the boundary, not by timing. It is appended, so every request
   after has the same prefix; S92's loss came from moving text to the end of
   each request, which this does not.
   - **At the run's last boundary it costs a request.** When the agent has
     finished (`may_finish`), a queued steer becomes the trigger of one more
     assistant request (`runCheckpoint`, `runtime/drive/checkpoint.js`).
     A steer still queued when the run ends is accepted before the next
     run's prompt (S71 item 4).
   - **`turnDone` would key that turn on the steer.** It records a turn at
     `turnEntry(tip)`, which climbs only through tool results; with a steer
     at the tip it stops at the steer, not at the assistant message that
     made the calls. It must climb past a host's fact too.
   - **pi's `after_tool` hook** can replace a call's result, and could
     carry the fact inside, say, a `bash` row, without a request. It mixes
     the host's fact into the output of an unrelated call, and says nothing
     when the run ends with no tool call.

**Decision.** The catch-up tool acts during the run (ADR-0080), on four
conditions: it is refused unless it is alone in its batch; it calls the
merge on the lane's queue without `withLaneStarted` or the appended entry,
and its result is the fact; `turnDone` records a moved bookmark as its turn's
commit; and its result's `details` carry the merged commits for
`parentNow`. A running thread whose base moves is told by a steer, and
`turnEntry` climbs past it.

**What was not run.** A lane of its own needs Apple's `container`, which
this lane does not have; nothing here ran through pi or a container. The
plan's tests check items 1 and 3 with the host's fakes, and the cache in
item 4 with the faux provider's estimate (`withUsageEstimate`, as the
pinned cards' test does).
