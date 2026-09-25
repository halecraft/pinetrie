# `@pineta/schema` — technical notes

The Kyneta document shape. Imports Kyneta only, never pi. That pi-free property
is what let spikes S7, S8 and S12 test convergence with no harness in the
picture, and it is worth protecting.

## The entry row (ADR-0015)

`entries` is a `Schema.record` of `Schema.struct.json({...})`: six typed columns
plus one sealed `payload`.

| column | why it is typed |
|---|---|
| `id` | entry identity; ADR-0009 makes uniqueness a safety invariant |
| `parentId` | the tree edge — ADR-0004, ADR-0008, ADR-0010, ADR-0012 |
| `type` | every projection filters on it |
| `timestamp` | ordering diagnostics |
| `fromId` | the merge node (ADR-0004), needed by fold (ADR-0010) |
| `payload` | **not** typed: pi's variant data, sealed |

Everything Pineta reasons about is a column. Everything pi owns is in
`payload`. We type what we traverse.

### Why `type` is an unconstrained string

A new pi `EntryType` then requires **no schema change here at all**. A
`discriminatedUnion` would demand one every time pi adds a variant, and its
discriminant must be a *constrained* literal (`Schema.string("message")`), so
the union is both more brittle and more coupled. Tolerance was the goal.

### Why `.json()` and not plain `struct`

Kyneta classifies a `.json()` node as `register` in `stateTreeRole`: stored as
one leaf tuple, not decomposed into per-field state. Entries are written exactly
once and never edited (ADR-0004, ADR-0009), so per-field CRDT merge is machinery
we would never use. Measured: byte-identical to the `Schema.any()` blob it
replaced.

A consequence to know before reaching for it: **nothing inside a `.json()`
subtree can ever be a Kyneta container.** Path folding short-circuits at the
boundary and navigates the rest with plain property access. Making part of
`payload` collaborative later is therefore not possible without moving it out.

## Gotchas

**`Schema.record` is a barrier to the migration walk.** Kyneta's
`computeSupportedHashes` descends product-to-product fields only. Probe S17/P1
measured it: a plain product inside a record is unreachable, and so is a sum,
with or without a record. Since `entries` is a record, **no change to the row
shape is migratable.** Any such change is a coordinated upgrade, not a
migration. Probe P1c showed the bounded consequence: a new schema still reads
old data locally, filling absent fields with schema defaults; it is peer
negotiation between differing builds that is exposed.

**`null` and absent are different facts.** Kyneta keeps its tombstone marker in
an out-of-band tuple slot precisely because `null` is a legitimate value under a
nullable schema and no in-band sentinel is safe inside a `.json()` blob. Our
`parentId` and `fromId` are nullable while several pi fields are optional, so
the split and rejoin must not collapse one into the other. See `toStoredRow` /
`fromStoredRow` in `packages/pi/`.

**The typed columns make ADR-0013 structural — but only the columns.** An
undeclared `seq` cannot reach a typed column. `payload` is `Schema.any()`, so a
`seq` that got *into the payload* would persist and replicate. `toStoredRow`
names `seq` in `NEVER_IN_PAYLOAD` for exactly this reason. A unit test caught
this during implementation; it is not hypothetical.

**`usageRows`, `values` and `lists` are still `Schema.any()`.** They are pi's
bookkeeping for its `Storage` port, not Pineta's domain model, and nothing of
ours traverses them. The asymmetry with `entries` is deliberate.
