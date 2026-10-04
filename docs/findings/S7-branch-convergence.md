# S7 — Do divergent branches persist distinctly in one Kyneta doc?

**Status:** Answered. Led to ADR-0009; spawned S8, S9 and S10.

## Brief

**Size:** S · **Depends on:** nothing

**Question.** Two peers, one Kyneta document, concurrent entry appends under
*different* parents. Do both branches survive as distinct siblings and converge
as a tree — with no interleaving and no auto-merge?

**Method.** Direct `@kyneta/schema` + Loro test. No pi involved.

**Kill criterion.** Any interleaving or collapse means our document shape is
wrong (not that ADR-0008 is wrong — that would mean we modelled the tree in a
substrate-merged container by mistake).

**Throw away.** The harness; promote the assertion into the permanent
convergence property test.

## 1. VERDICT

**PASS.** Divergent conversation branches modelled as `Schema.record` keyed by UUIDv7 survive concurrent multi-peer appends with zero interleaving, zero loss, and byte-identical convergence across replicas (34/34 assertions; 900/900 randomized property trials). The kill criterion was not triggered.

## 2. What I ran

Sandbox: `sandbox/s7-convergence`

Dependencies installed from npm, pinned exactly (no workspace linkage; `~/halecraft/kyneta` was read-only reference):

| Package | Version | Why |
|---|---|---|
| `@kyneta/schema` | 3.0.0 | published latest |
| `@kyneta/loro-schema` | 3.0.0 | published latest |
| `@kyneta/changefeed` | 3.0.0 | peer dep |
| `loro-crdt` | **1.10.8** | matched `pnpm-lock.yaml:3938` in the kyneta workspace, i.e. the version Kyneta is actually developed against (npm latest is 1.16.1 — deliberately *not* used) |

Node v24.19.0.

| File | Purpose | Command |
|---|---|---|
| `smoke.mjs` | API shakedown | `node smoke.mjs` |
| `s7.mjs` | **the spike** — steps 1–6 | `node s7.mjs` → exit 0, `pass=34 fail=0` |
| `alternatives.mjs` | justify `record` vs `list` vs `set` | `node alternatives.mjs` |
| `convergence.property.mjs` | reusable fitness function | `node convergence.property.mjs [trials] [seed]` |
| `negative-control.mjs` | proves the property test has teeth | `node negative-control.mjs 50 42` → exit **1** |
| `keyorder.mjs` | raw key-order determinism | `node keyorder.mjs` |

## 3. Evidence

### 3.1 Document shape chosen — and why

```js
const ConversationDoc = loro.bind(Schema.struct({
  entries: Schema.record(Schema.struct.json({
    id:       Schema.string(),
    parentId: Schema.string().nullable(),
    role:     Schema.string(),
    text:     Schema.string(),
  })),
}))
```

**`Schema.record` (dynamic-key map keyed by UUIDv7)** — explicitly *not* `Schema.list`, *not* `Schema.set`.

A Loro map is a per-key LWW register. That sounds wrong for a grow-only set, but it is exactly right **given the write-once discipline**: ids are unique, so every key is written exactly once and the LWW register is *never actually contended*. Grow-only-set semantics emerge from key uniqueness, not from the container.

`Schema.struct.json` for the value makes each entry a single opaque immutable blob — correct per ADR-0004 (entries never mutate), and it avoids paying for collaborative sub-fields nobody will edit.

Measured comparison (`alternatives.mjs`):

```
=== Schema.list — concurrent appends ===
  l1: ["root","C","B"]
  l2: ["root","C","B"]
  both survive: true
  order agrees: true
  same-id appended on both peers -> 2 copies (list is NOT idempotent)

=== Schema.record — same scenario ===
  r1 keys: ["B","C","root"]
  r2 keys: ["B","C","root"]
  same-id set on both peers -> 1 copy (record IS idempotent for identical values)
  O(1) lookup by id: branch B

=== Schema.set — rejected by loro.bind? ===
  runtime: REJECTED -> changeToDiff: 'set-op' is not yet supported by the Loro
  backend (Schema.set requires 'add-wins-per-key' which is not in LoroLaws).
```

Three decisive differences:

1. **`Schema.set` is unavailable.** Rejected at *runtime* by the Loro backend, not merely at the type level as `01-architecture.md` implies. Confirmed error message above.
2. **`list` is not idempotent.** The same entry appended on two peers yields **2 copies**. Any retry, replay, or at-least-once delivery path silently duplicates conversation entries. `record` collapses identical re-writes to one.
3. **`record` gives O(1) `getEntries(ids)`** — which is precisely pi's `Storage` access pattern. A list forces an O(n) scan per id.

`list` would also impose a *total order* on entries that the tree does not want; ordering must come from `parentId`, not from container position.

### 3.2 Concurrent divergence under the same parent (steps 3–4)

Two peers, independent Loro peer ids, both append under parent `A` with **no sync in between**:

