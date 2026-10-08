# S71 — what pi says about a run's prompt when the run ends

- **Status:** Answered

Measured in a lane (Linux, Node 24, pi 0.87.1), for
`PLAN-2026-10-02-final-digest-ask`. The question: could `runs.ts` learn the
prompt of the run that just ended from pi itself, instead of looking it up
from the lane's tip? The probe drove `createAgent` with a `ScriptedModel`, as
`packages/pi/lanes.test.ts` does. A throwaway patch to `packages/pi/agent.ts`
recorded what `lane.prompt` and `lane.resume` returned and the harness's
events. The probe is kept under `sandbox/s71-run-prompt/` and was not
committed.

**Answers.**

1. **pi returns no prompt id** (read, and measured). A run that pi accepted
   resolves with an `OperationResultRecord`: `operationId`, `kind`, `status`
   (`completed`, `failed` or `aborted`), `error` when it failed, `fromTipId`,
   `tipId`, `startedAt` and `endedAt`. The prompt's ids live only in the
   operation's meta (`intent.promptEntryIds`), and pi deletes that when the
   run ends (`runtime/drive/terminal.js`).

2. **`tipId` is the lane's tip at the end, and its prompt is the run's
   prompt** (measured). In every case the probe ran, the record's `tipId`
   was the lane's tip read straight after, and `promptOf` of it was the run's
   prompt. So was the child of `fromTipId` on the path to `tipId`. The cases:

   | case | `status` |
   |---|---|
   | answered | `completed` |
   | a tool call, then an answer | `completed` |
   | a run after a plain message was appended | `completed` (`fromTipId` is the appended message) |
   | model error | `failed` |
   | Stop before the first response | `aborted` |
   | Stop during a running command | `aborted` |
   | resumed after a crash | `completed` (`fromTipId` is the tip before the crashed run started) |

3. **The prompt can be learned when a run starts, but not when it is
   resumed** (measured). A run that pi accepts emits `run_start`, then a
   `message_end` carrying the run's id and the prompt's `entryId`. A resumed
   run emits neither, so its first `message_end` is its next tool result or
   reply.

4. **When pi accepts a run, it chains its own inbox before the prompt**
   (read: `acceptRun` in `runtime/lane.js`). Steers, follow-ups and writes
   queued in pi's inbox become entries between `fromTipId` and the prompt.
   pine·trie queues nothing there, because a lane is never written while it
   runs (S21). If it ever did, the child of `fromTipId` would not be the
   prompt, but `promptOf(tipId)` still would be, since the prompt is
   the last entry in the chain.

**Consequence.** The lookup `runs.ts` makes at the start of a run's end,
`promptOf` of the lane's tip, gives the same answer as pi's own `tipId`
in every ending measured, a resume included. Passing pi's `tipId` back
through `ThreadLaneHandle.run` would replace a sound lookup with an equal
value. It would also lose the prompt when `run` throws, and a land or stack
run's end still needs that prompt for `landingEnded` and `splitEnded`. So
the run's end keeps its lookup. The fix that matters is downstream: once the
run's end has the prompt, it passes it on as a value, and nothing after it
looks it up again (`PLAN-2026-10-02-final-digest-ask`).
