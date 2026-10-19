# S268 — Lane work can wait for its lanes before the project starts, so what startup found can hold them as a value

- **Status:** Answered
- **Led to:** ADR-0191

**Question.** S265 awaited lanes' preparation just before `startHttp`.
Waiting earlier, inside `startLaneWork` (`apps/pinetrie/host/work/index.ts`)
right after `startSetup` and before `opened.start`, would let `Setup` hold
a `Ready` value instead of a promise: every `await setup.ready` in lane
work, the adapter's `ready` and the folder adapter's `parts.ready()` would
go. Before that point the project's adapter has not started, the agent
does not exist, and `recover` has not run.

1. Does the preparation finish when awaited there, for a jj project and a
   folder project? Read from source first: jj's owner starts its first
   observation when it is made (`packages/jj/owner.ts`), so accepted
   work's pinned read does not wait on `opened.start`; a folder project's
   `acceptedNow` reads its line, which needs lanehost, and the slot is
   filled earlier in the same preparation.
2. Does a first turn after the start still wait for no build?

**Kill criterion.** If any start does not return in 15 minutes, or
returns before the preparation ends, the wait stays where S265 put it and
`Setup.ready` stays a promise.

**Throw away.** The patch and probe, kept in this spike's folder if a
plan builds on them.

## Answers

1. **It finishes, for both kinds.** With `wait.patch` (`await
   setup.ready` before `opened.start`), every start returned with the
   preparation ended before it:

   | start | wait for lanes | `startHost` to return |
   |---|---|---|
   | jj, fresh project and session | 4.6 s | 6.6 s |
   | jj, restart, accepted work moved; observer's image and container removed | 4.3 s | 4.6 s |
   | jj, restart, nothing changed | 1.1 s | 1.3 s |
   | folder project, fresh | 4.4 s | 4.6 s |
   | folder project, restart | 1.0 s | 1.2 s |

   The moved restart remade the base snapshot and rebuilt and started the
   observer inside the wait, as in S265.
2. **A first turn waits for no build:** 1.0 to 3.3 s from the send to
   idle on the scripted model. In the fresh jj project, accepted work was
   set up only after the start, so its first turn made the base
   snapshot, as in S265.

The start's lines change order: `agent ready` now follows the
preparation, since pi's agent is made after lane work.

**Measured** on the Mac's lane VM, 2026-10-19, with `probe.ts` (S265's,
with a folder project added), the suite's places and a scripted model.

**Sources,** in this spike's folder: `wait.patch` (thrown away) and
`probe.ts` (run from `apps/pinetrie/e2e/`).
