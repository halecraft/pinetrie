# S17 — typed entry schema

**Question.** Can the entry envelope be a real Kyneta schema rather than
`Schema.any()`, without coupling us to pi's shape or breaking the `Storage`
port?

**Answer.** Yes, as a flat `struct.json` with six columns and a sealed
`payload`. See ADR-0015. Probes are in `sandbox/s17-typed-entries/`.

## Why this spike existed

`entries: Schema.record(Schema.any())` forfeited everything Kyneta derives from
a schema — validation, typed reads, observation granularity, indexes — for the
document's primary content. `parentId`, the edge the whole product rests on,
sat inside an untyped blob while `projectTranscript` and `orderNewEntries`
hand-rolled traversals over it.

Three justifications were offered for the opacity. **Two failed on inspection,
and the third failed on measurement.** The reasoning is recorded in ADR-0015
because two of the three were mine and someone will otherwise re-derive them.

## Probes

| probe | question | result |
|---|---|---|
| P1 | do migrations reach entry fields? | **no** |
| P1c | can a new schema read old data? | **yes**, with defaults |
| P2 | is the changefeed still O(δ) per entry? | **yes**, typed ≡ opaque |
| P2b | can P2 detect a regression? | **yes** (negative control) |
| P3 | what does typing cost per write? | **1.65× time, 1.00× bytes** |

### P1 — the migration walk does not reach our entries

The decisive finding, and it reversed the design.

