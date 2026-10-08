# S12 — What is "the trunk" when every writer has its own lane?

- **Status:** Answered
- **Led to:** ADR-0011, ADR-0012

Spawned S15.

## Brief

**Size:** S · **Depends on:** nothing · **Raised by:** S8 residual #1 + ADR-0011

**Question.** Under ADR-0011 every writer owns a lane, so no lane is canonical.
But the product has a *trunk* — `docs/00-vision.md` is built on "fold an exploration
back into the trunk." What represents it?

**Candidates (none evaluated):** a designated lane name; a label on an entry; a
separate `pi.session.*` pointer; simply the path to a designated leaf.

**Why it matters beyond naming.** It interacts directly with fold: ADR-0010
establishes a fold is **destination-relative** — so "fold into the trunk" needs
a well-defined destination *tip*. If the trunk is a lane, whose lane is it, and
who may write it? If it is a pointer, it is a contended LWW register and
ADR-0011's reasoning applies to it too.

**Kill criterion.** If the trunk cannot be expressed without reintroducing a
shared-writer register, we have moved the ADR-0011 hazard rather than removed
it.

## Report

**Date:** 2026-09-20 · **Sandbox:** `sandbox/s12-trunk` · **Node:** v24.19.0
**pi-agent-core:** 0.85.0 · **`@kyneta/*`:** local workspace (symlinked) · **loro-crdt:** 1.16.1

---

## 1. VERDICT

**The kill criterion is NOT met: the trunk can be expressed without a shared-writer register.** An **append-only promotion log — a DAG keyed by unique promotion id, with explicit parent edges** — makes the trunk a *derived* value rather than stored mutable state, reusing ADR-0009's "unique key ⇒ single writer" mechanism for a third time. 1000/1000 property trials pass; both shared-register controls fail **0/600**.

**But the spike's framing needs correcting, and this is the more important finding.** Two concurrent folds onto the same trunk tip are a **semantic conflict no matter what representation is chosen** — a linear trunk path can contain only one of two siblings. Every one of the five candidates lands **1/2 folds on the trunk path** (or 0/2). The real question is therefore not *"can the trunk avoid contention"* but **"does the conflict fail loudly or silently."** Designs (a) and (c) lose a fold silently. Design (e) detects it structurally and — because ADR-0010 makes a fold destination-relative — the repair is a *re-fold at the new tip*, which is already prescribed rather than a workaround.

---

## 2. What I ran

### Dependency wiring — symlinked local workspace (NOT the S14 dist overlay)

`link:` is a pnpm/yarn protocol; npm rejects it outright:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "link:": link:~/halecraft/kyneta/packages/schema
```

`pnpm install --ignore-workspace` then failed to reach the registry (`Failed to fetch metadata from https://registry.npmjs.org/loro-crdt`). So I installed only the two registry deps with npm and **symlinked the five local Kyneta packages directly into `node_modules/@kyneta/`**. This is a truer `link:` than S14's dist overlay — the real local `package.json` (and its `exports`) is used, not just the `dist/` tree:

```bash
npm install            # loro-crdt@1.16.1, @sindresorhus/fnv1a@3.1.0 only
ln -sfn ~/halecraft/kyneta/packages/schema               node_modules/@kyneta/schema
ln -sfn ~/halecraft/kyneta/packages/schema/backends/loro node_modules/@kyneta/loro-schema
ln -sfn ~/halecraft/kyneta/packages/machine              node_modules/@kyneta/machine
ln -sfn ~/halecraft/kyneta/packages/changefeed           node_modules/@kyneta/changefeed
ln -sfn ~/halecraft/kyneta/packages/random               node_modules/@kyneta/random
```

`workspace:^` never has to resolve because npm is never asked to install those packages. Confirms S14 §2's diagnosis of the root cause:

```
$ node -p "require('.../packages/schema/package.json').dependencies"
{ '@kyneta/changefeed': 'workspace:^', '@kyneta/machine': 'workspace:^',
  '@kyneta/random': 'workspace:^', '@sindresorhus/fnv1a': '^3.1.0' }
```

### Mandatory sanity check

```
$ node sanity.mjs
stepInPlace: function
loro-crdt  : 1.16.1
@kyneta/schema resolved: ~/halecraft/kyneta/packages/schema/dist/index.js
roundtrip  : {"k":"v"}
```

