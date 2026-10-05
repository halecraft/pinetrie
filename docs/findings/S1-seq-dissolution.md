# S1 — Dissolve the global dense `seq`

**Status:** Answered. Led to ADR-0013.

## Brief

**Size:** S · **Depends on:** S2's failure taxonomy

**Question.** `EntryScan{fromSeq,toSeq}` requires **range scans**, and
`EntryCursor`/`ListCursor` require stable pagination. Can these be served by
Lamport+peer ordering plus a local index, without a dense global counter?

**Kill criterion.** If range scans genuinely require density, we need a
materialized local index per replica — acceptable, but it must be designed, and
it means `seq` becomes a *derived local view*, not stored state.

**Output.** If the answer is clean, write it as an **upstream proposal**, not a
private workaround: *"replace a global commit counter with per-op causal
metadata so the log can merge."*

## Report

**Date:** 2026-09-19 · **Sandbox:** `sandbox/s1-seq` · **Node:** v24.19.0
**Build:** local fixed Kyneta (`stepInPlace` present) + `loro-crdt` **1.16.1**

---

## 1. VERDICT

**SOLVED — a derived local index satisfies pi's `Storage` contract in full, and the kill criterion is not met.** All three S3 defects are gone (0 seq collisions, no counter regression, 0 entries skipped by pagination), pi's conformance suite stays 21/21, and a new 5-seed property test passes **1000/1000** where the S2/S3 shared-counter design fails **0/300**. No upstream renegotiation with pi is required.

**The proposed split in `01-architecture.md` is REFUTED in one important part.** "Replay order → Lamport + peer tiebreak, inherited free from Loro" **cannot work**, because a convergent global order and stable integer cursors are mutually exclusive (§3.1). The correct answer is the opposite of convergent: **seq is a replica-local ARRIVAL index**. The rest of the split (entries need no stored seq; LWW recency from register semantics) holds.

---

## 2. What I ran

### Dependency wiring — `link:`-equivalent symlinks, **not** S14's dist overlay

`@kyneta/*` declare `workspace:^` internally, which defeats `npm install`. Rather than S14's overlay, I symlinked the local workspace packages directly into the sandbox's `node_modules`, plus the *same physical* `loro-crdt` the Loro backend resolves, so there is exactly one wasm instance:

```bash
K=~/halecraft/kyneta/packages
ln -sfn "$K/schema"               node_modules/@kyneta/schema
ln -sfn "$K/schema/backends/loro" node_modules/@kyneta/loro-schema
ln -sfn "$K/machine" "$K/changefeed" "$K/random"   # …likewise
ln -sfn "$K/schema/backends/loro/node_modules/loro-crdt" node_modules/loro-crdt
```

Node resolves through realpath, so each package picks up its own workspace deps. Sanity check, as required:

```
stepInPlace: function
@kyneta/schema: 3.0.0        (local workspace, not npm)
@kyneta/loro-schema: 3.0.0   (local workspace)
loro-crdt: 1.16.1            (>= 1.13.4 floor)
dist has stepInPlace (fixed build): true
```

The dists I depend on are stable and predate this spike (`schema` 21:46:46, `loro` 21:52:24, `machine` 21:46:37; spike ran ~22:10–22:50) — matching S14's recorded provenance. **I ran no build and no package-manager command in `~/halecraft/kyneta`.**

### Files

| File | Purpose |
|---|---|
| `kyneta-storage-seq.mjs` | the adapter — `Storage` with `seq` dissolved |
| `broken-shared-counter.mjs` | **negative control** — S2's shared-counter design, verbatim, renamed |
| `run-conformance.mjs` | pi's 21-case suite (`memory` control / `kyneta`) |
| `harness-util.mjs`, `step1-single.mjs`, `step7-lane-per-peer.mjs` | S3's real-`AgentHarness` tests, repointed |
| `step3-seq-dissolved.mjs` | **S3's defect reproduction, re-run** + the mid-pagination-arrival crux |
| `seq.property.mjs` | new property test (P1–P6), `broken` flag runs the control |
| `convergence.property.mjs`, `negative-control.mjs` | S7's suites, unmodified |
| `perf.mjs` | derived-index cost at n=10 000 / 50 000 |

