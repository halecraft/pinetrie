# `@pineta/pi` — technical notes

**The pi boundary.** This is the only package that may resolve
`@earendil-works/*`. That is enforced by module resolution, not by a scanner:
pi is declared here and in `@pineta/conformance` and nowhere else, so from the
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

### Branching is `navigateTree` then `prompt`

`lane.prompt` has no parent parameter: pi always appends at the lane tip. So a
branch is "move the tip, then prompt", and pi supports exactly that through
`lane.navigateTree(targetId, options, context)`. We do not reimplement a tree
operation pi owns.

`Agent.run(text, parentId)` is one method rather than a separate `branch()`:
both map pi's `RunResult` the same way, and a duplicated mapping is where
"navigation succeeded but the prompt failed" gets handled in one copy and not
the other. `Agent.navigate(targetId)` moves the tip without running a turn.

`navigationErrCode(tag)` is pure, so pi's error union can be mapped to our
`ErrCode` without a harness. `agent.test.ts` covers it, including that an
unrecognised tag falls back rather than throwing: pi may add error tags, and
reporting the wrong navigation code is recoverable while throwing inside the
host's reply path is not.

**`Agent.navigate` has no command wired to it yet.** It is currently reached
only by a test fixture, which is a smell with a cause: `navigateTree` moves
the lane onto a branch and nothing moves it back, so a branch is one-way and
"return to your lane" returns to the branch. Wiring a `navigate` command is
what completes step 2. It is NOT a run — no runId, no stream — so it needs its
own decision rather than the `run` variant a branch shares with a prompt.

**A foreign-written entry is NOT navigable.** An entry written straight into
the document with `writeEntry` is refused by `navigateTree` with
`unknown_target`: pi's session index never saw it created, so its tree
navigation cannot reach it. This is why the browser suite creates its branch
fixture through `agent.run` while the Node suite keeps a `writeEntry` fixture
for the S3 foreign-write scenario. They exercise different halves, and only
one of them is navigable.

**A run's outcome cannot travel back as a rejection.** The host replies with
the ACCEPTANCE before the run starts, so a refusal from pi (an unknown
navigation target, say) arrives after the reply has gone. The host logs
`run … REFUSED: …`; the client never learns. Carrying it back needs a second
message on the Line, which the protocol does not have yet.

**`NavigateOptions.summarize` emits a `branch_summary` entry.** That is
ADR-0010's fold, unused for now. Note the hazard before reaching for it:
`projectSpine` drops non-message entries, so a `branch_summary` would vanish
from the spine silently.

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