| shape | reaches the pre-change hash |
|---|---|
| nested product (Kyneta's own tested case — **control**) | ✅ |
| plain product inside a `Schema.record` | ❌ |
| `struct.json` inside a record | ❌ |
| `struct.json` inside a sum inside a record | ❌ |
| sum as a root product field, no record | ❌ |

`computeSupportedHashes` descends product-to-product fields only. `Schema.record`
is a barrier and so is a sum. Since `entries` is a record, **no per-entry shape
is migratable, however it is typed.**

Two consequences. First, the "type the base, seal the variants" hedge would have
bought nothing (row 2 fails too). Second, since no shape is migratable, the goal
becomes the *smallest stable typed surface* — which is why `type` is an
unconstrained string rather than a `discriminatedUnion` discriminant.

The control passing is what makes this finding trustworthy. Without it, five
failures would have been indistinguishable from a broken probe.

### P1c — the bounded consequence

A new schema reads a document written by the old one, with absent fields taking
schema defaults. The hash difference bites at **Exchange negotiation between
peers on different builds**, not at local read. pine·trie ships host and client
together, so this is upgrade coordination.

### P2 / P2b — changefeed granularity is unaffected

Typed rows produce exactly one change per write, the same as the opaque blob,
read through the same `op.path.segments` + `coord()` accessor
`KynetaStorage.#reconcile` uses. P2b is its negative control: three writes
produce three changes, so P2's "1" means something.

### P3 — write cost

500 entries, same stream through both schemas:

```
TYPED   33 ms   227 374 bytes
OPAQUE  19 ms   227 375 bytes
ratio   1.65×      1.00×
```

**Bytes are identical** — `.json()` stores one leaf tuple, exactly as
`Schema.any()` did. **Time is a genuine 1.65× regression**, consistent across
runs, about 26 µs extra per entry for the schema walk. Reported rather than
waved through: the plan's success criterion said "no measurable regression" and
this is measurable. Accepted because entries are written a handful per turn, and
the walk is what buys validation and typed reads.

## What implementation added

**A bug the unit test caught.** `seq` is not a hoisted column, so it fell
through into `payload` — and `payload` is `Schema.any()`, so it would have
persisted and replicated. The claim that ADR-0013 is "now structural" was true
of the columns only. `toStoredRow` names `seq` in `NEVER_IN_PAYLOAD`.

**A second reader the plan predicted.** `e2e/e2e.ts` ran its own
`projectTranscript` over raw entries, bypassing `client/projection.ts`. Once
`message` moved into `payload`, the host projected zero messages while the
client projected two. This was transitive effect #5 in the plan, and it
presented exactly as predicted: both readers must go through one module.
`readRenderableEntries` is now that module's export and both use it.

**A boundary the test location surfaced.** `toStoredRow` takes pi's `Entry`, so
a test under `test/` would import a pi type across the ADR-0003 boundary. The
test is co-located in `packages/pi/` instead, and `vitest.config.mjs` includes
`packages/*/*.test.ts`.

## Cleanup found afterwards

**`docs/02-decisions.md` had been silently duplicated.** ADR-0002 through
ADR-0015 appeared twice, 1559 lines for 15 ADRs. Cause: an edit used
`s.index("**Consequences.**")` with no start offset, so it matched ADR-0001's
heading near the top of the file and re-appended everything from there. The
stale second copy still specified the `discriminatedUnion` we rejected, so a
reader would have been told to build the wrong thing.

Worth recording because the first repair attempt reproduced the same bug:
`next(i for i, l in ...)` again matched ADR-0001's occurrence rather than the
intended one. Positional edits into a long document need explicit line numbers
or a bounded search window, not a first-match index.

Two ADR-0015 consequences were also stale, written before P1 and contradicted
by it: *"we must now maintain a migration chain"* and *"a pi field removal is
the expensive case (T2)"*. Neither is true when the walk never reaches the
value. Both corrected.

**Dead code removed.** `readEntry` was added to `packages/schema` as a typed
helper and used nowhere. **`EntryLike` tightened**: `id`, `parentId` and `type`
are guaranteed by the typed row, so they are no longer optional; only `message`
remains optional, for entries that carry none. **`e2e/e2e.ts` kept a stale cast**
of `readEntries(...)` to `Record<string, EntryLike>`, which stopped being true
the moment entries became rows.

## A pre-existing type bug the cast audit exposed

`StoredEntry = Omit<Entry, "seq">` had been in `storage.ts` since the adapter
was written. **`Omit` over a union collapses it to the keys common to every
member**, so that type silently discarded `message`, `summary`, `fromId`,
`retainedTail` and every other variant field. The adapter's internal entry type
was far weaker than pi's actual `Entry`, and nothing complained, because the
weaker type accepts everything.

It surfaced only when the new unit test stopped using `as never` on its
fixtures. Fixed with a distributive conditional, which needs a naked type
parameter to distribute:

```ts
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never
export type EntryWithoutSeq = DistributiveOmit<Entry, "seq">
```

`UsageRow` is a plain interface, so `Omit<UsageRow, "seq">` is correct and was
left alone.

The test originally carried eight `as never` casts on its fixtures. That
defeated the check that matters: the file claims to round-trip *pi's four entry
types*, but an unchecked fixture would keep compiling and keep passing after pi
changed its `Entry`, while covering nothing. One cast remains, on a deliberately
invented future entry type, with a comment saying why.

## Do we need typebox? No.

pi depends on `typebox@1.3.27`, but `dist/types.d.ts` has
`import type { Static, TSchema }` — it is used for **tool parameter schemas**.
pi ships no `Entry` schema and no entry validator, so there is nothing to call.

Adding typebox would mean hand-writing a copy of pi's `Entry` union in this
repository: the "mirror pi's shape" alternative ADR-0015 rejects. It would also
put two schema languages on one piece of data, which is two sources of truth.

The `as unknown as Entry` in `fromStoredRow` trusts less than it appears to:

| | checked by |
|---|---|
| columns | the Kyneta schema; a row from a differently-built peer materializes missing fields as **defaults**, not garbage (measured in P1c) |
| write path | pi's own `validateCommittedWrites`, already called in `#applyCommit` |
| `payload` | nothing, and nothing can without pi's schema |

So the residual is provenance for `payload` — ADR-0015's open question — rather
than a defect in the function. Recorded in the code comment.

One cast nearby *was* avoidable and is gone: `toStoredRow` read `fromId`
through `entry as { fromId?: string | null }`. The discriminant narrows it
instead (`entry.type === "branch_summary" ? entry.fromId : null`), so if pi
renames or drops that variant the comparison stops type-checking.

## Mutation battery

Five mutations, all killed:

| mutation | caught |
|---|---|
| `payload: entry` unmodified (the duplication hazard) | 2 tests |
| drop `fromId` during the split | 2 tests |
| coerce absent `fromId` to null | 3 tests |
| forget to rejoin `payload` | 2 tests |
| let `seq` into the payload | 1 test |
