# `@pineta/pi` — technical notes

**The pi boundary.** This is the only package that may resolve
`@earendil-works/*`. That is enforced by module resolution, not by a scanner:
pi is declared here and in `@pineta/conformance` (`apps/conformance`) and nowhere else, so from the
app every spelling fails with `ERR_MODULE_NOT_FOUND`. See
`docs/01-architecture.md`.

`index.ts` re-exports our shapes only. No pi type crosses the boundary
(ADR-0003).

## `storage.ts` — our implementation of pi's `Storage` port

### The split and the rejoin (ADR-0015)

pi hands us an `Entry`. The document stores a typed row. Two pure functions do
the conversion, and they are the functional core of this module:

```
toStoredRow(entry)        Entry minus seq  ->  StoredEntryRow
fromStoredRow(row, seq)   StoredEntryRow   ->  Entry
```

Three rules hold them together:

1. **`payload` carries variant data and only that.** `NEVER_IN_PAYLOAD` lists
   the hoisted columns plus `seq`. Duplicating a column into `payload` would
   give `parentId` two homes with nothing keeping them equal — `#reconcile`
   orders arrivals from the column while a renderer might read the blob. A
   round-trip test **cannot** see this, because rejoining from either copy
   yields the same entry. The disjointness test in `storage.test.ts` is the
   only guard.
2. **`seq` is passed to `fromStoredRow`, never read from the row.** It is a
   replica-local arrival index (ADR-0013) and never lives in the document.
   Passing it keeps the pairing visible in the type.
3. **Absent and null are different facts.** `fromId` exists only on
   `branch_summary`, so the column holds `null` for every other type and the
   rejoin restores *absence*. Every message entry hits this path.

`storage.test.ts` is co-located here on purpose: `toStoredRow` takes pi's
`Entry`, so a test under `test/` would import a pi type across the boundary
ADR-0003 exists to hold. `vitest.config.mjs` includes `packages/*/*.test.ts`
for this reason.

### Lanes belong to threads, and never move (ADR-0020)

The host owns one harness. A lane is a thread's line of work: created by
`Agent.createThreadLane(at)` where agent work is first wanted in a thread, named
`laneNameForThread(uuidv7)` (`t-…`), and never navigated. People own no lanes;
a message records its writer (`details.author`, from the transport). A lane's
tip is therefore always its thread's end, and `threadLaneAt` finds a thread's
lane from its end with no stored mapping.

The facade has no way to move a lane: `ThreadLaneHandle` offers only `append`
and `run`. Nor is there a way to READ a tip through the agent: readers use the
document, so observing a lane can never create one.

Three facts from pi's source and the probes shape it:

- **`harness.lane(name, { createAt })` THROWS `UnknownTarget`** for an entry pi
  does not hold, where most of pi's API returns a `Result`. `createThreadLane`
  catches it. The host also refuses a chat at an unknown entry before writing
  anything, because a lane-less append there would reach storage with a parent
  that does not resolve.
- **`harness.lane(name)` creates a missing lane.** So restoring a lane after a
  restart checks `hasLaneRecord` first: pi records a lane's `pi.branch.tip` key
  when it creates it, with a null value until the first entry.
- **A foreign-written entry is not navigable** (`unknown_target`): pi's session
  never saw it created. The Node e2e keeps a `writeEntry` fixture for that S3
  case.

### Conversation threads have no lane (S21)

A thread where the agent has not been asked has no lane. `appendToTree` inserts
its messages with `session.mutate` + `insertEntry`, parented at exactly the
entry the plan chose; the entry is a full member of the tree (navigable, and a
lane can later be created at it, whose agent reads it). The host's serial
executor makes the plan's parent still right when it is written. S21 Q2 showed
the alternative a second host would need: read the thread's end inside
`session.mutate`, an exclusive barrier for the whole session.

### A running lane is never written (S19, S21)

- **Every write that moves a lane's tip goes through that lane.** A `Lane` plans
  from its in-memory state, so a write through `session.mutate` would be stored
  but dropped from its next turn (S19).
- **Not while it runs.** A message appended to a running lane lands by timing:
  inside the agent's turn, as a prompt the agent answers, or after the reply
  while a queued question is never answered (S21 Q3). The host holds such
  messages in `pineta.outbox` (`Agent.hold`/`release`) and drains them when the
  lane is idle; see `packages/marginalia/TECHNICAL.md`.
- **A pi run can only start with `prompt`**, so a compelled chat is passed to
  `ThreadLaneHandle.run` as the prompt itself: a pi `CustomMessage`, which pi's
  default `convertToLlm` sends as a `user` message with its `content`.
- The harness is created with `followUpMode: "one-at-a-time"`, so that pi's own
  queue, if ever reached, answers one message at a time rather than batching
  (S20). Pineta's outbox means the host does not use it.

`laneErrCode(tag)` maps pi's refusal tags for runs and lane creation, so none of
pi's vocabulary passes the boundary (ADR-0003). `UnknownTarget` is the one
specific code; anything else is `refused`.

### Streaming, per lane

Every pi `HarnessEvent` carries `lane`, so `onDelta` reports `{ lane, delta }`.
The host looks the lane's current run up in the document's `activeRuns` rather
than keeping its own map, which would be a second record of the same fact.
Threads run concurrently, and their streams stay apart by lane.

### References

`Agent.addReference` is the only writer of the `pineta.reference` value
namespace, through `Session.setValue` (ADR-0017). It uses the generic value
path, so conformance continues to cover the storage shape.

### `seq` is derived, not stored

`#reconcile` assigns arrival order. The ordering itself is
`orderNewEntries` in `@pineta/core` — pure, and property-tested there for
permutation invariance. This shell only assigns the seqs it returns.

### Deferred: a pure `planCommit`

`#applyCommit` is already close to gather → plan → execute. `#reconcile`
gathers, pi's `prepareStorageCommit` plans, `validateCommittedWrites` checks,
and staged index arrays are applied only after the substrate batch succeeds —
that staging pattern is good and worth keeping.

What remains interleaved is the `switch` inside `batch`, which decides *what to
stage* while performing *the write*. A pure
`planCommit(writes) -> { docOps, indexOps }` would separate them. Deliberately
not done as part of ADR-0015: the row shaping was the right-sized extraction
and holds the subtle logic.

### `deep.ts`

Reaches pi entry points that are absent from its `exports` map, by relative path
into `node_modules`. Those paths are depth-sensitive: they broke when this
package moved under `packages/`. If they break again, the failure is
`ERR_MODULE_NOT_FOUND` at import time, not a type error.

## The contract test

`pnpm run conformance` runs **pi's own Storage conformance suite** against this
adapter, twice (Kyneta-backed and in-memory control). 21/21 + 21/21.

It is the authority on round-trip fidelity — far more thorough than a
hand-written test — and it is the canary for pi upgrades: if pi's `Entry`
envelope moves, this fails at upgrade time rather than corrupting data silently.
It survived 0.85 → 0.87.1 and the ADR-0015 typed-row change unchanged.

Note what it does **not** do: it detects change, it does not design for it.
Probes P1 and P2 in `sandbox/s17-typed-entries/` could each have failed while
conformance stayed green, which is why they ran first.
