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

## `activeRuns`: one stream per lane

`activeRuns: Schema.record(Schema.string())` maps a lane name to the run it is
streaming. A **missing key means idle**; `endStream` deletes the key rather than
setting `""`, so no sentinel survives inside the structure. It replaced a single
`activeRunId` register, which allowed only one stream in the whole document.

This is a change to a **root product field**, and root product fields ARE
reachable by Kyneta's migration walk (S17's control row). So unlike a change to
the entry row, this one is migratable, as a drop plus an add at the root. It was
deliberately not migrated: the value is a transient stream pointer and there
were no users. Recorded precisely so it does not blur S17's finding that
`Schema.record` and sums are the barrier, not root fields.

## Telling "no lane" from "a lane at the root"

`readLaneTip` returns null for both. `hasLaneRecord` separates them: pi writes
the `pi.branch.tip` key when it creates a lane, even before its first entry.
See `packages/pi/TECHNICAL.md` for why this matters.

## Never race a child container (S18)

A child container created lazily under a record key LOSES one writer's contents
when two replicas create it concurrently: nested `values[ns][key]` kept both
writers' values in 0 of 40 trials, against 40 of 40 for the flat layout. Once
the container exists, merging inside it is fine; the hazard is creation.

`pendingText` (a `Schema.text()` per run) and `lists` (a `Schema.list()` per pi
operation) do create child containers lazily. They are safe only because each is
keyed by a globally unique id and only the host replica writes. **Do not key a
lazily created container by anything two replicas could share**: a namespace, a
lane name, a user id. See `docs/findings/S18-nested-values.md`. The rule is ADR-0016.

`values` therefore stays flat, one leaf register per address, keyed by
`physicalKey(namespace, key)`. The (namespace, key) address is pi's; folding it
into one key with a NUL is ours, mirroring pi's reference storage. The key is
an identity, never parsed: readers use each stored value's own `namespace` and
`key` properties. `physicalKey` is the single definition, used by the writer in
`packages/pi` and by point lookups here.
