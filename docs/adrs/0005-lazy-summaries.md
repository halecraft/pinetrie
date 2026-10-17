# ADR-0005 — Summarization is lazy and destination-aware

- **Status:** Accepted
- **Area:** `docs/01-architecture.md`
- **Evidence:** S5
- **Amended by:**
  - ADR-0168: lazy, destination-aware summarizing is shelved with fold.

**Context.** pi generates `BranchSummaryEntry` on *leaving* a branch — it
summarizes without knowing where the summary will land, and destroys the raw
material in the process.

**Decision.** Do not pre-summarize. At fold time, pass the LLM a three-way
structure (base = LCA sent once; `theirs` = folded leg; `ours` = destination
leg) and ask for a summary useful *at the destination*. Fall back to
compaction only under token pressure.

**Consequences.** Strictly more information at the moment of judgement; full
optionality preserved (re-fold differently, or into a different leaf). Cost:
fold is an LLM call — nondeterministic, non-idempotent, and potentially large.
The UI must tolerate two concurrent folds producing two valid merge nodes.

**Confirmed empirically by S5** (`docs/findings/S5-fold-quality.md`). The ablation is
the evidence: the labelled three-way partition beat both `theirs`-only and the
same bytes unlabelled — and the unlabelled variant was the *worst* of the three.
The lift comes from the structure, not from model strength.
