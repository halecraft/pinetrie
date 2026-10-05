# S104 — A run's last turn is recorded however the run ends, except when the host closes under it, which the next host's resume records

**Status:** Answered. Led to ADR-0080 (a resolution run ends like any
run: no `pinetrie.landing`).

**Question.** ADR-0033's outcome of a resolution is read once, at the end
of a run whose prompt is a land message (`landingEnded`,
`apps/pinetrie/host/work/update.ts`): the conflicts jj finds left in the
lane, and whether the agent called `ask_for_guidance`. ADR-0080 would read
the same facts for any run instead. Two things must hold first:

1. Is a run's last turn recorded (`turnDone`) however the run ends: a
   reply, a Stop while the model replies, a Stop while a tool runs, a
   model that fails, the host closing mid-run?
2. What does a reader see where a turn has no revision record?

**Kill criterion.** A way for a run to end, short of a crash, that leaves
its last turn unrecorded and nothing later recording it: then the end of
a resolution still needs a step of its own.

**Throw away.** `.plans/s104-probe/` (`probe.test.ts`, `results.txt`): a
vitest file that ran inside `packages/pi`, over a scripted model and a
direct lane, recording every `turnDone(lane, tip)`.

## Answers

1. **Every ending but the host's close records the last turn at the newest
   entry** (measured, cases A to D). `ThreadLaneHandle.run` and `resume`
   call `recordTurn` once more after pi's `prompt` returns
   (`thread-lanes.ts`, `turn`), and pi returns `ok` for a run it admitted,
   however it ended:

   | case | run returns | newest entry | last `turnDone` there |
   |---|---|---|---|
   | A: a reply | ok | the final assistant message | yes |
   | B: Stop while the reply is held | ok | an assistant message, `aborted` | yes |
   | C: Stop while `bash` runs | ok | the tool result, aborted | yes |
   | D: the model fails | ok | an assistant message, `error` | yes |
   | E1: the host closes mid-run | rejects `HarnessClosed` | the assistant's tool call | no |
   | E2: the next host resumes it | ok | the final assistant message | yes |

   - **E is the crash path, and it is covered.** The lane stays
     interrupted (`interrupted` lists it), so it reads as running, not
     ended, until a host resumes it. Startup resumes each interrupted
     lane before anything waiting for it (`recover`). The resumed run records the
     interrupted tool result's turn, then its own.
   - **`landingEnded` does no better there.** After `HarnessClosed`, the
     run's end runs against closed queues (`apps/pinetrie/host/TECHNICAL.md`,
     Shutdown), so its `conflictsIn` and its record are lost too.

2. **A turn with no record is read through the nearest one above it**
   (read). `planTurnRecord` (`packages/rules/work.ts`) writes no record for
   a turn that is not a prompt, called no tool and made no commit, which is
   a run's closing reply. Every reader walks up to the nearest record with a
   commit (`nearestRevision`, `packages/core/work.ts`), and that commit is the
   lane's bookmark then: every turn commits what `@` holds (`commitTurn`).
   Its `conflicts` are fixed with it (`conflictsAt`).
   - **A record can be late.** `turnDone` commits and awaits the commit,
     but writes the record after the turn's snapshot, without awaiting it
     (`turns.ts`). So a read made in the middle of a run can find the
     previous turn's record.
   - **The outcome needs neither.**
     - **Conflicts left:** the offer, built from the lane's tip at the
       run's end, carries the lane's conflicts. ADR-0072's `conflictCause`
       exists because it does.
     - **Whether `ask_for_guidance` applies:** that is better asked of jj
       in the lane, on its queue (`conflictsIn`), when the tool is called.
       That read is what `landingEnded` makes, it is never late, and it
       works in any run.

**Decision.** A resolution ends like any run (ADR-0080), and
`ask_for_guidance` is renamed `ask_about_conflict`:
- `ask_about_conflict` is accepted while jj finds conflicts in the
  lane's copy, read on its queue when it is called, and its result says it asked.
- The strip's "needs you" is read from the tree: the thread's newest ask
  about a conflict, newer than the offer.
- Conflicts left are the offer's.
- `landingEnded`, the `asked` set and `pinetrie.landing` go.

**What was not run.** Nothing here ran in a container or against jj; the
lane worked directly. Case 2 is read from source.