`stepInPlace` is exported (absent from npm 3.0.0) and 1.16.1 ≥ the 1.13.4 floor declared by the local `@kyneta/loro-schema` (`peerDependencies: { "loro-crdt": ">=1.13.4" }`).

### Read-only compliance and a concurrent-rebuild note

I wrote nothing to `~/halecraft/kyneta` or `~/.pi`. `find . -newermt '-60 minutes'` over the Kyneta tree does show recent changes, but they are **build outputs I did not produce** — `.turbo/cache/*`, `packages/schema/dist`, and the loro/yjs backend dists. I ran no build and no package-manager command there; this is concurrent activity in the workspace.

Because the linked dist changed **mid-spike**, I re-ran the full scorecard, the sanity check and the property test afterwards. All results are **identical before and after** the rebuild, and the post-rebuild state still satisfies the preconditions (`stepInPlace` exported, stale-clone marker count 0, `peerDependencies.loro-crdt = ">=1.13.4"`).

### Files

| File | Purpose | Command |
|---|---|---|
| `common.mjs` | shared doc shape, sync helpers, `resolveTrunk` | — |
| `designs.mjs` | **the spike** — five candidates, one identical workload | `node designs.mjs` |
| `refold.mjs` | fork detection → re-fold recovery | `node refold.mjs` (exit 0) |
| `property.mjs` | property test + two negative controls | `node property.mjs [trials] [seed] [pointer\|lane]` |
| `determinism.mjs` | order-independence + single-writer audit | `node determinism.mjs` |
| `sanity.mjs`, `probe-arr.mjs` | wiring checks | — |

### The workload (identical across all five candidates)

Per S13's lesson, every design runs over the **same entry tree** and differs only in how the trunk is named:

```
trunk history   root -> T1 -> T2            (trunk tip = T2)
peer A explores on lane-A off T1:  A1 -> A2   (ADR-0011: own lane)
peer B explores on lane-B off T1:  B1 -> B2   (ADR-0011: own lane)
PARTITION
  A folds: merge entry MA {parentId: T2, fromId: A2}   + moves the trunk
  B folds: merge entry MB {parentId: T2, fromId: B2}   + moves the trunk
HEAL
```

---

## 3. Evidence

### 3.1 pi facts this rests on (quoted, not paraphrased)

`pi-agent-core/dist/harness/session/values.js:62-65` — the three lane-keyed registers of ADR-0011:

```js
export const branchTip = (branch) => value("pi.branch.tip", branch);
export const branchTipInventoryPrefix = () => value("pi.branch.tip");
export const laneConfig = (lane) => value("pi.lane.config", lane);
export const laneState = (lane) => value("pi.lane.state", lane);
```

`values.js:79-80` — **precedents for candidates (c) and (b) exist in pi already**:

```js
export const sessionName = value("pi.session.name");
export const entryLabel = (entryId) => value("pi.entry.label", entryId);
```

`value()` defaults `key = ""` (`values.js:9-12`) and `validateAddress` only rejects an empty *namespace* — so `pi.session.name` is a genuine **keyless, session-global single register**. That is exactly candidate (c)'s shape, and it is shared by construction.

Lane names are near-arbitrary (`session.js:349-355`), confirming S8:

```js
assertValidBranchName(name) {
    if (name.length === 0)
        throw new SessionInvalidBranchError(name, "branch name must not be empty");
    if (name.includes("\u0000")) {
        throw new SessionInvalidBranchError(name, "branch name must not contain \\u0000");
    }
}
```

A lane may be created at any entry (`harness.js:83`), which is what makes candidate (a) even expressible:

```js
const tipId = stored.kind === "branch" ? stored.tip.value : (options.createAt ?? null);
```

**There is no built-in trunk.** `grep -rn '"main"' dist --include=*.js | grep -v test` returns hits only in `jsonl/legacy-v3.js:312,323,332` — the legacy-v3 migration path. The runtime has no privileged lane. Nothing named a trunk exists for us to inherit.

**No lane deletion API** — `grep -rn "deleteValue(branchTip\|deleteValue(laneState\|deleteValue(laneConfig"` over non-test `dist` returns **nothing**, confirming ADR-0011's accumulation note.

