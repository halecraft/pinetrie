# S16 — Can a disposable per-message doc remove the streaming residue?

- **Status:** Moot
- **Led to:** ADR-0014

Moot since ADR-0023: compaction removes the residue.

> **Resolved without the spike.** The residue was Loro keeping each finished
> stream's history. Since ADR-0023 the session is `json.bind` and is compacted
> when every run ends, which drops that history (S25). The original brief is
> kept below for the record.

## Brief

**Size:** S–M · **Depends on:** S4 · **Raised by:** ADR-0014's accepted tradeoff

> **Motivation reduced.** The original premise bundled two costs: history
> residue *and* a 6.9× wire cost. **The wire cost is gone** — it was our use of
> `Schema.string()`, not a substrate property; durable `Schema.text()` is linear
> (18 131 B vs 144 582 B). Re-measured residue is **~5.6 KB per message**
> (late-joiner 11 436 B vs 5 834 B control), not 9.6 KB. S16 is now purely about
> residue, and is **lower priority** than when filed.

**Question.** ADR-0014 streams deltas through the durable doc and accepts
**~5.6 KB of unreclaimable history per message**, paid by every future late
joiner. `exchange.compact()` **throws on a live Loro substrate** (still open,
re-verified), so it cannot be reclaimed.

**Hypothesis.** Keep pending assistant frames in a **separate, disposable Loro
doc per message**, destroyed on commit — residue never enters the session doc.
Preserves ADR-0014's correctness with none of its cost.

**Method.** S4 §3.5's control-vs-streamed byte accounting is a ready-made
measurement: late-joiner download for never-streamed / streamed /
streamed-with-disposable-doc.

**Also test:** does a mid-stream joiner still hydrate exactly when pending frames
live in a doc it must *discover and subscribe to*? That is the correctness risk
the split introduces.

**Kill criterion:** if a per-message doc cannot be discovered and subscribed fast
enough for a late joiner to hydrate exactly, ADR-0014's residue stands and the
answer is to await Loro compaction.
