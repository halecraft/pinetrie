# S15 — Should the trunk winner rule be causal rather than wall-clock?

- **Status:** Moot

Moot: ADR-0163 supersedes ADR-0012, so there is no winner rule to order.

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

## Answers

**Moot (2026-10-17), and never run.** The rule it questions was never
built: no promotion record, trunk pointer or winner exists in the code or
the schema. The writers it ordered are gone. The host is every lane's only
writer and runs every command in one serial executor (ADR-0120), and one
host alone writes a thread's end (ADR-0119). ADR-0163 supersedes
ADR-0012. Two folds into one end race as two messages do, and the host's
write order is the only order there is.
