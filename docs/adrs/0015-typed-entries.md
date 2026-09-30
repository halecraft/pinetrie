# ADR-0015 — Entries are a TYPED schema; `Schema.any()` only where the pi boundary forces it

**Status:** Accepted. Supersedes the unstated `Schema.any()` choice in
`packages/schema/index.ts`. Blocks `PLAN-2026-09-24-tree-read`, which was
written against untyped entries. Amended by ADR-0051: a message's image
parts in `payload` are references to the blob store.

**Context.** `SessionDoc` declares the primary content of the document as an
opaque blob:

```ts
entries: Schema.record(Schema.any()),
```

The surrounding comment justifies the *record-vs-list* choice (ADR-0009) and
the *no stored seq* choice (ADR-0013) at length, and says **nothing** about
`Schema.any()` — the loosest decision in the file. This ADR supplies the
reasoning that was missing, and reverses the decision.

Kyneta is schema-first. From its README:

> **Schemas should be walked once.** … Kyneta's schema algebra collapses
> [reading, mutation, observation, validation, sync] into one catamorphism with
> pluggable interpreters — all behaviors are derived from the same structure.
> Your schema is the single source of truth not by convention, but by
> construction. Add a field and every behavior follows.

With `Schema.any()` the catamorphism has nothing to walk. For the primary
content of our document we forfeit validation, typed reads, observation
granularity, indexes and devtools. What remains is Loro with extra steps.

The concrete cost is visible in the code. `parentId` — the edge the entire
product is built on, the subject of ADR-0004, ADR-0008, ADR-0010 and ADR-0012 —
sits inside an untyped blob. `projectTranscript`, `orderNewEntries` and the
proposed `projectSpine` are hand-rolled traversals over untyped records,
reimplementing in TypeScript what the schema algebra derives.

**Three claims justified the opacity. All three were checked and two failed.**

1. *"pi's `Entry` has no closed type to express."* **False.** It is a closed
   discriminated union on a stable base:

   ```ts
   type EntryType = "message" | "compaction" | "branch_summary" | "custom"
   type Entry = MessageEntry | CompactionEntry | BranchSummaryEntry | CustomEntry
   interface EntryBase {
     id: string; parentId: string | null; seq: number;
     timestamp: number; type: EntryType; customType?: string;
   }
   ```

   Kyneta has `Schema.discriminatedUnion`, a direct match. Note also that
   `parentId` is **pi's** field: pi's session model is already tree-shaped, and
   `BranchSummaryEntry.fromId` is ADR-0004's merge node. We are not layering a
   tree onto a flat store; we were failing to type a tree that already exists.