```bash
cd ./sandbox/s1-seq
node run-conformance.mjs memory ; node run-conformance.mjs kyneta
node step1-single.mjs ; node step7-lane-per-peer.mjs ; node step3-seq-dissolved.mjs
node seq.property.mjs 200 <seed>            # dissolved
node seq.property.mjs 60 <seed> broken      # negative control — must fail
node convergence.property.mjs 200 12648430 ; node negative-control.mjs 50 42
node perf.mjs 10000 ; node perf.mjs 50000
```

**The control exercises the identical configuration** — same sandbox, same local fixed Kyneta, same loro 1.16.1, same property test, same seeds. Only the seq design differs (S13's lesson).

---

## 3. Design

### 3.1 The crux: convergent order and stable cursors are mutually exclusive

pi turns a cursor into arithmetic on a dense integer line. `session.js:239-243`:

```js
...(query.cursor === undefined
    ? {}
    : order === "asc"
        ? { fromSeq: query.cursor.seq + 1 }
        : { toSeq: query.cursor.seq - 1 }),
```

`cursor.seq + 1` means *"the next possible position."* That is only sound if **nothing can ever be inserted between two already-issued positions.**

Any *convergent* order — Lamport, `(uuidv7, peerId)`, hybrid clock — is by construction an order into which a late-arriving entry **sorts into the middle**. A foreign entry landing at derived position 5 shifts every later entry up by one, so a client holding `cursor.seq = 7` re-reads an entry it already saw. This is exactly the failure the task names, and it is not fixable by picking a better convergent key. The architecture doc's "replay order → Lamport + peer tiebreak" is therefore **wrong for this role**.

**Arrival order has the property that convergent orders cannot have: it only ever appends.** A newly observed item always receives a position at the *end*. Nothing shifts, so `cursor.seq + 1` stays exactly right.

The price is that seq is no longer the same number on two replicas — which is fine, because nothing in pi compares seq across replicas (§3.4).

### 3.2 The design

**`seq` is a replica-local arrival index, derived from the document, never replicated.**

The shared CRDT stores no seq and no counter. Every item instead carries a coordination-free identity token so arrival can be tracked:

| store | token | note |
|---|---|---|
| entries | `id` | uuidv7 — ADR-0009 already guarantees it |
| usage rows | `id` | ditto |
| values | `wid` | fresh peer-tagged token per **write**; a changed `wid` means a newer write won the LWW race |
| list elements | `eid` | fresh peer-tagged token per **append** |

Local commits take the next counter values (so `CommitResult.firstSeq/seqs` are exactly what the caller is told). Remote arrivals are assigned counter values at reconcile time, appended at the end.

**`meta.nextSeq` is gone. So are `meta.messageCount` and `meta.usage`** — a shared LWW counter clobbers under partition in precisely the way `nextSeq` does, so stats are derived locally too.

**Invariant maintained: seq is a topological linear extension of the parent DAG** (parent always lower than child). `scanBranch` filters its parent-walk with seq comparisons, so this is load-bearing, not cosmetic. It holds because (a) local writes are monotonic, (b) a local write's parent must already exist and therefore already has a lower seq, and (c) newly observed entries are assigned via Kahn's algorithm, parents first.

Reconciliation is driven by the Kyneta changefeed, filtered on `replay === true` (`BatchMetadata.replay` is documented as *"true iff this batch represents state authored elsewhere (substrate event bridge, `merge` payload, version travel)"*), so it costs **O(δ)**, not O(document) — measured in §4.4.

### 3.3 Mapping the three roles + range scans

| role | S1 resolution |
|---|---|
| **total replay order** | replica-local **arrival** order. *Not* convergent — deliberately (§3.1). Semantic ordering comes from the `parentId` walk (`scanBranch`), which is what pi actually builds transcripts from. |
| **pagination cursor** (`EntryCursor`, `ListCursor`) | unchanged shape `{seq}`. Stable because the index is append-only. **`ListReadOptions` does NOT break** — contrary to the "API-visible break" predicted in S2/T7 and `01-architecture.md`. No Loro `Cursor` needed. |
| **LWW recency** (`StoredValue.seq`) | derived from the local index, keyed by `wid`. Stored `seq` disappears from the document, as predicted. |
| **range scans** (`EntryScan{fromSeq,toSeq}`) | a dense-ish monotone local array; range filter is a scan over `entryOrder`. Measured at 1 ms for a 100-entry window in a 10 000-entry document. |

**Density is not required, and never was.** I initially wrote a property asserting seq is gapless and it failed immediately — correctly. pi's own conformance suite contains a case whose fixture is literally named `"sequence gap"` (`conformance/storage.js:522`): three usage rows interleaved with a value write, then `scanUsage({fromSeq: seqs[1], toSeq: seqs[2]})`. Gaps are by design; an overwritten value's old seq is simply abandoned. What pagination needs is a strictly increasing, never-reordered line — not a gapless one.

### 3.4 What the contract demands, and whether a local derivation satisfies it

| demand | satisfied? |
|---|---|
| `prepareStorageCommit(writes, firstSeq, ts)` assigns `firstSeq + index` | ✅ storage chooses `firstSeq` freely; local counter supplies it |
| `validateCommittedWrites` — strictly increasing within a commit | ✅ automatic |
| `CommitResult.firstSeq === seqs[0]`, `seqs` strictly increasing | ✅ conformance asserts it; passes |
| `getEntries` returns `Entry` **including** `seq` | ✅ attached on read from the index |
| `EntryScan{fromSeq,toSeq}` range scans | ✅ |
| `findEntries` cursor → `fromSeq: cursor.seq + 1` | ✅ — and this is the whole reason for arrival order |
| list `{seq}` cursors, asc/desc, 10 000 clamp | ✅ `resolveListReadOptions` reused verbatim |
| `scanBranch` cursor vs. parent-walk order | ✅ guaranteed by the topological invariant |
| durable aggregates exact after every commit | ✅ derived locally, maintained incrementally |

**The one thing a local derivation gives up:** seq is meaningless across replicas. That is safe only if no cursor ever crosses a replica boundary or survives a restart. I grepped every non-test cursor use in `pi-agent-core/dist/harness`: `progress.js:4-10` (a transient in-memory paging loop), `session.js:228-243`, `in-memory-storage-state.js:136-169`, `values.js:57`. **All transient; none persisted.** Every `seq` in the drive loop (`response.js:270`, `tool-placement.js:182`, `boundary.js:136`, `structural.js:124`, `transcript.js:23`) comes from `commit.seqs[...]` and is attached to **in-memory transcript events**, not to stored state.

---

## 4. Evidence

### 4.1 The S3 defect reproduction, re-run — all three defects gone

`node step3-seq-dissolved.mjs` (same structure and questions as `s3-harness/step3-seq-collision.mjs`):

```
shared root = 786a7d
A local counter = 6   B local counter = 4
(there is no shared nextSeq in the document any more — that was the defect)

====== PARTITION — both replicas write 3 messages with NO sync ======
  A entries (local), local counter = 15:      B entries (local), local counter = 13:
    seq=  4  786a7d  "shared root"              seq=  1  786a7d  "shared root"
    seq=  7  e8a44c  "A-1"                      seq=  5  46afac  "B-1"
    seq= 10  b96695  "A-2"                      seq=  8  21ce82  "B-2"
    seq= 13  9848b2  "A-3"                      seq= 11  6cfc77  "B-3"
```

Note the shared root is `seq=4` on A and `seq=1` on B — **the same entry, different local seq**. That is the design working, not a bug.

```
====== HEAL — sync the partition ======
  converged entry seq map (replica A's derived index):
    seq=  4  786a7d="shared root"
    seq=  7  e8a44c="A-1"
    seq= 10  b96695="A-2"
    seq= 13  9848b2="A-3"
    seq= 16  46afac="B-1"        <- B's entries appended at the END
    seq= 17  21ce82="B-2"
    seq= 18  6cfc77="B-3"

  total entries: 7 · distinct seq values: 7 · COLLIDING seq values: 0
  A's next seq = 21   max used seq = 18
  >>> counter REGRESSION: next(21) <= maxUsed(18) ? false

  cursor pagination (limit=2, asc), using findEntries' fromSeq=cursor+1 rule:
    page0: 4:786a7d , 7:e8a44c
    page1: 10:b96695 , 13:9848b2
    page2: 16:46afac , 17:21ce82
    page3: 18:6cfc77
    entries paged: 7  unique: 7  total in doc: 7
    no entries skipped
```

Side by side with S3:

| question | S3 (shared counter) | S1 (dissolved) |
|---|---|---|
| seq collisions after heal | **YES (3)** | **no (0)** |
| counter regression | **YES** | **no** |
| pagination lost entries | **YES (1)** — `7:24b50e="B-1"` | **no (0)** |

### 4.2 The crux: a merge landing mid-pagination

```
====== MID-PAGINATION ARRIVAL — the crux S1 had to solve ======
  A pages with limit=2; a foreign batch from B lands BETWEEN pages.
    (after page0, 2 foreign entries merged into A)
    paged=9 unique=9 duplicates=0
    entries in doc at end=9  never returned=0
  PASS  no entry returned twice across the arrival
  PASS  late arrivals still reachable (appended at the end)
```

Foreign entries arriving mid-scan are appended past the cursor, so they are picked up by later pages rather than shifting earlier ones. Nothing repeats; nothing is lost.

### 4.3 pi's conformance suite — 21/21, control included

```
=== Storage conformance: memory ===     === Storage conformance: kyneta ===
  TOTAL: 21/21 passed, 0 failed           TOTAL: 21/21 passed, 0 failed
```

Passed on the first execution, including `pages appends by global sequence and deletes whole lists`, `scans global entries with explicit ranges, filters, orders, and limits`, and `applies branch query semantics to structure scans`. The slow list case ran in **196 ms** (S2 original: 12 198 ms; S14 config C: 163 ms).

### 4.4 Real `AgentHarness` (S3's tests, repointed)

```
STEP1: pass=12 fail=0                        (a real AgentHarness over the adapter)
STEP7: pass=10 fail=0                        (lane-per-writer, ADR-0011)
```

and step7's own seq census, which S3 used to show lane-per-writer does *not* fix seq:

```
  entries=8  distinct seq=8  duplicates=0
  >>> seq under the DISSOLVED design: no collisions
```

S3 measured `entries=8  distinct seq=5  duplicates=3` here.

### 4.5 New property test — 1000/1000, control 0/300

`seq.property.mjs`: 2–4 peers, 8–34 random ops (entry appends under random known parents, value sets, list appends, random pairwise partial heals), seeded PRNG, then full sync. Asserts per replica:

- **P1** no two items share a seq (across entries, usage, values, lists)
- **P2** seq is a topological linear extension (`parent.seq < child.seq`)
- **P3** paginated `scanEntries` returns every entry exactly once
- **P4** paginating *while merges land* never repeats, and never loses an entry that was present when paging started
- **P5** all replicas converge on the same entry set
- **P6** `entryOrder` strictly increasing; every seq in `[1, lastSeq]`

```
seq property (dissolved): 200/200 trials passed (seed=20260920, up to 4 peers, 2482 entries total)
seq property (dissolved): 200/200 trials passed (seed=1,        up to 4 peers, 2434 entries total)
seq property (dissolved): 200/200 trials passed (seed=42,       up to 4 peers, 2485 entries total)
seq property (dissolved): 200/200 trials passed (seed=999,      up to 4 peers, 2472 entries total)
seq property (dissolved): 200/200 trials passed (seed=7777777,  up to 4 peers, 2450 entries total)
```

**Negative control** — same test, same seeds, same everything, with S2's shared dense counter:

```
NEGATIVE CONTROL: 0/60 trials passed (seed=20260920)
NEGATIVE CONTROL: 0/60 trials passed (seed=1)
NEGATIVE CONTROL: 0/60 trials passed (seed=42)
NEGATIVE CONTROL: 0/60 trials passed (seed=999)
NEGATIVE CONTROL: 0/60 trials passed (seed=7777777)
```

Failure-mode census over 20 further independent seeds (first failure each):

| failure | count |
|---|---|
| **P4** — entry present before paging never returned | 16/20 |
| **P1** — seq collision (e.g. `seq=3x2,5x2,6x2`) | 4/20 |

Both are exactly the S3 defects. The test is not vacuous.

### 4.6 S7's suites, unmodified

```
convergence property: 200/200 trials passed (seed=12648430, up to 4 peers, 3347 entries total)
convergence property: 100/100 trials passed (seed=42,       up to 4 peers, 1748 entries total)
convergence property: 300/300 trials passed (seed=2026,     up to 4 peers, 4839 entries total)
```

Entry totals **byte-identical** to the figures published in S7 and re-confirmed in S14 — the environment is equivalent to S14 config C. S7's negative control still fails as designed (`TRIAL 0 FAILED (seed=42): entry t0-collide-1 parent t0-collide-2 …`).

### 4.7 Cost of the derived index

```
=== derived-index cost, n = 10000 ===
  bulk load: 10000 entries, one commit each (streaming shape)     381ms
  scanEntries(asc) — materialise all                               45ms
  scanEntries range {fromSeq,toSeq} mid-document                    1ms
  getEntries([one])                                                 0ms
  scanBranch from tip (walk 10000)                                  8ms
  paginate whole doc, limit=1000 (cursor arithmetic)                7ms
  COLD rehydrate: index 10000 entries from a fresh replica          57ms
  INCREMENTAL reconcile: 5 foreign entries into a 10000-entry doc    0ms
```

```
=== n = 50000 ===
  bulk load                         1662ms      COLD rehydrate      281ms
  scanEntries(asc)                   229ms      INCREMENTAL           0ms
  scanBranch from tip                 49ms      paginate whole doc   70ms
```

Linear in n (10k→50k ≈ ×5 on every column). **The incremental reconcile is O(δ), not O(document)**: unchanged at 0 ms whether the document holds 10 000 or 50 000 entries. My first implementation materialised the whole entry record per sync and cost 6 ms at n=10 000; routing candidate ids through the changefeed removed it.

S2's affordability estimate is confirmed with a large margin: a **cold rebuild of the entire index is 57 ms at n=10 000**, and steady-state sync is free.

---

## 5. Consequences

**S1 — RESOLVED. The top blocker is cleared.** The `seq` row in `01-architecture.md` § Risks should move from "TOP BLOCKER" to resolved, citing `sandbox/s1-seq/step3-seq-dissolved.mjs` as the passing reproduction.

**`01-architecture.md` § "Dissolving `seq`" needs correcting on two points:**

1. *"Replay order → Lamport + peer tiebreak — inherited free from Loro"* is **refuted**. A convergent order breaks cursor stability. Replace with: replica-local arrival order; semantic order comes from the `parentId` walk.
2. *"List cursor → Loro stable `Cursor` — **API-visible break** to `ListReadOptions`"* is **not needed**. `ListReadOptions` is unchanged; the S2/T7 prediction and the matching § Risks row can both be retired.

Its third claim — *"Entries need no `seq` at all"* — is confirmed in the sense that no seq is **stored**; but entries still need a seq **attached on read**, because `Entry` carries it and conformance asserts it.

**ADR-0003 (implement the `Storage` port) — reconfirmed** under a genuinely multi-writer design, with a real `AgentHarness` (S3 step1/step7 green).

**ADR-0009 (entry id uniqueness) — load-bearing in a second way.** It is now also what makes arrival tracking possible: `id` *is* the dedup token. Same for the `wid`/`eid` tokens this design adds for values and list elements, which are ADR-0009's mechanism applied twice more.

**ADR-0011 (lane per writer) — unaffected and still required.** It fixes reachability; S1 fixes ordering. Independent defects, independent fixes.

**A new constraint for ADR-0007 (host↔client transport), and the main thing to carry forward:**

> **`seq` is replica-local and MUST NOT cross a replica boundary or survive a restart.** A cursor minted on one host is meaningless on another. pi never does either today (§3.4, verified by grep), but pine·trie's browser clients receive transcript events that carry `seq` from `commit.seqs[...]`. Clients must treat it as an opaque local ordering key, never as a durable identifier — entry `id` is the durable identifier.

**Suggested ADR-0012 — "`seq` is a derived replica-local arrival index."** Decision: no sequencer in the shared document; stats derived too; arrival order chosen *over* causal order specifically to keep integer cursors stable; cursors are session-and-replica-scoped.

**Roadmap fitness functions.** `sandbox/s1-seq/seq.property.mjs` is ready to promote (with its `broken` negative control). It supersedes the roadmap's currently-failing target *"no two entries share a `seq` after a partition heal"*, which now **passes**.

---

## 6. Residual unknowns (NOT resolved)

1. **The drive/inference loop was never exercised.** Like S3, the model is stubbed and `prompt()` is never called. Compaction, steering, the inbox, and operation-state machinery are untested under this adapter. S3's residual #1 carries over unchanged.
2. **Restart semantics are argued, not tested.** A cold rehydrate produces a *different* arrival order from the live session that wrote the document (verified to work in §4.7, but I never tested that a cursor held across a restart misbehaves — I only grepped to show pi never holds one).
3. **The causal-delivery fallback is dead code.** The topological sort has a fallback for a child arriving without its parent. I instrumented it to `throw` and re-ran 400 property trials plus the conformance suite: it **never fires**, so Loro's causal delivery holds in every interleaving I generated — and the fallback path itself is therefore **untested**.
4. **No transport, no `@kyneta/exchange`, no persistence.** Sync is in-process `exportSince`/`merge`. No Line, no store backend, no message loss, reordering, or duplication.
5. **`scanValues` now iterates the local index rather than the document.** Correct for the 21 conformance cases, but its behaviour with very many value keys is unmeasured (perf covered entries and lists only).
6. **Value/list reconcile relies on changefeed `MapChange` shape.** I read `ch.set` / `ch.delete` from the op stream. Verified by probe and by 21/21 + 1000 trials, but I did not audit every change shape Kyneta can emit; unexpected shapes fall back to a full scan.
7. **`undefined` handling** — S2's residual #7 is untouched.
8. **Concurrent writers on ONE replica** (two harnesses sharing a `KynetaStorage`) were not tested; the admission queue is unchanged from S2, and S3/T5 already answered that question separately.
9. **Scale beyond 50 000** and memory/GC cost of the index (a `Map` plus an array per store) were not measured.

---

## 7. Verified vs assumed

**Verified by execution:** the wiring sanity check (`stepInPlace`, loro 1.16.1, fixed dist); 21/21 conformance for both `memory` and `kyneta`; step1 12/12 and step7 10/10 with a real `AgentHarness`; every number in §4.1, §4.2 and §4.7; 1000/1000 property trials across five seeds; 0/300 negative-control trials across the same five seeds; the 20-seed failure-mode census; S7's suites at published entry totals; that the causal-delivery fallback never fires.

**Verified by source reading (quoted above, file:line):** `session.js:239-243` cursor arithmetic; `commit.js` `prepareStorageCommit`/`validateCommittedWrites`; `conformance/storage.js:519-527` the `"sequence gap"` fixture; the complete non-test cursor inventory in `dist/harness`; the drive-loop `seq` sites all sourcing from `commit.seqs[...]`.

**Assumed, not verified:** that the 21 conformance cases fully characterise the `Storage` contract (S2's assumption, inherited — `session-repo.js` ships a second, unexercised suite); that Loro guarantees causal delivery of parent before child in all transports (relied upon, fallback never exercised — residual #3); that passing with a stubbed model implies the drive loop is safe (residual #1); that no consumer outside `dist/harness` persists a cursor.

**Explicitly not claimed:** that arrival order is a *good* order for display — it is not, and nothing should use it for that; the tree's `parentId` walk is the semantic order. That this design survives a real transport. That a cursor is safe across a restart — it is not, by construction.

## Review

**Verdict:** SOLVED, no upstream renegotiation needed

The top blocker is cleared.
Independently re-verified: conformance 21/21 (+ `memory` control), fresh-seed
property 100/100, control 0/40, S3's reproduction showing 0 collisions and 0
skipped entries.

- **Refuted the architecture doc's own plan.** "Replay order → Lamport + peer
  tiebreak, inherited free from Loro" cannot work: **a convergent order and
  stable integer cursors are mutually exclusive.** Only arrival order — where
  new observations always land at the end — keeps `cursor.seq + 1` sound.
- **Also refuted the S2/T7 "API-visible break."** `ListReadOptions` is unchanged;
  no Loro `Cursor` required.
- **Found pi's own proof that density was never required:** a conformance fixture
  named `"sequence gap"` (`conformance/storage.js:522`).
- **Wrote its own property wrong first and let the test correct it** — an initial
  "seq is gapless" assertion failed immediately, correctly.
- **Instrumented its own dead code:** the causal-delivery fallback was made to
  `throw` and never fired across 400 trials + conformance — so it reports that
  path as *untested* rather than claiming coverage.
- Cost: cold index rebuild **57 ms @ n=10 000**; incremental reconcile **O(δ),
  0 ms** at both 10 000 and 50 000 entries. Linear to n=50 000.
- **Supersedes the roadmap's deliberately-failing fitness function** — "no two
  entries share a `seq` after a partition heal" now **passes**.