```
peer1 loro peerId=6099663851502848
peer2 loro peerId=3029413059391092

  PASS  pre-sync: peer1 does NOT see C
  PASS  pre-sync: peer2 does NOT see B
```

After bidirectional sync:

```
  PASS  B exists after sync
  PASS  C exists after sync
  PASS  B.parentId === A
  PASS  C.parentId === A
  PASS  B text intact (no interleaving)
  PASS  C text intact (no interleaving)
  PASS  A has exactly 2 children (B and C)
  PASS  replicas byte-identical (canonical)
  PASS  entry count === 4

tree @ peer1:
- [user] root: help me design a cache
  - [assistant] A: here is an LRU sketch
    - [user] B: what does 'eviction' mean here?
    - [user] C: is the TTL path thread-safe?
```

### 3.3 Nesting and sibling contention (steps 5a–5c)

Peer1 extends B while peer2 extends C; then **both peers append under the identical parent `B2`**; then a third peer joins from snapshot and all three diverge under `A` with an awkward transitive sync order:

```
  PASS  B2.parentId === B          PASS  C2.parentId === C
  PASS  B2 has exactly 2 children — no LWW clobber
  PASS  S1 survived                PASS  S2 survived
  PASS  entry count === 8
  PASS  rendered trees identical

  PASS  peer3 hydrated
  PASS  A now has 5 children (B, C, T1, T2, T3)
  PASS  all three replicas byte-identical
```

Final tree, identical on both peers:

```
- [user] root: help me design a cache
  - [assistant] A: here is an LRU sketch
    - [user] B: what does 'eviction' mean here?
      - [assistant] B2: eviction = discard on pressure
        - [user] S1: sibling from peer1
        - [user] S2: sibling from peer2
    - [user] C: is the TTL path thread-safe?
      - [assistant] C2: no, the TTL sweep races
```

### 3.4 Adversarial: colliding ids (step 5d)

Deliberately writing the **same key** on two peers concurrently:

```
  -> single survivor: "written by peer2"  (one write silently lost)
  PASS  same-key concurrent write collapses to 1 (LWW, as expected)
  PASS  q1/q2 agree on the survivor
```

This is correct LWW behaviour and it pins down the load-bearing invariant: **entry id uniqueness is what converts a per-key LWW map into a grow-only set.** UUIDv7 supplies it coordination-free. If any future code path derives an id deterministically from content or position, two peers can collide and *silently lose a conversation entry with no error*. See §5.

### 3.5 Contrast case — the ADR-0008 failure mode (step 6)

The same two branches inserted into a single `Schema.text()` at the same offset:

```
  merged transcript:
    | A: here is an LRU sketch
    | C: is the TTL path thread-safe?
    | B: what does 'eviction' mean here?
  PASS  text replicas converge
  PASS  BOTH branches collapsed into ONE linear string (the failure mode)
```

Both peers converge — the CRDT is behaving *correctly*. But the two branches are now one linear transcript. There is no way to ask "which branch is this line on?", no way to address B, and no way to fold B into C. This is exactly the semantics ADR-0008 rejects, reproduced locally rather than cited from Loro's blog.

### 3.6 Reusable property test

`convergence.property.mjs` — 2–4 peers, 10–40 random ops, random parent selection restricted to ids each peer actually knows, random pairwise sync interleavings, deterministic seeded PRNG. Asserts: all replicas byte-identical; entry count matches ground truth; every entry's `parentId` matches what was written; every entry reaches root (no cycles, no orphans).

```
convergence property: 200/200 trials passed (seed=12648430, up to 4 peers, 3347 entries total)
convergence property: 100/100 trials passed (seed=1,       up to 4 peers, 1589 entries total)
convergence property: 100/100 trials passed (seed=42,      up to 4 peers, 1748 entries total)
convergence property: 100/100 trials passed (seed=99999,   up to 4 peers, 1729 entries total)
convergence property: 100/100 trials passed (seed=7777777, up to 4 peers, 1648 entries total)
convergence property: 300/300 trials passed (seed=2026,    up to 4 peers, 4839 entries total)
```

900 trials, ~15.9k entries, zero failures.

**Negative control** — the same test with the id space collapsed to 3 colliding ids fails on the first trial:

```
TRIAL 0 FAILED (seed=42): entry t0-collide-1 parent t0-collide-2 !== t0-collide-1  peers=3 ops=23
negative control exit code: 1
```

So the property test detects violations rather than vacuously passing.

### 3.7 Bonus: raw key order is deterministic

I compared using canonical (key-sorted) JSON. Checking raw iteration order as well (`keyorder.mjs`):

```
p1 raw key order: ["aaa-from-p2","root","zzz-from-p1"]
p2 raw key order: ["aaa-from-p2","root","zzz-from-p1"]
raw order identical: true
raw JSON identical : true
```

Loro's map yields identical key order across replicas regardless of write origin. Convergence is therefore stronger than the spike required — but see §5 for why I would not *depend* on this.

