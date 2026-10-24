# S338 — Where does a send wait while its lane cannot start, what shows it waiting, and what becomes of its text when the host restarts?

- **Status:** Answered (questions 1 and 2; 3 and 4, what a restart does with a
  waiting send, are left to the plan's checks)
- **Led to:** ADR-0212

**Why.** On 2026-10-24 a person sent a get-the-latest and a message to
foggy-garnet's stopped lane while the gate held starts and no sample had
ended since 12:17:44 (S334, S336). The message never appeared; the resend
showed "sending…" until the host was restarted, and then neither message
was in the thread. A send to a lane with no work of its own whose base has
new work catches it up first and writes the message after
(`getLatestFirst`, `apps/pinetrie/host/commands/send.ts`); the composer
waits on the send's outcome with its box read-only (`card-editor.tsx`,
`packages/web`; `card-state.ts`, `packages/interface`). A held start is
recorded, and the column's held line written, only by a sample's plan
(`waitUntilAllowed`, `packages/machine/manager.ts`;
`apps/pinetrie/host/work/memory-holds.ts`).

**Question.**

1. With the gate holding starts (a stand-in sensor at rung 3, as the
   `memory-gate` scenario makes one): does a send to a stopped lane wait
   at the gate, and at which await: the update's (`prepareUpdate`), the
   run's start, or another? Is the message written before or after it?
2. While it waits, what do the column, the composer and the Machine page
   show? With samples still ending, and with none ending (S336)?
3. When the host stops while a send waits (its close, and a kill): is the
   message written, refused, or dropped; does the next host do anything
   with it; and what does the composer do with its text, kept in the box
   or a card, or gone?
4. A get-the-latest on a stopped lane while the gate holds: the same
   questions.

**Kill criterion.** A send never waits at the gate before its message is
written: then the incident's send was lost elsewhere, and the spike
follows it (the host's log of that send, its outcome on the page).

**Throw away.** The probe's hosts and lanes (the e2e harness's, in a
scenario of its own); kept only if a plan's check builds on it.

## Answers

Read from source on 2026-10-24, and the deadlock reproduced with the real
manager in a throwaway probe.

1. **A get-the-latest on a stopped lane waits at the gate, holding the
   documents' keeper.** `prepareUpdate` (`apps/pinetrie/host/work/update.ts`)
   runs inside `withLaneStarted`, which asks the lane's start
   (`containers.beforeRun`, held at the gate by `createStartHolds`) and
   queues the merge behind it on the lane's queue; it holds its documents
   step through the start and the merge, so every command and drain waits
   for it (`apps/pinetrie/host/TECHNICAL.md`, "Getting the latest holds its
   step"). A chat that gets the latest first (`getLatestFirst`) and a
   queued card's catch-up do the same. So while the gate holds starts,
   one get-the-latest on a stopped lane stops every command on the host,
   every thread's sends included: a send waits behind it before its
   message is written, and its lane is never asked to start. That is why
   no decision named foggy-garnet's lane.
2. **The health's write waits on the same keeper, so the gate deadlocks.**
   A sample ends by writing the health (`writeHealth`,
   `packages/machine/manager.ts`), which the host's sink runs as a step of
   the documents' keeper (`createHealthSink`,
   `apps/pinetrie/host/machine/sink.ts`). The first sample that plans the
   waiting lane changes the health, and awaits a step behind the
   get-the-latest; the get-the-latest awaits a sample's plan that lets its
   lane start; no sample runs beside another. The probe: the real manager
   at rung 3, a serial stand-in for the documents' keeper holding a step
   that awaits `waitUntilAllowed(lane, "container-start")`, its sink
   writing through the same keeper. The next sample never ended; with the
   pressure gone, none of the 28 samples asked after it ended; the start
   was never allowed. The reading the Machine page serves (set before the
   write) kept rung 3 with the lane waiting, and the health written never
   gained it: the incident's frozen page, and the held line its columns
   never showed. In the incident the 12:16:39 sample's write (fleet-creek)
   went through and the 12:17:44 sample's (steady-feather) did not, so a
   get-the-latest began to hold the keeper between them, most likely
   steady-feather's own start.
3. Not run: what a host's stop does with a send that waits so. In the
   incident the send's text was in neither the thread nor the composer
   after the restart.
