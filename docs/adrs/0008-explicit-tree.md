# ADR-0008 — The conversation tree is explicit; Loro version history is infrastructure

- **Status:** Accepted
- **Area:** `docs/01-architecture.md`, `packages/schema/TECHNICAL.md`
- **Evidence:** S7
- **Amended by:**
  - ADR-0023: the session document is no longer on Loro. The tree stays
    explicit; replication and convergence need no CRDT history when one host
    writes.

**Context.** Tempting alternative: represent the tree implicitly with Loro
frontiers — chat becomes a flat list, revisiting a node becomes
`checkout(frontier)` + append, and branch storage comes free.

**Decision.** Keep `parentId`/`fromId` explicit. Use Loro's version history only
for replication and convergence *of the tree itself*.

**Consequences / rationale.**

1. **A CRDT op-DAG is a *merge* DAG, not a *branch* DAG.** Its purpose is to
   make divergent histories converge to one value; conversation branches must
   persist as distinct, simultaneously-visible alternatives. Loro's own 1.0 blog
   example is decisive — `checkout` + `setDetachedEditing` + concurrent insert,
   then `import`/`checkoutToLatest`, yields `"Hello, world! Alice!"`: the
   branches **merge into one string**. Correct CRDT behaviour, catastrophic
   conversation behaviour.
2. **Loro agrees.** Its docs state the application layer must still implement
   "version tags and branches."
3. **It welds us to Loro.** Kyneta's Loro backend exposes only
   `version()`/`VersionVector`; frontiers would mean reaching past Kyneta's
   substrate abstraction, forfeiting Yjs/plain-JS and the schema algebra.
4. **Addressability is lost.** References, backlinks, labels, and fold all need
   stable *entry* identity. A frontier addresses a document version, not a
   message.
5. **Lifecycles get welded.** Shallow snapshots could not be used to trim
   history without destroying conversation structure.
6. **jj already ran this experiment** and separated the two: operation log
   (infrastructure) vs commit DAG (semantics). We adopt the same split.

**Where frontiers remain useful:** document audit/undo, shallow snapshots for
long sessions, and `findIdSpansBetween` for debugging convergence.

**Alternatives rejected.** *Tree-as-time-travel* — genuinely elegant, but
auto-merge makes it semantically wrong for alternatives that must coexist.

**Confirmed empirically by S7** (`docs/findings/S7-branch-convergence.md` §3.5): two
branches placed in a single `Schema.text()` converge correctly *and* collapse
into one linear transcript — unaddressable, unfoldable. The failure mode is now
reproduced locally rather than cited from Loro's blog.
