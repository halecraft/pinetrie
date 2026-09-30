# ADR-0014 — Token deltas ride the DURABLE document, not ephemeral presence

**Status:** Accepted for v1 (from S4). Revisit when the notification defect is
fixed. **Corrected post-review** — one supporting claim was retracted; the
decision stands on the remaining two. Amended by ADR-0023: the accepted residue
per message is gone, since the session is compacted when every run ends.

**Context.** The open question in ADR-0007 was whether high-rate streaming
(`text_delta`) should use ephemeral presence — cheap, no history — or the durable
replicated doc. The expectation was presence. S4 measured a **real** captured pi
stream (94 deltas, 2 702 chars, **202.6 deltas/sec** — 4× the 50/s assumed)
replayed identically across three conditions.

| | A durable list | B ephemeral-accum | C ephemeral-delta |
|---|---|---|---|
| reactive notification | **94/94** | **0** ✗ | **0** ✗ |
| delta coverage | **100 %** | 98.9 % | 98.9 % |
| **connected** client renders exactly | **yes** | yes | ~~no — 2701/2702~~ — **harness bug, retracted** |
| mid-stream joiner renders exactly | **yes** | yes | **no — 1260/2702** ✗ (real) |
| live wire bytes | 20 348 | 139 643 (6.9×) | 13 602 |
| permanent history residue | **9 585 B** ✗ | none | none |

**Decision (REVISED — see correction below).** Stream token deltas into a durable
**`Schema.text()`** via `insert(at, delta)`, cleared on commit.

> ## ✅ CORRECTION — we had the wrong primitive, not the wrong substrate
>
> The table below blames ephemeral/snapshot-only for a quadratic wire cost.
> **That diagnosis is wrong.** Re-measured on the same stream (94 deltas,
> 2 702 chars):
>
> | shape | live wire bytes |
> |---|---|
> | **durable `Schema.text()`** | **18 131** |
> | durable `Schema.list()` | 18 174 |
> | **durable `Schema.string()` (LWW)** | **144 582** |
> | ephemeral `Schema.text()` | *unsupported by design* |
> | ephemeral `Schema.string()` | 140 490 |
>
> The decisive row is **durable `Schema.string()` at 144 582** — the *durable*
> substrate is just as quadratic. So the cost was never a property of ephemeral
> or of "snapshot-only"; it is a property of **accumulating into a whole-value
> LWW register on any substrate**. Conditions B and C both used
> `Schema.string()`, which is why both looked bad.
>
> **`Schema.text()` is a text CRDT: `insert(at, delta)` ships only the inserted
> characters.** It gives linear wire cost, exact mid-stream hydration, and
> reactive notification simultaneously — no windowing, no sharding, no
> disposable-doc trick needed for the *wire* problem.
>
> Ephemeral's refusal is deliberate and clearly explained: *"It keeps one
> timestamped tuple per leaf and decomposes only structs and records, so an
> ordered or counted container has no shape here."* Presence is for small
> replaced values; it was never the right home for accumulating text.
>
> **Residual (late-joiner download after commit):** `text` 11 436 B vs `list`
> 11 734 B vs never-streamed control 5 834 B — so ~5.6 KB residue per message,
> not the 9.6 KB originally recorded, and `text` is marginally better than
> `list` on both axes. Residue remains attributable solely to `compact()` being
> unavailable on Loro docs.
>
> **Lesson worth keeping:** we measured three *encodings of one primitive* and
> concluded something about the *substrate*. Before reporting a cost as a
> library property, check whether the library has a better-fitting type.

**Why, in order of weight.**

1. **The doc layer is not saturated.** At 4× the real rate: 100 % coverage,
   p50 1.78 ms. The kill criterion anticipated saturation; it did not occur.
2. **Ephemeral cannot notify.** `subscribe()` **never fires on remote arrival**
   (Kyneta defect — see action items). State lands, the client is never told.
   Usable only by polling, which disqualifies it for reactive UI.
3. ~~**Delta-only presence loses text on a *fully connected* client** —
   2701/2702.~~ **RETRACTED — this was a test-harness off-by-one**, not a
   substrate property. The observer's `seq` dedup collided with the ephemeral
   default of `0`, so delta index 0 (the single character `"A"`) was never
   recorded. See the correction block atop `docs/findings/S4-browser-transport.md`.
   **Do not cite this claim.**
4. **Delta-only presence cannot serve a mid-stream joiner** — 1260/2702,
   and **this result is real**. A channel carrying only the newest delta cannot
   reconstruct a prefix it never saw. Inherent, not an artifact. Condition C is
   disqualified **on this ground**, which is the hazard S2/S14 anticipated — not
   the stronger claim originally made.

**The tradeoff being accepted, plainly.** ~9.6 KB of unreclaimable history per
streamed message — **3.5× the message's own size** — paid by every future late
joiner, forever. `exchange.compact()` **throws on a live Loro substrate**, so it
cannot be reclaimed today. For long sessions this is the dominant growth term.

**Escape hatches, neither verified.** (i) Keep pending frames in a **separate,
disposable Loro doc per message**, destroyed on commit, so residue never enters
the session doc — preserves A's correctness with none of its cost, and looks
strictly better → **S16**. (ii) Fix or await Loro-substrate compaction.

~~**B is the right long-term destination**~~ — **moot.** The notification defect
*was* fixed (verified), but B's O(n²) cost was never an ephemeral property, and
ephemeral cannot hold a `text` at all. Durable `Schema.text()` supersedes the
whole line of reasoning. The "windowed tail" mitigation is **not needed** and
should not be built.
