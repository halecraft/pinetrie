# ADR-0197 — A run the last host left open is resumed, whether it crashed or was stopped

- **Status:** Proposed
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/rules/TECHNICAL.md`,
  `packages/pi/TECHNICAL.md`
- **Evidence:** S282
- **Amends:**
  - ADR-0162: a lane's mark in `pinetrie:live` is cleared only when pi shows
    its operation closed, and every run and append asks pi first; a lane is no
    longer left busy until its root next loads.

**Context.**

- **pi and pine·trie each record whether a lane runs.** pi keeps the
  lane's operation open in the root's document until the run settles.
  `pinetrie:live` marks the lane from a run's `begin` to its `end-run`. A
  starting host opens the roots of the lanes still marked (`planLoads`),
  and recovers every other root as it first loads (`recoverRoot`), skipping
  a lane it runs (ADR-0162).
- **A stop cut a thread off for good.** A run waited on the model when its
  host was stopped with Ctrl-C. Closing the harness rejected the run with
  `HarnessClosed` and left pi's operation open, as a crash does (S282), but
  the run's end cleared the lane's mark. The next host opened no root for
  it. The next send loaded the root and began its run before the first-load
  recovery's step, which then skipped the lane. pi refused the run as busy,
  and the host appended the text, which pi queued in the dead operation's
  inbox. No step looked again.
- **Every append assumed an idle lane.** On a lane left open, pi queues an
  append in the inbox, and only a resume delivers it, as a follow-up turn
  no one asked for (S282).

**Decision.**

1. **A drive cut off by a close is `interrupted`.** pi's boundary turns a
   `lane.prompt` or `lane.resume` rejected with `HarnessClosed` into
   `{ kind: "interrupted" }`. pi rejects that way only for a close during
   the call, and a drive's operation then stays open (S282). A close during
   a run's admission commits nothing, and the mark it leaves is cleared by
   the next start, which finds no operation.
2. **An interrupted run leaves its lane marked running.** `planRunEnd`
   gives `left-running` in place of `end-run`, so the next host opens its
   root at startup and resumes it, as after a crash.
3. **A run asks pi before it starts.** `ThreadLaneHandle.isLeftOpen` is
   pi's open operation on a lane no drive of this process runs. A prompt
   there plans `["resume", "prompt"]` (`planRunSteps`), and gathers what it
   is told after the resume. `planAfterStep` decides after each step.
4. **An append to a lane left open is refused `busy`.** A send or a
   delivery refused this way is busy, as on a running lane, and its card
   waits. Every other append logs the refusal.
5. **A Stop while a chat's run resumes keeps the message.** The resume runs
   to its end, which pi's abort brings; then the message is appended,
   unrun.

**Consequences.**

- A stopped host's runs resume when the next host starts, before anything
  queued on their lanes.
- A run never meets an operation another process left open, whatever left
  it and whatever order the first-load recovery and the run's step take.
- No text goes into a dead operation's inbox.
- A thread left stuck before this change recovers at its next send that
  runs: the resume answers what was queued in the inbox first, then the
  new message runs.
- A chat still waiting on its pinned cards when the host stops has no
  operation to resume, and its message is lost, as before.
- Each run start and each append asks pi's lane state once, through the
  session's serial queue.

**Alternatives rejected.**

- **Try the run, and resume when pi refuses it as busy.** It reads a
  refusal after the fact, in a retry, and guards no append.
- **A flag the shutdown sets, read by each run's end.** It marks every run
  ending after it, whether pi left the operation open or not, and misses a
  close the shutdown did not make. The rejection pi gives is its own state.
- **Treat `HarnessFault` as interrupted too.** A faulted harness may not
  run again in this process, so the lane would sit busy until a restart.
- **Fix the race in `recoverRoot`.** Inspecting a lane this host drives
  waits for its run to end, and recovering inside the loading step
  re-enters the root's load. Neither guards an append.
- **Append the message and resume, so pi answers it as a follow-up.** The
  turn would lose its pinned cards, canvas and base news.
- **Fold pi's open operation into the `running` every plan reads.**
  `readRunning` is read synchronously in many modules, and pi's inspection
  is async. The boundary's `busy` reaches the same plans by paths they
  already take.
- **Open every root at startup and ask pi.** ADR-0162 moved away from this
  for its heap and start time (S84, S216).