2. *"Typing pi's shape couples our `schemaHash` to pi's releases, so a pi field
   addition would stop documents syncing."* **Partly true — corrected twice.**
   Kyneta does have a migration system, and `Migration.add` is tier T1
   identity-preserving, so this looked false. **S17 probe P1 shows the
   `supportedHashes` walk does not reach our entries at all:**

   | shape | reaches the pre-change hash |
   |---|---|
   | nested product (Kyneta's own tested case) | ✅ |
   | plain product inside a `Schema.record` | ❌ |
   | `struct.json` inside a record | ❌ |
   | `struct.json` inside a sum inside a record | ❌ |
   | sum as a root product field, no record | ❌ |

   The walk descends product→product fields only. `Schema.record` is a barrier
   and so is a sum. Since `entries` is a record, **no per-entry schema shape is
   migratable, however it is typed** — sealing the variants would not have
   helped either (row 2).

   What this costs is bounded, and probe P1c measured it: a **new schema reads
   old data locally**, filling absent fields with defaults. The hash matters at
   *Exchange negotiation* between peers on different Pineta builds. Pineta ships
   host and client together, so that is an upgrade-coordination concern, not a
   runtime one.

   **The design consequence is therefore not "seal the variants" but "keep the
   typed surface small and stable."** Every typed field is a field that forces a
   coordinated upgrade when pi moves it.

3. *"`packages/schema` must not import pi."* **True, and it survives.** This is
   the only surviving justification, and it constrains the *leaves*, not the
   structure.

**Decision.** Type the entry envelope as a flat `struct.json` with a small,
stable field set. Seal pi's variant-specific data in one `Schema.any()` leaf.

```
entries: Schema.record(
  Schema.struct.json({
    id:        Schema.string(),
    parentId:  Schema.string().nullable(),   // the tree edge (ADR-0008)
    type:      Schema.string(),              // unconstrained — see below
    timestamp: Schema.number(),
    fromId:    Schema.string().nullable(),   // merge node (ADR-0004), fold (ADR-0010)
    payload:   Schema.any(),                 // pi's variant data, sealed
  }),
)
```

Five sub-decisions, each evidence-backed:

- **A flat struct, NOT `Schema.discriminatedUnion`.** The union was the intended
  design until probe P1. Since migrations cannot reach into a record either way,
  a union buys per-variant validation at the cost of a schema change — and so a
  coordinated upgrade — every time pi adds an entry type. `type` as an
  unconstrained string means **a new pi `EntryType` requires no schema change at
  all.** Minimal surface, maximal tolerance.
- **Type exactly what Pineta reasons about.** `id`, `parentId`, `type` and
  `fromId` are the fields our own traversals read — `projectTranscript`,
  `orderNewEntries`, the planned `projectSpine`, and fold. Everything else is
  displayed, not reasoned over.
- **`.json()`, not plain `struct`.** Entries are written exactly once (ADR-0004,
  ADR-0009), so per-field CRDT merge is machinery we would never use. `.json()`
  is *"a plain-JSON merge boundary — the entire subtree is replaced atomically
  on write, not composed CRDT-style."* `LoroLaws` includes `"lww"`, so it binds
  on Loro.
- **`any()` only at the sealed leaf.** `AgentMessage`, `JsonValue` and `Usage`
  are deep pi / pi-ai types that `packages/schema` may not name. `any()` is
  `ScalarSchema`, hence `PlainSchema`, hence legal inside `.json()`.
- **No `seq` field.** ADR-0013 becomes **structural for stored entries**: an
  undeclared key cannot be written through a typed struct. This closes a
  measured asymmetry — Line messages were already protected structurally by
  `Schema.struct`, while stored entries relied entirely on the runtime
  `findSeqKeys` scan *because* they were `Schema.any()`. After this change that
  scan is a genuine backstop rather than the only guard.

**Probe evidence (S17, `sandbox/s17-typed-entries/`).**

| probe | question | result |
|---|---|---|
| P1 | do migrations reach entry fields? | **no** — record and sum are both barriers; control passed |
| P1c | can a new schema read old data? | **yes** — absent fields take defaults |
| P2 | is the changefeed still O(δ) per entry? | **yes** — typed ≡ opaque, 1 change per write |
| P2b | can P2 detect a regression? | **yes** — 3 writes → 3 changes |

**Consequences.**

- `KynetaStorage` gains a projection on write and a reconstruction on read.
  Round-trip fidelity through pi's `Storage` port is exactly what
  `pnpm run conformance` tests (21/21 + 21/21); it is the control for this
  change, not an afterthought.
- The hand-rolled traversals become candidates for retirement in favour of
  schema-derived reads and `@kyneta/index` for parent→children lookup. Not part
  of this ADR; revisit after the typed schema lands.
- **There is no migration chain to maintain, and that is the constraint, not a
  relief.** Probe P1 showed the `supportedHashes` walk never reaches a value
  inside a `Schema.record`, so no entry-shape change is migratable. Any change
  to the row is a **coordinated upgrade**: ship host and client together. Probe
  P1c bounds the damage — a new schema still reads old data locally, with
  absent fields taking defaults — so what is exposed is peer negotiation
  between different builds, not local read.
- **The tier table does not apply here.** `Migration.add` being T1 and a field
  removal being T2 is true of products reachable by the walk. Our entries are
  not reachable, so no tier is available to us. This is why the typed surface
  is deliberately small: every typed field is one that forces a coordinated
  upgrade if pi moves it.
- Provenance for the sealed `payload` is unrecorded, and P1 removes the
  consolation first claimed here: there is no migration chain acting as a
  version record. `schemaHash` identifies the shape; nothing identifies which
  pi build wrote a payload. See the open question below.
- `PLAN-2026-09-24-tree-read` is unblocked, with `projectSpine` respecified over
  typed rows. `message` lives in the sealed `payload` and is lifted by
  `readRenderableEntries` in `packages/client/projection.ts`.

**Alternatives rejected.**

- *Keep `Schema.any()`.* Forfeits the library's entire value proposition for the
  document's primary content, and leaves ADR-0013 dependent on a runtime scan.
- *Type only the stable base (`id`, `parentId`, `type`, `timestamp`) and seal
  each variant payload.* This was the intended decision until claim 2 was
  checked. It was a hedge against a sync failure that migrations already solve,
  and it would have left `fromId` — ADR-0004's merge node — untyped.
- *Mirror pi's full `Entry`, including `AgentMessage`.* Breaches the pi boundary
  that `packages/schema` exists to hold, and couples us to pi-ai's message
  shape, which is deeper and faster-moving than the entry envelope.
- *A bespoke `formatVersion` field mirroring pi's `JSONL_FORMAT_VERSION = 4`.*
  Largely redundant: Kyneta's migration chain is the versioning mechanism for
  every typed field. Reconsider only for the sealed leaves.

**Open question.** Provenance for `any()` leaves. pi records
`JSONL_FORMAT_VERSION` in a header record; we record nothing about which pi
version wrote a sealed payload. Low urgency while the leaves are opaque
pass-through, but it becomes real the first time we interpret one.