## 4. Consequences for the plan

**Confirms ADR-0008** ("the conversation tree is explicit; Loro version history is infrastructure"). §3.5 reproduces the substrate-merge failure mode first-hand, and §3.2–3.3 show the explicit-`parentId` shape is immune to it. The rationale in ADR-0008 is now backed by local evidence rather than by Loro's blog post alone.

**Confirms ADR-0004** ("entries are immutable"). Immutability is what makes `Schema.struct.json` values safe and what makes the per-key LWW register uncontended. The two decisions are load-bearing for each other.

**Resolves S7.** Per the brief above, the assertion can be promoted to a permanent fitness function.

**Feeds `01-architecture.md` § "Document shape (sketch — S2 will refine)".** The `entries` line can be firmed up from "grow-only set keyed by UUIDv7" to the concrete construct: `Schema.record(Schema.struct.json({...}))`, with the id-uniqueness invariant stated explicitly.

**One correction to `01-architecture.md`.** It states Kyneta's Loro backend rejects `Schema.set()` at the *type* level ("`loro.bind()` produces a type error" — quoted from the Loro backend README). It also rejects at **runtime**, with a clear message. Minor, but it means a JS-only consumer still gets a safe failure rather than silent corruption.

**Feeds the roadmap's invariant list.** `convergence.property.mjs` is ready to promote as the "convergence property test — N random concurrent op streams, all replicas equal" fitness function named in `04-roadmap.md`. It needs only a test-runner wrapper. Recommend keeping the negative control alongside it, as a guard against the property test silently becoming vacuous.

**Unblocks nothing directly** — S7 had no dependents — but it removes document-shape risk from S2 (`KynetaStorage`), which must now satisfy pi's `Storage` over this shape.

## 5. Residual unknowns (NOT resolved)

1. **`seq` is entirely absent from this spike.** I modelled `{id, parentId, role, text}` only. pi's `EntryBase` also carries `seq` and `timestamp`, and `EntryScan{fromSeq,toSeq}` needs **range scans**. That is S1, and nothing here informs it. My entries deliberately have no ordering field at all.
2. **Scale is untested.** Largest trial was ~40 entries; largest total 4,839 across 300 independent docs. Nothing here says how a record with 10k+ entries behaves for `exportSince` size, snapshot time, or memory. Real sessions will exceed this by orders of magnitude.
3. **Raw key order determinism (§3.7) is observed, not specified.** I found no Loro or Kyneta documentation guaranteeing cross-replica map key order. It held in every case I ran, but I would treat it as an implementation detail and keep sorting explicitly in any code that depends on order.
4. **Only the `entries` collection was modelled.** The `values` (LWW map for `pi.branch.tip`, lane/op state), `lists` (`pi.pending.assistant_frame`), `references`, and `presence` namespaces from `01-architecture.md` were not touched. `pi.branch.tip` in particular is a *genuinely contended* LWW register — two peers moving the same lane tip concurrently is exactly the clobber case §3.4 demonstrates, and it is unexamined.
5. **No `Exchange`, no transport, no persistence.** I used `exportSince`/`merge` directly between in-process docs. Nothing here exercises `@kyneta/exchange`, the Line protocol, a store backend, or network reordering/duplication/partition. Sync was cooperative and lossless.
6. **No 3-way+ simultaneous partition healing.** Step 5c syncs pairwise in an awkward order, and the property test syncs random pairs, but I never constructed a true partition (two groups diverging for many ops, then healing).
7. **UUIDv7 generator is mine, not pi's.** I wrote a minimal v7 with a 12-bit monotonic counter for same-millisecond ordering. pi has its own injectable `IdGenerator`. Collision behaviour of *pi's* generator under concurrent multi-peer use is unverified — and §3.4 shows that is the one thing that must not fail.
8. **`Schema.struct.json` value semantics under partial update** were not probed. I only ever wrote whole entries once. If any code path ever does a partial update to an entry value, the LWW-whole-blob semantics may surprise — though ADR-0004 forbids it.
9. **loro-crdt 1.10.8 only.** Not tested against npm-latest 1.16.1, nor against the `>=1.8.0` floor the backend declares.

## Review

**Verdict:** PASS

34/34 assertions, 900 property trials,
~15.9k entries, zero failures. Independently re-verified at a fresh seed.

- Settled the document shape: `Schema.record(Schema.struct.json({...}))`
- Produced **ADR-0009** (id uniqueness as a safety invariant)
- Reproduced the ADR-0008 failure mode locally (§3.5)
- Delivered `convergence.property.mjs` + `negative-control.mjs`, ready to promote
  to a permanent fitness function
- Spawned S8, S9, S10 from its residuals

**One claim in the report is wrong:** it states it is "correcting"
`docs/01-architecture.md` regarding `Schema.set` type-level rejection. Our docs never
mentioned `Schema.set`. The underlying finding (runtime rejection) is retained;
the attribution was invented and no correction was applied.
