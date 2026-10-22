# S319 — Every tool call already waits at its lane's gate; holding a run between tool calls is one more wait there, which must heed the call's abort

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** The ladder's third step (ADR-0210) holds the least
important runs before their next tool call, so nothing in flight is cut and
the model keeps thinking. Where can the host hold a tool call, and what
does a hold there touch?

**Kill criterion.** None: read from the source. The answer names the place,
or says there is none without a change to pi.

**Throw away.** Nothing was written.

## Answers

Read on 2026-10-21.

1. **The gate.** Every method of a lane's `ExecutionEnv` (`laneEnv`,
   `packages/pi/lane-env.ts`) and its shell, which `bash` runs through
   (`laneShell`, the same file), the only ways pi's tools reach a lane,
   first await the lane's `gate()`. The host's gate (`containers.ts`) waits for
   the lane's queue to go idle, then for its channel. So a turn's queued
   end (its commit, snapshot and diff) already holds the next tool call
   until it is done (`apps/pinetrie/host/TECHNICAL.md`, "A turn's end is
   one queued step"). A hold for room is one more await in that gate,
   after the queue's, and needs no change to pi.
2. **What it leaves alone:** a call already past the gate runs on; the
   model's requests do not pass through it, so the agent goes on thinking
   and its next tool call waits. A command's timeout is set in the lane's
   helper when the shell starts (`packages/pi/lane-shell.ts`), after the
   gate, so the wait does not count against it.
3. **What it must add:** the gate does not heed the call's abort signal
   today; `laneEnv` passes the signal only to the channel, after the gate.
   A gate that may wait for minutes must settle when the call is aborted, or
   a Stop pressed while a run is held waits for room.
4. **The start of a run** is held earlier: `beforeRun` starts the
   container (`containers.ts`), and the second step of the ladder (no new
   starts) would hold there.
