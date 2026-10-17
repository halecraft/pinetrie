# ADR-0012 — The trunk is a derived value over an append-only promotion DAG

- **Status:** Superseded
- **Area:** `docs/01-architecture.md`, `packages/schema/TECHNICAL.md`
- **Evidence:** S12
- **Superseded by:**
  - ADR-0163: no trunk and no promotion are stored. The host is the only
    writer of each thread's end, so two folds into one end race like two
    messages (ADR-0120), and nothing derives a winner.

**Context.** ADR-0011 gives every writer its own lane, so no lane is canonical —
yet the product is built on a trunk (`docs/00-vision.md`: *"fold an exploration back
into the trunk"*). The danger was that any trunk representation reintroduces a
shared-writer register, **moving** ADR-0011's hazard rather than removing it.

Five candidates were run over one identical workload. Two reintroduce the hazard
and **lose folds silently** — including the one that looks most idiomatic:
pi ships `sessionName = value("pi.session.name")` (`values.js:79`), a genuine
keyless session-global register, which is precisely the shape that fails.

| | candidate | folds discoverable | verdict |
|---|---|---|---|
| (a) | designated lane `"main"` | 1/2 | **silent loss** (and mutual exclusion is unachievable across a partition) |
| (b) | label on an entry | 2/2 | no trunk tip at all (0/2 on path) |
| (c) | `pi.session.trunk` pointer | 1/2 | **silent loss** — the kill-criterion candidate |
| (d) | per-peer designated leaf | 2/2 | peers **permanently disagree** |
| **(e)** | **append-only promotion DAG** | **2/2** | **visible + convergent** |

**Decision.** Promotions are records in `Schema.record` keyed by UUIDv7:

```js
promotions: Schema.record(Schema.struct.json({
  id, entryId,
  prev: Schema.list(Schema.string()),   // promotions this one extends/supersedes
  peer, ts,
}))
```

The trunk tip is **derived**: the single leaf of that DAG, or — when concurrency
produced several — the winner under a total order `(ts, peer, id)`, **with the
fork explicitly surfaced**. This is ADR-0009's "unique key ⇒ single writer"
mechanism applied a **third** time (entry ids, lane names, now promotion ids).

**`prev` must be a LIST.** The experiment forced this: with a single
`prevPromotionId`, a losing promotion is never extended by anything, so it stays
a leaf forever and fork detection becomes a permanent false positive. A
promotion that resolves a fork extends **every leaf it supersedes** — exactly a
merge commit with two parents.

**Evidence.** 1000/1000 property trials (promotion durability + replica
agreement) across 5 seeds; **0/600** across two independent shared-register
controls; order-independent resolution over 500 shuffles; 91/91 promotions
durable with zero duplicate key writes. Independently re-verified at a fresh seed.

**Consequences.**

- **`leaves.length > 1` is a first-class, queryable state** meaning "the trunk
  has an unresolved fork." Not an error — the multiplayer equivalent of a merge
  conflict, detected **structurally** rather than heuristically. The UI must
  render it and offer re-fold.
- **Repair is free, via ADR-0010.** Because a fold is destination-relative, a
  losing promotion is repaired by **re-folding the source branch at the new
  tip** — not by grafting or rolling back the stale merge node, which remains as
  immutable provenance (ADR-0004). The mechanism was already prescribed; it is
  simply applied twice.
- Promotions accumulate with no GC, like lanes.
- **v1 unaffected** — concurrent promotion needs ≥2 harness processes.

**The deeper finding, which reframes the question.** Two concurrent folds onto
the same trunk tip are a **semantic conflict regardless of representation** — a
linear trunk path can contain only one of two siblings. *Every* candidate scored
1/2 (or 0/2) on "folds on the trunk path." So the real question was never "can
the trunk avoid contention" but **"does the conflict fail loudly or silently."**
