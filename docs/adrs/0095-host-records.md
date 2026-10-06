# ADR-0095 — The host's records live apart from pi's values, written by the host; the session has its own schema

**Status:** Proposed. Evidence: S120. Implemented by
`PLAN-2026-10-06-schema-boundaries`. Amends ADR-0062 (pi no longer carries
the host's writes), ADR-0063 (the session's document has its own schema)
and ADR-0092 (the scribe has no `writeValues` and no session). Sits beside
ADR-0003: `@pinetrie/schema` imports no pi, and defines how pi's data is
laid out in our documents.

**Context.** The host's records (the directory, lanes, names, offers,
marks, revisions and 15 more kinds) are pi values: each is wrapped as
`{namespace, key, value, wid}` under `namespace\0key` in `values`, and
written through a pi session. ADR-0062 chose that "because `KynetaStorage`
owns the write tokens and arrival order (ADR-0013)". S120 found that those
tokens serve pi's arrival index, which only pi's own reads use, and that
nothing reads a host record through pi. Every reader goes through
`readRecords` (`packages/reads/index.ts`), which reads contents and
addresses.

The cost of the wrapping:

- **The session's document is pi's storage shape.** It uses none of
  `entries`, `usageRows`, `lists` or `checkpointText`. The scribe builds a
  `StorageBackedSession` and a `KynetaStorage` over it only to carry writes;
  ADR-0092 says it "has a session and no harness".
- **Every read scans.** `readValues` walks every value of a document for
  each namespace, about 18 times per projection (ADR-0062), and a write to
  any value changes `values`, so no read can be cached by it.
- **Brands stand in for types.** The root's and the session's documents
  share one schema, so `RootDocHandle` and `SessionDocHandle` are phantom
  brands over one handle, made by casts (`asRootDoc`, `asSessionDoc`).
- **The guard is a run-time check.** `planWrites` refuses a namespace
  outside `pinetrie.`, since the host writes into the same record as pi.

S120 measured the alternative on a copy of the real store (108 roots):
880 session records and 23,637 root records moved, every one of the 22
`RecordSpec`s decoded the same records afterwards, the session's stored
bytes fell from 891 KB to 670 KB, and each write logs about 30% less.

**Decision.**

- **`records: Schema.record(Schema.record(Schema.any()))`**: a record's
  namespace, then its key, then its contents, which its `RecordSpec`
  decodes at the edge as before. A new kind of record needs no schema
  change.
- **Two schemas.** `RootDoc` is pi's storage plus `records`; `SessionDoc` is
  `records` alone. The handles are their own types, and the brands and the
  casts go.
- **The host writes its records directly.** `applyRecordWrites`
  (`@pinetrie/schema`) is the one writer of `records`, in one batch per
  document. pi carries no host write: the scribe loses `writeValues`, its
  namespace guard and its session over the session's document.
- **`@pinetrie/schema` is the storage edge.** It holds each document's
  shape, the raw reads and the writers. It makes no decisions: those are
  `@pinetrie/rules`', over types in `@pinetrie/core` (`LiveOp`, `ValueWrite`).
  It imports no pi, and one module of it says how pi's data is laid out:
  the entry row, the namespace of a lane's tip, and the payload fields
  pine·trie reads.

**Consequences.**

- **A read is one lookup.** `readRecords` reads `records.get(namespace)`.
  That object keeps its identity across writes to other namespaces (S120),
  so `readRecords` caches its decoded map by it: a write decodes only its
  own namespace.
- **The guard is structural.** The host writes `records`, pi writes
  `values`, and neither can reach the other's.
- **S18's rule holds by its own condition.** A namespace's first write
  creates a child record, which S18 showed can lose a writer's values when
  two replicas create it at once. The host is every document's only writer
  (ADR-0023), so no child is created concurrently. A second writing replica
  would break this, as it would `lists` and `checkpointText` already.
- **Stored data must move.** Each root's records move from `values` to
  `records`, and the session is made again under its own schema. That is
  migration 1 under ADR-0096; a host never compacts under the new schemas
  before it has run.
- **pi's arrival index no longer sees host writes**, so a host write costs
  pi no reconcile. `dirtyFrom` (`packages/pi/dirty.ts`) treats `records` as
  an unknown field and ignores it.
- **A write lands at once.** A direct write is synchronous, where a scribe
  write queued behind pi's commits. S120 checked that every host write is
  awaited and names only entries already in the document.

**Alternatives rejected.**

- **One field per kind of record** (`roots`, `lanes`, …). Typed per kind,
  but every new kind is a change to the document's schema, and typing the
  contents in Kyneta meets S17: a row inside a `Schema.record` cannot be
  migrated.
- **Keep the records in `values` and index them.** A namespace index would
  end the scan, but the wrapping, the pi session, the brands and the
  run-time guard would all stay.
- **A flat `records` keyed `namespace\0key`.** No child records, but a read
  of one namespace is a scan again, and nothing keeps a namespace's
  identity for a cache.