### 3.2 The five candidates under partition + heal

```
=== scorecard ===
design | converged | folds discoverable | peers agree | on trunk path | verdict
  (a)  |   true    |        1/2         |    true     |      1/2      | SILENT LOSS
  (b)  |   true    |        2/2         |    true     |      0/2      | VISIBLE + CONVERGENT
  (c)  |   true    |        1/2         |    true     |      1/2      | SILENT LOSS
  (d)  |   true    |        2/2         |    false    |      1/2      | VISIBLE but peers DISAGREE on trunk
  (e)  |   true    |        2/2         |    true     |      1/2      | VISIBLE + CONVERGENT
```

"Folds discoverable" asks: from the **trunk representation alone**, can you enumerate both fold attempts? (The entries themselves always survive — ADR-0009 guarantees that, and `merge entries in doc: 2/2` in every run.)

**(a) designated lane `"main"`, one holder at a time**

```
  trunk tip @A              : d53965
  trunk tip @B              : d53965
  folds DISCOVERABLE via trunk repr : 1/2  <-- SILENTLY LOST
```

This is ADR-0011's hazard verbatim, relocated onto the trunk. Worse, the premise is unachievable: *"only one writer may hold it at a time"* is mutual exclusion, which cannot be maintained across a partition. The lock is precisely the coordination ADR-0011 exists to avoid.

**(b) label on an entry** — visible, but produces **no trunk tip at all**:

```
  trunk tip @A              : null  2 entries labelled trunk
  folds on the trunk path   : 0/2
  labelled entries          : [97c5d5, e347f4]
```

The `true` in "peers agree" is agreement that the trunk is `null` — agreement on *undefined*, not a usable answer. Moving the trunk also needs two writes (clear old label, set new), so a partition leaves two entries labelled `"trunk"` with no rule to choose between them. Fixable only by adding a tiebreak — at which point it is a worse-specified (e).

**(c) separate `pi.session.trunk` pointer** — identical to (a):

```
  folds DISCOVERABLE via trunk repr : 1/2  <-- SILENTLY LOST
```

**This is the kill-criterion candidate and it fails.** A keyless session register is a single LWW key with N writers. It is ADR-0011's hazard with a different name.

**(d) no trunk — per-peer designated leaf**

```
  trunk tip @A              : 535a25  per-peer view (A)
  trunk tip @B              : 046686  per-peer view (B)
  A and B agree on trunk    : false
```

Single-writer and lossless, but peers **permanently disagree** and never reconverge. Coherent under ADR-0010 (a fold is destination-relative, so "my trunk" is well-defined), yet it cannot express the shared artifact `00-vision.md` assumes when it says *"fold an exploration back into the trunk."*

**(e) append-only promotion DAG**

```
  trunk tip @A              : 394073  FORK DETECTED: 2 promotion leaves
  trunk tip @B              : 394073  FORK DETECTED: 2 promotion leaves
  A and B agree on trunk    : true
  folds DISCOVERABLE via trunk repr : 2/2
  promotion leaves          : [e0c1bfbyA, 394073byB]
```

Both promotions durable, replicas agree on the derived tip, **and the concurrency is structurally detected** rather than inferred from timestamps.

### 3.3 A design correction the experiment forced

My first (e) gave each promotion a single `prevPromotionId`. `refold.mjs` showed that is wrong:

```
=== repair: re-fold A2 at the new trunk tip (ADR-0010) ===
  promotion leaves : 2  -> FORK STILL PRESENT
```

A losing promotion is never extended by anything, so it **stays a leaf forever** and fork detection becomes a permanent false positive. The fix is to make `prev` a *list* — a promotion that resolves a fork extends **every leaf it supersedes**, exactly as a merge commit has two parents:

```js
promotions: Schema.record(Schema.struct.json({
  id: Schema.string(),
  entryId: Schema.string(),            // entry being promoted to trunk tip
  prev: Schema.list(Schema.string()),  // promotions this one extends/supersedes
  peer: Schema.string(),
  ts: Schema.number(),
}))
```

(`Schema.array` does not exist — the constructor is `Schema.list`, verified by `probe-arr.mjs`. Inside `Schema.struct.json` the value is opaque JSON, so a list field round-trips fine: `{"id":"k","prev":["a","b"]}`.)

