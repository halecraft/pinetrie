# S15 — Should the trunk winner rule be causal rather than wall-clock?

**Status:** Open, not urgent: replicas converge either way.

## Brief

**Size:** S · **Depends on:** S12 · **Raised by:** S12 residual #1

> ⚠️ **S12's hope that this shares S1's Lamport work is DEAD.** S1 deliberately
> built **no** causal clock — it refuted convergent ordering for cursors and
> chose replica-local arrival order instead. S15 would introduce one from
> scratch. The two uses are unrelated: S15 needs a *total order over promotions*
> (convergent is exactly right there); S1 needed *cursor stability* (where
> convergent is exactly wrong).

**Question.** ADR-0012 resolves a trunk fork with a total order `(ts, peer, id)`.
Convergence does **not** depend on the rule — only on it being *total*. But
*which* fold wins does, and `ts` is wall-clock: **clock skew across devices is
adversarial**, and the "winner" may not be the causally later fold.

**Evaluate:** Lamport / causal-length ordering instead, built for this use,
since S1 left no causal clock to share.

**Not urgent:** replicas converge either way; this is about picking the *right*
winner, not a correct one.
