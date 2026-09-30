# ADR-0004 — Entries are immutable; merges are additive nodes with a second parent

**Status:** Accepted

**Context.** pi's v4 model is already append-only with UUIDv7 IDs and
`parentId`. Immutability is what makes structural convergence trivial and
reference anchors permanently stable.

**Decision.** Never mutate a committed entry. A fold produces a **new** entry
carrying `fromId` alongside `parentId`. Allow `fromId` in the schema from day
one even though v1 creates none.

**Consequences.** Provenance, re-foldability, double-fold detection, and a
"landed" signal come free. Retrofitting a second parent edge later would be
painful; allowing it now costs one optional field. Text spans into entries need
no CRDT cursor.