With `prev` as a list, recovery completes:

```
=== after heal ===
  promotion leaves : 2  -> FORK DETECTED
  leaves           : 7064ec by A (prev=d98050)  |  e70cbd by B (prev=d98050)
  winning trunk tip: e70cbd (by ts,peer,id)
  loser            : 7064ec by A  -- durable, queryable, NOT silently gone
  A's fold MA on trunk path? false

=== repair: re-fold A2 at the new trunk tip (ADR-0010) ===
  promotion leaves : 1  -> FORK RESOLVED
  trunk path       : [41c15c -> 97333b -> d83d19 -> e70cbd -> 331bea]
  both folds now on trunk path? MA2=true MB=true
  stale MA still in doc (immutable, ADR-0004)? true
  replicas converged: true

>>> RECOVERY WORKS: fork detected, re-folded, single trunk, nothing destroyed
```

Note the repair re-folds **A2 (the original source branch)**, not MA. Per ADR-0010 the summary is destination-relative, so a fresh fold at the new tip is the *correct artifact*, not a graft of the stale one. The stale MA remains in the document, immutable per ADR-0004, as durable provenance of the attempt.

### 3.4 Property test + negative controls

Invariant — **promotion durability**: every promotion a peer performs remains discoverable in the converged document, and all replicas agree on the derived trunk tip.

Deliberately *not* "every fold is on the trunk path". S8 learned that reachability is not an invariant once `navigateTree` exists; the same applies here for a stronger reason — a linear path **cannot** contain two siblings. Asserting it would fail for every design including the correct one.

2–4 peers, 10–34 random ops (55% fold+promote, 25% own-lane append, 20% pairwise sync), seeded PRNG, random sync interleavings.

```
design (e) promotion DAG: 200/200 trials passed (seed=20260920, 2406 promotions)
design (e) promotion DAG: 200/200 trials passed (seed=1, 2403 promotions)
design (e) promotion DAG: 200/200 trials passed (seed=999, 2416 promotions)
design (e) promotion DAG: 200/200 trials passed (seed=42, 2368 promotions)
design (e) promotion DAG: 200/200 trials passed (seed=7777, 2530 promotions)

--- CONTROLS (must fail every trial) ---
CONTROL (pointer: shared trunk register): 0/100 trials passed (seed=20260920, 0 promotions)
  first failure: trial 0 — promotion by p0 of 2a21a2 is NOT discoverable — SILENTLY LOST (peers=2, ops=17)
CONTROL (pointer: shared trunk register): 0/100 trials passed (seed=1, 0 promotions)
  first failure: trial 0 — promotion by p2 of 151791 is NOT discoverable — SILENTLY LOST (peers=3, ops=10)
CONTROL (pointer: shared trunk register): 0/100 trials passed (seed=999, 0 promotions)
  first failure: trial 0 — promotion by p3 of 2efe11 is NOT discoverable — SILENTLY LOST (peers=4, ops=25)
CONTROL (lane: shared trunk register): 0/100 trials passed (seed=20260920, 0 promotions)
  first failure: trial 0 — promotion by p0 of 46904f is NOT discoverable — SILENTLY LOST (peers=2, ops=17)
CONTROL (lane: shared trunk register): 0/100 trials passed (seed=1, 0 promotions)
  first failure: trial 0 — promotion by p2 of 44069e is NOT discoverable — SILENTLY LOST (peers=3, ops=10)
CONTROL (lane: shared trunk register): 0/100 trials passed (seed=999, 0 promotions)
  first failure: trial 0 — promotion by p3 of 900544 is NOT discoverable — SILENTLY LOST (peers=4, ops=25)
```

