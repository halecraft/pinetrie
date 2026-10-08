# S13 — Loro map-write superlinearity: upstream in `loro-crdt`, not Kyneta

- **Status:** Answered (by S14 §4.3)

## Brief

**Size:** S–M · **Depends on:** S11 · **Raised by:** S11 §3.9

**Question.** After both S11 fixes, Loro `record.set` remains superlinear (×3.5–3.6
per doubling) while raw `loro-crdt` map-set is linear. Profiling puts the cost in
**wasm frames**, and it is shape-independent (`record(any)`, `record(struct.json)`,
and `record(struct)` all behave alike) — so it is something the Kyneta→Loro
**binding** does per key, not a `LoroMap` limitation.

**Why not urgent.** ~20× smaller than the two defects already fixed, and it does
not threaten any kill criterion. This is the next lever only if 10k-entry bulk
writes need to drop below ~2 s.

## Answers

**It was not the Kyneta→Loro binding.** Kyneta `da978ec` attributes it to
`loro-crdt` itself: *"`loro-crdt` built a commit's event in O(keys²) whenever a
subscriber was attached, which for this substrate is always — bisected to 1.13.3,
fixed in 1.13.4, hence the peer floor."* S11 correctly localised it to wasm frames
and correctly declined to guess further.

S14 demonstrated it in **raw `loro-crdt` with zero Kyneta imports**, toggling
one no-op `doc.subscribe(() => {})` (independently re-run):

| loro | no subscriber @ n=8 000 | subscriber attached | penalty |
|---|---|---|---|
| **1.10.8** | 19 ms (×1.82) | **1 166 ms (×3.80)** | **61×** |
| **1.16.1** | 17 ms (×1.75) | 28 ms (×1.98) | 1.6× |

Subscriber-gated, superlinear when attached, fixed by the version bump — every
part of the commit message's claim confirmed as a black box.

> **Why S11 missed it, and the lesson.** S11's raw-loro control ran **without a
> subscriber**, so it measured a different code path from the one the substrate
> uses — the Kyneta Loro substrate *always* attaches one. S11 §3.9's conclusion
> (*"something the Kyneta→Loro binding does per key"*) is **wrong**, and the
> report should be corrected in place. **A control must exercise the same
> configuration as the subject.**

> Not verified: that the mechanism is literally an O(keys²) event build, or that
> the boundary is exactly 1.13.3/1.13.4. Effect verified; mechanism taken from
> the commit message.
