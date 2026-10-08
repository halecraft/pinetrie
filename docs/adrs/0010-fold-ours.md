# ADR-0010 — A fold is destination-relative; the `ours` leg is mandatory

- **Status:** Accepted
- **Area:** `docs/01-architecture.md`, `packages/schema/TECHNICAL.md`
- **Evidence:** S5
- **Amended by:**
  - ADR-0033: resolving a merge's conflicts gets labelled sides, and never
    loses the destination's.

**Context.** S5's ablation A ran the fold with only the `theirs` leg. The output
was not a *degraded* fold — it was **confidently wrong**, recommending a design
the destination had already considered and rejected, with no conflict detected.
Ablation B (all three legs, unlabelled) was worse still: it could not tell
destination from exploration and ended in state confusion.

**Decision.**

1. A fold node is valid **only relative to the destination it was folded into**.
   It is *not* a property of the source branch. The same branch folded at two
   destinations yields two different — and correctly different — summaries.
2. The `ours` leg is **mandatory**. The budget ladder (raw → per-leg compaction
   → branch summary) may compact `ours`, but may never drop it.
3. The legs must be **explicitly labelled** as base / ours / theirs. Passing the
   same content unlabelled is measurably worse than passing less.

**Consequences.** Dropping `ours` under budget pressure is a **correctness**
regression, not a quality one — state this in the ladder design. The UI must
never present a merge node as belonging to the source branch; it belongs to the
edge. Re-foldability (ADR-0004) is therefore not a nicety but a consequence of
the semantics.

**Alternatives rejected.** *Summarise the branch standalone and attach it
anywhere* — cheaper and cacheable, but ablation A shows it produces confident
errors about the destination's decisions.