**1000/1000 for (e); 0/600 across two independent controls.** Both controls run the *same* workload and differ only in the trunk representation (S13's lesson).

### 3.5 Determinism and single-writer audit

```
order-independent resolution over 500 shuffles: true  (tip=E5, leaves=3)
promotion keys written more than once: 0  (ADR-0009 discipline held: true)
replicas agree on trunk tip: true  leaves=[3,3,3]
total promotions durable: 91 / 91
```

`resolveTrunk` is a pure function of the promotion set, insensitive to map iteration order (500 shuffles). Over 30 rounds × 3 peers with partitioned promotion, **91/91 promotions durable and zero promotion keys written twice** — the ADR-0009 discipline holds by construction, because keys are UUIDv7.

---

## 4. Consequences for the plan

**Kill criterion NOT met.** The trunk is expressible without a shared-writer register. ADR-0011 needs a **companion, not an amendment**.

**Proposed ADR-0012 — "The trunk is a derived value over an append-only promotion DAG."**
The trunk is not stored mutable state. Promotions are records in `Schema.record` keyed by UUIDv7, each carrying `prev: string[]` (the promotions it extends or supersedes). The trunk tip is *derived*: the single leaf of that DAG, or — when concurrency produced several — the winner under a total order `(ts, peer, id)`, with the fork **explicitly surfaced**. This is ADR-0009's "unique key ⇒ single writer" mechanism applied a third time (entry ids, lane names, now promotion ids).

**Confirms ADR-0009** — a third independent application of the same mechanism. Zero duplicate key writes across 91 concurrent promotions.

**Confirms ADR-0011** and rules out relocating its hazard. Candidates (a) and (c) reintroduce a shared-writer register and lose folds silently, 0/600 in controls. Note (c) would have looked *idiomatic* — `pi.session.name` is real precedent at `values.js:79` — which is exactly why it needed measuring.

**Extends ADR-0010 with a corollary.** ADR-0010 said a fold is destination-relative. S12 shows that makes **fork repair free**: when a promotion loses, the source branch is simply re-folded at the new tip. The losing merge node is not rolled back or grafted — it stays as immutable provenance (ADR-0004) and a fresh, correctly-scoped summary is produced. Repair is the mechanism already prescribed, applied twice.

**Amends `01-architecture.md` § Fold.** It currently says *"Two peers folding B concurrently produce two different merge nodes. Both are valid and immutable; the UI must expect this."* That is right but incomplete: two peers folding **into the same trunk tip** additionally contend for *trunk succession*, which a linear path cannot grant to both. Add: the UI must render an unresolved trunk fork (≥2 promotion leaves) and offer re-fold.

**New UI requirement.** `leaves.length > 1` is a first-class, queryable state meaning "the trunk has an unresolved fork." It is not an error; it is the multiplayer equivalent of a merge conflict, and it is detected *structurally* rather than heuristically.

**v1 is unaffected**, for the same reason ADR-0011 is: one host serialises commits (S2/T5), so concurrent promotion needs ≥2 harness processes. S12 is a prerequisite for multi-device/team multiplayer.

**Spawns S15 (suggested, small):** the winner rule uses wall-clock `ts`. Convergence does not depend on the rule (only on it being *total*), but *which* fold wins does, and clock skew across devices makes `ts` adversarial. Evaluate a Lamport/causal-length rule instead — plausibly shared with S1's Lamport work.

---

## 5. Residual unknowns (NOT resolved)

1. **The winner rule is wall-clock-based.** `(ts, peer, id)` is total, so replicas converge — but under clock skew the "winner" may not be the causally later fold. Not tested with skewed clocks. → S15.
2. **No pi harness was run.** Everything models pi's write semantics over Kyneta docs directly, as S8 did. `KynetaStorage` was never handed an `AgentHarness` with two live harnesses promoting concurrently. S3 owns that integration question; S3's own residual #1 (the drive loop was stubbed) still stands.
3. **How the promotion log is *stored* in pi's `Storage` is unspecified.** It has no pi namespace. Options — a `pi.trunk.promotion` value namespace keyed by promotion id, or `CustomEntry` records in the entry tree itself — were not evaluated. The second is attractive (it would inherit entry convergence for free) and was not tested.
4. **Trunk-fork resolution policy is unspecified.** I showed a fork *can* be resolved by re-fold. Who resolves it, whether it can be automatic, and what happens if two peers resolve the *same* fork concurrently (producing a new fork) were not tested. The structure permits arbitrary depth; whether it converges in practice is unmeasured.
5. **No promotion GC.** Like lanes, promotions accumulate forever. A long-lived session accrues one record per fold. Unbounded but small; no compaction path examined.
6. **Candidate (b) was not rescued.** A label plus a tiebreak might be made to work; I judged it strictly dominated by (e) and did not pursue it. That judgement is argued, not measured.
7. **Two peers promoting the *same* entryId** concurrently (double-promotion rather than competing promotion) was not tested. Distinct promotion ids mean both records survive; whether `resolveTrunk` should dedupe by `entryId` is unexamined.
8. **Scale.** Largest run: 4 peers, ~35 ops, 91 promotions. Nothing near session-lifetime volume.
9. **No `@kyneta/exchange`, Line, transport, or persistence.** In-process `exportSince`/`merge` only, cooperative and lossless — no true partition healing, reordering, or duplication.

---

## 6. Verified vs assumed

**Verified by execution:** the `link:`/npm and pnpm failures quoted verbatim; the sanity check (`stepInPlace` a function, loro-crdt 1.16.1, resolution into the local workspace dist); every number in the §3.2 scorecard; the single-`prev` fork-persistence failure *and* its resolution with a list-valued `prev` (`refold.mjs` exit 1 → exit 0); 1000/1000 property trials across 5 seeds; 0/600 across two controls and 3 seeds each; 500-shuffle order-independence; 91/91 promotion durability with zero duplicate key writes; `Schema.array` not existing and `Schema.list` working inside `Schema.struct.json`.

**Verified by source reading (quoted with file:line):** `values.js:62-65` lane-keyed registers; `values.js:79-80` `pi.session.name` (keyless) and `pi.entry.label`; `values.js:9-12` + `validateAddress` permitting an empty key; `session.js:349-355` branch-name validation; `harness.js:83` `createAt`; `AcquireLaneOptions` at `agent-harness.d.ts:676-678`; absence of `deleteValue` on any lane register in non-test `dist`; `"main"` appearing only in `jsonl/legacy-v3.js`.

**Assumed, not verified:**
- That modelling pi's writes over a Kyneta doc predicts a real two-harness deployment (S3 owns this; S8 made the same assumption).
- That `(ts, peer, id)` is an acceptable *product* rule for which fold wins. Only its totality — hence convergence — was tested.
- That candidate (b) cannot be made competitive (§5.6).
- That the promotion log belongs in the same document as entries. Plausible and untested; a cross-document trunk would raise sync-ordering questions this spike did not touch.
- That `00-vision.md`'s "the trunk" denotes a single shared artifact per session. Design (d) is coherent if it does not, and the product question was not re-litigated here.

## Review

**Verdict:** kill criterion NOT met

The trunk **can** be expressed without a
shared-writer register → **ADR-0012**. 1000/1000 property trials; **0/600** on
two independent controls; re-verified at a fresh seed.

- **Reframed the question.** Two concurrent folds onto one trunk tip are a
  *semantic* conflict in every representation — a linear path holds one of two
  siblings. All five candidates scored 1/2 or 0/2 on "folds on the trunk path."
  The real question is **loud vs. silent failure**, not contention avoidance.
- **The idiomatic-looking option fails.** Candidate (c), a keyless
  `pi.session.trunk` register, has real precedent — pi ships
  `sessionName = value("pi.session.name")` at `values.js:79`. It loses folds
  silently, 0/600. Exactly why it needed measuring rather than reasoning about.
- **The experiment corrected the design.** Single-`prev` promotions leave losers
  as permanent leaves ⇒ permanent false-positive fork detection. `prev` must be
  a **list** (merge-commit shaped). Caught by `refold.mjs` failing, then passing.
- **ADR-0010 pays off twice:** fold destination-relativity makes fork repair
  *free* — re-fold the source at the new tip; the stale merge node survives as
  immutable provenance.
- **Wiring note:** `link:` is a pnpm/yarn protocol — npm rejects it
  (`EUNSUPPORTEDPROTOCOL`), and `pnpm --ignore-workspace` couldn't reach the
  registry. The agent **symlinked the local packages into `node_modules/@kyneta/`**
  instead, which is a *truer* link than S14's dist overlay: the real local
  `package.json` and its `exports` are used. `workspace:^` never has to resolve
  because npm is never asked to install those packages.
- **Noticed a concurrent rebuild** of `~/halecraft/kyneta` mid-spike (not its own
  doing — your team's), and **re-ran the entire scorecard afterwards**; results
  identical before and after.
- Spawned **S15**.
