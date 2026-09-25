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

### One harness, a lane per writer

The host owns one harness. Each connected client is a writer with its own lane,
named `laneNameForWriter(peer)` from the transport's `LineSender.peer` (ADR-0011),
so a client can only drive its own lane. The host has no writer identity; the
`replicaId` passed to `createAgent` is the process's storage identity, which is
a different thing.

`Agent.lane(name)` returns a `WriterLane` with `create`, `navigate` and `run`,
each returning a `LaneOutcome` (`ok`, or `refused` with our `ErrCode`). pi
`Lane` objects are single-writer state (S3), so they are held one per writer
and never shared. There is deliberately no way to READ a tip through the agent:
readers use the document, so observing a lane can never create one.

### Attaching is a decision

A turn runs at its lane's tip. Moving the lane somewhere first is decided by
`planAttach` in `@pineta/core`, which returns `create`, `navigate` or `stay`.
The host carries that out, awaited, **before** it replies, so any refusal comes
back to the client as a structured rejection. Only the run itself happens after
the reply. Three pi behaviours, read from pi's source, shape this:

- **pi refuses to navigate a lane to its current tip** (`InvalidNavigation`,
  reason `current_tip`). That is why `stay` exists. Branching from your own tip
  used to fail.
- **`harness.lane(name, { createAt })` ignores `createAt` if the lane already
  exists**, in memory or restored from storage. So `create` is only correct
  when the lane really is absent.
- **`harness.lane()` THROWS `UnknownTarget`** for an entry pi does not hold,
  where `navigateTree` returns a `Result`. `WriterLane.create` catches it, so
  nothing thrown by pi reaches the host.

Telling "no lane" from "a lane at the root" is therefore load-bearing, and both
have a null tip. Measured (`sandbox/empty-lane-tip.ts`): **pi records the
`pi.branch.tip` key when it creates a lane**, with a null value until the first
entry. So the document alone distinguishes them, through `hasLaneRecord`, and
the host reads it rather than the agent's cache. That also keeps it correct
across a host restart.

`laneErrCode(tag)` maps pi's refusal tags for runs, navigation and lane
creation alike. Before it was shared, a run's refusal passed pi's raw tag
through, which leaked pi's vocabulary past the boundary (ADR-0003). An unknown
tag becomes `refused` rather than a navigation-specific code.

A foreign-written entry is not navigable (`unknown_target`): pi's session never
saw it created. The Node e2e keeps a `writeEntry` fixture for that S3 case.

`NavigateOptions.summarize` emits a `branch_summary` entry, ADR-0010's fold,
unused for now. `projectSpine` drops non-message entries, so one would vanish
from the spine silently.

### Streaming, per lane

Every pi `HarnessEvent` carries `lane`, so `onDelta` reports `{ lane, delta }`.
The host looks the lane's current run up in the document's `activeRuns` rather
than keeping its own map, which would be a second record of the same fact.

### Turn state

One `TurnState` per writer, in a map the host keeps for the life of the
process. A small record per writer that ever connected is never removed, which
is acceptable for v1.

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
