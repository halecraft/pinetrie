# S14 — Re-validate the evidence base against FIXED Kyneta + the new loro floor

**Status:** Answered. Closed S13, and partly discharged S10.

**Date:** 2026-09-20 · **Sandbox:** `sandbox/s14-revalidate` · **Node:** v24.19.0

---

## 1. VERDICT

**The evidence base SURVIVES the version bump intact — every correctness suite passes with byte-identical figures, and performance improves by a further 20× beyond what S11 projected.** The kill criterion is not met: nothing regressed. Two findings change the plan materially: **S13 is CLOSED and CONFIRMED** (the residual ×3.5 superlinearity was loro-crdt's O(keys²) event build, demonstrated in raw loro-crdt with zero Kyneta involvement), and the write-throughput budget should be **tightened ~20×, not merely updated**, because the old 2 s figure is too loose to catch a loro-crdt floor violation.

---

## 2. Configurations and how they were wired

`@kyneta/*` packages declare `workspace:^` dependencies, so the local workspace cannot be installed via `npm install file:…`. Instead each configuration did a normal `npm install` of the published 3.0.0 packages (which resolves valid semver metadata), and the **local built `dist/` trees were then overlaid** onto `node_modules`:

```bash
rm -rf node_modules/@kyneta/schema/dist
cp -R ~/halecraft/kyneta/packages/schema/dist node_modules/@kyneta/schema/dist
#  … and likewise for loro-schema, machine, changefeed, random
```

Overlaying `@kyneta/machine` matters: `packages/schema/dist/_shared/sync.js` imports `"@kyneta/machine"` at runtime, and `da978ec` touched `packages/machine/src/dispatcher.ts` (the `createDispatcher` stack-walk fix). Using the npm `machine` would have silently omitted one of the three extra causes.

| Config | `@kyneta/*` | `loro-crdt` | Supported? | Purpose |
|---|---|---|---|---|
| **A** `cfgA-npm-loro1108` | npm 3.0.0 | **1.10.8** | ✗ below floor | the original S2/S7/S8/S3/S11 baseline |
| **B** `cfgB-npm-loro116` | npm 3.0.0 | **1.16.1** | ✗ (stale kyneta) | isolates the loro-crdt fix alone |
| **C** `cfgC-local-loro116` | **local fixed** | **1.16.1** | ✓ **authoritative** | everything fixed |
| **D** `cfgD-local-loro1108` | **local fixed** | **1.10.8** | ✗ below floor | **diagnostic only** — isolates the Kyneta fix alone, and reproduces S11's "patched" state |

Config D was added mid-spike. It was not in the task brief, but without it the 2×2 factorial is incomplete and the S13 question ("is the residual due to loro?") cannot be answered.

Resolved versions, read from each `node_modules`:

```
--- cfgA-npm-loro1108        --- cfgB-npm-loro116
    @kyneta/schema = 3.0.0       @kyneta/schema = 3.0.0
    @kyneta/loro-schema = 3.0.0  @kyneta/loro-schema = 3.0.0
    @kyneta/machine = 3.0.0      @kyneta/machine = 3.0.0
    @kyneta/changefeed = 3.0.0   @kyneta/changefeed = 3.0.0
    @kyneta/random = 3.0.0       @kyneta/random = 3.0.0
    loro-crdt = 1.10.8           loro-crdt = 1.16.1
```

`^1.16.0` resolved to **1.16.1**, comfortably above the new floor.

### Provenance of the "fixed" build

The local dists are fresh — no `src/*.ts` is newer than its `dist/index.js`:

```
  packages/schema:               dist=09-19 21:46   src-newer-than-dist: none
  packages/schema/backends/loro: dist=09-19 21:52   src-newer-than-dist: none
  packages/machine:              dist=09-19 21:46   src-newer-than-dist: none
  packages/changefeed:           dist=09-19 21:41   src-newer-than-dist: none
  packages/random:               dist=09-19 21:41   src-newer-than-dist: none
```

`da978ec` is dated `2026-09-19 21:17:40 -0600`, so every dist post-dates it by 24–35 minutes.

Marker checks — the stale `deepClonePlain(path.read(…))` from S11 cause A:

```
  cfgA-npm-loro1108:  schema=1  loro-schema=1     <- stale
  cfgB-npm-loro116:   schema=1  loro-schema=1     <- stale
  cfgC-local-loro116: schema=0  loro-schema=0     <- fixed
```

**One discrepancy worth recording:** `da978ec` is *not* an ancestor of the colocated git `HEAD`.

```
$ git merge-base --is-ancestor da978ec HEAD  →  NO
```

The Kyneta repo is jj-colocated and git `HEAD` points at `c84a5ca` (a datalog/perspective line). The **working copy** carries the fix — `packages/schema/src/reader.ts:12` imports `stepInPlace`, and `git status --porcelain` lists exactly the 11 schema+machine files `da978ec` touched as modified relative to git `HEAD`. All measurements here are against the working copy's built dist, which is the thing that matters. I did not resolve why git `HEAD` diverges; it is a jj/git bookkeeping question, not a code question.

### Read-only compliance

```
=== nothing written outside s14 sandbox? ===
  s3-harness: 0 files modified since session start
  s7-convergence: 0 · s2-storage: 0 · s8-tip: 0 · s11-perf: 0 · s5-fold: 0
=== kyneta untouched? ===
  files modified since session start: 0
=== ~/.pi untouched? ===  session dirs: 11
```

`~/halecraft/kyneta` was read with `cp -R` only; no build, no package-manager command, no write.

---

## 3. A — CORRECTNESS on the supported floor (config C)

### 3.1 S2 — pi `Storage` conformance

```
########## memory control ##########      ########## kyneta (FIXED, loro 1.16.1) ##########
  TOTAL: 21/21 passed, 0 failed             TOTAL: 21/21 passed, 0 failed
```

The suite's slow case continues to improve as a side effect:

| build | `clamps one read page without limiting list growth` |
|---|---|
| S2 original (npm 3.0.0 + loro 1.10.8) | 12 198 ms |
| S11 patched-npm | 267 ms |
| **S14 config C** | **163 ms** |

### 3.2 S7 — convergence property, published seeds

```
convergence property: 200/200 trials passed (seed=12648430, up to 4 peers, 3347 entries total)
convergence property: 100/100 trials passed (seed=1,        up to 4 peers, 1589 entries total)
convergence property: 100/100 trials passed (seed=42,       up to 4 peers, 1748 entries total)
convergence property: 100/100 trials passed (seed=99999,    up to 4 peers, 1729 entries total)
convergence property: 100/100 trials passed (seed=7777777,  up to 4 peers, 1648 entries total)
convergence property: 300/300 trials passed (seed=2026,     up to 4 peers, 4839 entries total)
```

**900/900 trials. Every entry total is byte-identical to S7's published figures** (3347 / 1589 / 1748 / 1729 / 1648 / 4839). Behaviour is unperturbed, not merely "still passing".

Negative control still has teeth:

```
TRIAL 0 FAILED (seed=42): entry t0-collide-1 parent t0-collide-2 !== t0-collide-1  peers=3 ops=23
  exit=1
```

### 3.3 S8 — single-writer register fidelity, published seeds

```
design (c) lane-per-peer: 200/200 trials passed (seed=20260920, 3264 entries)
design (c) lane-per-peer: 200/200 trials passed (seed=1,        3221 entries)
design (c) lane-per-peer: 200/200 trials passed (seed=999,      3226 entries)
design (c) lane-per-peer: 200/200 trials passed (seed=42,       3256 entries)
design (c) lane-per-peer: 200/200 trials passed (seed=7777,     3272 entries)
```

**1000/1000. Entry totals identical to published** (3264 / 3221 / 3226 / 3256 / 3272).

Shared-lane control still fails 0/300:

```
CONTROL (all peers share lane 'main'): 0/100 (seed=20260920, 0 entries)
  first failure: trial 0 — peer 1: lane main tip is bffd5e but this peer last wrote 31b664 — LOST WRITE (peers=2, ops=17)
CONTROL: 0/100 (seed=1)   first failure: trial 0 — peer 1 … (peers=3, ops=10)
CONTROL: 0/100 (seed=999) first failure: trial 0 — peer 0 … (peers=4, ops=25)
  control exit=1
```

The `(peers, ops)` shapes match S8's published first failures exactly. The entry **ids** differ (`bffd5e` vs published `2db6bb`) because ids are UUIDv7 and therefore time-dependent — expected, not a divergence.

### 3.4 S3 — real `AgentHarness` over `KynetaStorage`

```
STEP1: pass=12 fail=0     (exit=0)   — harness runs over KynetaStorage
STEP7: pass=10 fail=0     (exit=0)   — lane-per-peer mitigation holds
```

Step 7's own `seq` caveat is unchanged:

```
  entries=8  distinct seq=5  duplicates=3
  >>> lane-per-peer does NOT fix seq: collisions remain
```

And the known **defect reproduction** still reproduces (this is the roadmap's deliberately-failing fitness function, so reproducing is the correct outcome):

```
    seq=  7  f46220="A-1"  ,  88ed02="B-1"   <<< COLLISION
    seq= 10  721c10="A-2"  ,  28d0c6="B-2"   <<< COLLISION
    seq= 13  de8ab2="A-3"  ,  336469="B-3"   <<< COLLISION
  total entries: 7   distinct seq values: 4
    >>> SKIPPED BY PAGINATION: 7:88ed02="B-1"
  seq collisions after partition heal : YES (3)
```

### 3.5 Correctness is invariant across all four configs

Cross-checks, to establish that neither the loro bump nor the Kyneta fix perturbs behaviour in isolation:

| config | S7 seed 12648430 | S7 seed 42 | S8 seed 20260920 |
|---|---|---|---|
| B (npm kyneta + loro 1.16.1) | 200/200, **3347** | 100/100, **1748** | 200/200, **3264** |
| C (local + loro 1.16.1) | 200/200, **3347** | 100/100, **1748** | 200/200, **3264** |
| D (local + loro 1.10.8) | 200/200, **3347** | — | — |
| published (npm + loro 1.10.8) | 200/200, **3347** | 100/100, **1748** | 200/200, **3264** |

Identical across every combination.

---

## 4. B — PERFORMANCE

### 4.1 The pine·trie shape to n=10 000

`Schema.record(Schema.struct.json({id,parentId,type,text}))` for entries, `Schema.record(Schema.list(Schema.any()))` for pending frames.

| n | **A** npm+1.10.8 | **B** npm+1.16.1 | **D** local+1.10.8 | **C** local+1.16.1 | C vs A |
|---|---|---|---|---|---|
| **entries record.set** ||||||
| 1 000 | 301 ms | 295 ms | 39 ms | **22 ms** | 14× |
| 5 000 | 8 901 ms | 8 645 ms | — | **53 ms** | 168× |
| 10 000 | 38 444 ms | 36 902 ms | — | **93 ms** | **413×** |
| **pending list append** ||||||
| 1 000 | 263 ms | 209 ms | 17 ms | **17 ms** | 15× |
| 5 000 | 3 229 ms | 3 190 ms | — | **58 ms** | 56× |
| 10 000 | 12 731 ms | 12 575 ms | — | **92 ms** | **138×** |

**The loro-crdt fix alone (A→B) does essentially nothing** — 38 444 → 36 902 ms, a 4 % change. The Kyneta-side defects dominate so completely that they mask it. This is important: anyone republishing loro but not Kyneta would see no improvement and might wrongly conclude the loro floor is irrelevant.

### 4.2 The doubling curve — the 2×2 factorial

Exponent measured directly at n = 1 000 / 2 000 / 4 000 / 8 000:

**`entries record.set` — ratio per doubling (and ms at n=8 000)**

| | loro-crdt **1.10.8** | loro-crdt **1.16.1** |
|---|---|---|
| **kyneta npm 3.0.0** | **×4.34** (24 316 ms) | **×4.34** (23 213 ms) |
| **kyneta local-fixed** | **×3.77** (1 159 ms) | **×1.83** (67 ms) |

**`pending list append` — ratio per doubling (and ms at n=8 000)**

| | loro-crdt **1.10.8** | loro-crdt **1.16.1** |
|---|---|---|
| **kyneta npm 3.0.0** | ×3.93 (8 191 ms) | ×3.91 (8 146 ms) |
| **kyneta local-fixed** | ×1.81 (78 ms) | ×1.95 (78 ms) |

Reading the factorial:

- **Lists** need only the Kyneta fix. The loro version is irrelevant (78 ms either way, ×1.81 vs ×1.95 — both linear).
- **Maps (`record.set`) need BOTH.** The Kyneta fix takes 24 316 → 1 159 ms but leaves ×3.77 superlinearity. The loro bump then takes 1 159 → 67 ms and ×3.77 → ×1.83.
- **Config D reproduces S11's "patched" state almost exactly**: S11 measured 1 177 ms at n=8 000 for Loro `record.set` on its patched-npm build; config D measures **1 159 ms**. That agreement confirms D is the right control for the S13 question.

### 4.3 S13 — CONFIRMED, and demonstrated in raw loro-crdt

The task asked to confirm or refute the commit message's attribution:

> *"loro-crdt built a commit's event in O(keys²) whenever a subscriber is attached, which for this substrate is always — bisected to 1.13.3, fixed in 1.13.4, hence the peer floor."*

Tested directly in **raw `loro-crdt`, with no Kyneta in the process at all** (`loro-subscriber.mjs`), toggling a single `doc.subscribe(() => {})`:

```
=== raw loro-crdt 1.10.8 — map set, subscriber on/off ===
-- subscriber none --                    -- subscriber ATTACHED --
  n= 1000        8ms                       n= 1000       24ms
  n= 2000        6ms  x0.72                n= 2000       75ms  x3.13
  n= 4000       10ms  x1.80                n= 4000      280ms  x3.75
  n= 8000       19ms  x1.88                n= 8000     1084ms  x3.87

=== raw loro-crdt 1.16.1 — map set, subscriber on/off ===
-- subscriber none --                    -- subscriber ATTACHED --
  n= 1000        7ms                       n= 1000        6ms
  n= 2000        5ms  x0.73                n= 2000        7ms  x1.18
  n= 4000        9ms  x1.87                n= 4000       14ms  x2.04
  n= 8000       16ms  x1.75                n= 8000       28ms  x2.00
```

**Confirmed on every point of the claim:**

1. The cost appears **only when a subscriber is attached** — 19 ms → 1 084 ms at n=8 000 on 1.10.8, a **57× penalty** for attaching one no-op listener.
2. It is **superlinear** when attached (×3.87) and linear when not (×1.88) — consistent with O(keys²).
3. It is **fixed by the version bump** — 1.16.1 attached is ×2.00 and 28 ms, a 1.75× overhead over unsubscribed rather than 57×.

This also explains **why S11 missed it**. S11's raw-loro control measured `loro map set` *without* a subscriber, saw linear behaviour, and therefore concluded the residual "is something the Kyneta→Loro binding does per key, not a `LoroMap` limitation." The control was measuring a different code path from the one the substrate uses. The Kyneta Loro substrate always attaches a subscriber, so it always paid the quadratic cost.

**S13 is closed.** The residual was not in the Kyneta binding. It was upstream in loro-crdt, and it is already fixed at the declared floor.

One nuance I did **not** verify: that the mechanism is literally "building the commit's event in O(keys²)". I verified the *effect* (subscriber-gated, superlinear, version-fixed) as a black box. Bisecting to 1.13.3/1.13.4 specifically was also not re-done — I tested 1.10.8 vs 1.16.1 only, both on the correct side of the claimed boundary.

---

## 5. C — DELIVERABLE BUDGET NUMBERS

Median of 5 reps on config C, extended to n=50 000 to confirm the curve holds:

```
-- entries record.set (5 reps, ms) --      -- pending list append (5 reps, ms) --
  n= 10000  min=  95  med= 103  max= 125     n= 10000  min=  88  med=  94  max= 113
  n= 20000  min= 215  med= 220  max= 227     n= 20000  min= 255  med= 291  max= 334
  n= 50000  min= 588  med= 626  max= 668     n= 50000  min= 675  med= 739  max= 864
```

Linear to 50 000 (5× n → 6.1× time for entries, 7.9× for lists), and still sub-second.

### Replacement for the roadmap's budget

`04-roadmap.md` currently carries, from S11's patched-npm build:

> **10 000 entry writes ≤ ~2 s**, **10 000 list appends ≤ ~0.25 s**

| | measured now (median) | old budget | **proposed budget** | headroom |
|---|---|---|---|---|
| entries record.set, n=10 000 | **103 ms** | ≤ 2 000 ms | **≤ 1 000 ms** | ~10× |
| pending list append, n=10 000 | **94 ms** | ≤ 250 ms | **≤ 500 ms** | ~5× |

**The entries budget should be tightened, not relaxed, and this is the substantive recommendation.** The old 2 s figure is *too loose to catch a loro-crdt floor violation*: config D (correct Kyneta, loro below the floor) runs ~1 159 ms at n=8 000, extrapolating to roughly 1.8 s at n=10 000 — which would slip under a 2 s budget. A **1 s** budget trips on it, and still trips ~370× earlier on an unpatched Kyneta republish (38 s).

The list budget can be loosened slightly to 500 ms — measured 94 ms, and it is loro-version-insensitive, so 5× absorbs CI noise while still catching the 12.7 s unpatched case.

### A more robust guard than a stopwatch

Timing budgets are machine-dependent and will be flaky in CI. Two **deterministic** assertions catch the same regressions far more reliably, and I recommend adding them alongside:

```js
// 1. the Kyneta fix is present
import { stepInPlace } from "@kyneta/schema"
assert(typeof stepInPlace === "function")     // absent in npm 3.0.0

// 2. the loro floor is respected
assert(semverGte(require("loro-crdt/package.json").version, "1.13.4"))
```

The first fails on an unpatched republish; the second fails on a floor violation. Neither is timing-sensitive. Keep the wall-clock budgets as a backstop for *new* regressions that neither marker catches.

---

## 6. D — `stepInPlace` and the `undefined` guard

### D1 — Is `stepInPlace` exported from the public barrel? **Yes.**

```
=== kyneta=LOCAL-FIXED ===
stepInPlace exported from barrel: function

=== kyneta=npm-3.0.0 ===
stepInPlace exported from barrel: undefined
```

Present in both `dist/index.js` and `dist/index.d.ts` (2 occurrences each), and re-exported from `_shared/sync.js` as `ct as stepInPlace`. Source: `packages/schema/src/index.ts:521`.

### D2 — Is S11's fast-path guard now unnecessary? **Yes — twice over, and the question is moot.**

**First: the guard no longer exists.** S11's patch special-cased `applyChange`. The landed fix is structurally different and strictly broader:

```ts
export function applyChange(state: PlainState, path: Path, change: ChangeBase): void {
  const current = path.length === 0 ? state : path.read(state)
  const next = stepInPlace(current, change)
  if (next === current) return
  if (path.length === 0) {
    // The root object's identity is the document's — every reader closes
    // over it — so a fresh σ is copied onto it rather than replacing it.
    if (isNonNullObject(next)) syncShadow(state, next)
    return
  }
  writeByPath(state, path, next)
}
```

`stepInPlace` dispatches over **`map`, `sequence`, `set-op` and `tree`**, falling back to pure `step` otherwise. And `mutateSequence` walks `retain` / `insert` / `delete` at an arbitrary cursor — so **middle inserts, deletes and moves are covered**, which S11's patch explicitly did not do (S11 residual #4).

**Second: the underlying reason for the guard is fixed.** S11 guarded against `stepSequence` silently dropping `undefined`. Measured directly:

```
=== kyneta=npm-3.0.0 ===
step([1,undefined,3], retain3+insert4) = [1,3,4]          <- element DROPPED, array shortened

=== kyneta=LOCAL-FIXED ===
step([1,undefined,3], retain3+insert4) = [1,undefined,3,4] <- preserved
stepInPlace same array? true
```

(`JSON.stringify` renders the hole as `null`; the raw value printed by Node is `undefined`.)

So the pure arrow now preserves `undefined`, `stepInPlace` mutates in place and returns the same array identity, and no caller-side guard is needed. This matches the commit's *"Fixed in passing: `stepSequence` silently dropped `undefined` elements, an accident of dodging a banned non-null assertion in `2980d9c`."*

---

## 7. Consequences for the plan

**Nothing regresses.** Every ADR that rested on S2/S3/S5/S7/S8/S11 stands. ADR-0009 (id uniqueness) and ADR-0011 (lane-per-writer) are re-confirmed with identical trial counts on the supported floor.

**`01-architecture.md` § Risks — the `@kyneta/schema` writes row should be rewritten.** It currently reads *"Blocked on a republish, not on design. Residual: Loro map-write path still ~×3.5 per doubling, in wasm, unexplained → S13."* Both halves are now stale. Suggested: *"Fixed upstream in `da978ec` (2026-09-19): `step` = copy ∘ core, `stepInPlace` = core, `applyChange` uses the dual. Requires loro-crdt ≥1.13.4. pine·trie shape n=10 000: entries 38 444 → 93 ms, lists 12 731 → 92 ms. Linear to n=50 000. Residual: none — S13 closed, the ×3.5 was loro-crdt's subscriber-gated O(keys²) event build."*

**S13 moves to Resolved** with a CONFIRMED verdict, evidenced in raw loro-crdt (§4.3). It was never a Kyneta binding issue.

**S11's §3.9 conclusion should be corrected in place.** It states the residual *"is something the Kyneta→Loro binding does per key, not a `LoroMap` limitation."* That is wrong, and the reason is instructive: S11's raw-loro control ran **without a subscriber**, which is not the path the substrate uses. Worth preserving as a methodological note — a control must exercise the same configuration as the subject.

**S11's `fixB-reader.patch` is superseded** and should be marked as such rather than carried as a live deliverable. The landed fix covers more cases (set-op, tree, middle inserts, deletes) and needs no `undefined` guard. The roadmap action item *"Review and land `sandbox/s11-perf/fixB-reader.patch`"* is **done by other means** and should be struck.

**The roadmap action item "Republish `@kyneta/schema` and `@kyneta/loro-schema`" is now more urgent and larger in scope.** Config B shows the loro bump alone buys ~4 %; the value is entirely in the Kyneta republish. The republish must also **raise the published `loro-crdt` peer floor** — npm 3.0.0 currently declares `>=1.8.0`:

```
{"loro-crdt":">=1.8.0","@kyneta/changefeed":"^3.0.0","@kyneta/schema":"^3.0.0"}
```

whereas the working copy declares `>=1.13.4`. A republish that ships the code fix but keeps `>=1.8.0` would let consumers install a combination (config D) that is 17× slower on the entries path than it should be, with no warning.

**Budget numbers in `04-roadmap.md` change** — see §5. The entries budget *tightens* from 2 s to 1 s.

**S10 (scale) is partially discharged.** Linear behaviour now confirmed to n=50 000 (626 ms entries, 739 ms lists), well past S11's n=10 000 ceiling. S10's snapshot-size and sync-payload questions remain untouched.

**S1 (`seq`) is unaffected** and remains the top blocker. The collision reproduction is unchanged on the new floor (§3.4).

---

## 8. Residual unknowns

1. **The loro mechanism was verified as a black box only.** I confirmed subscriber-gated superlinearity and that the version bump removes it. I did **not** read loro's source, and did **not** re-bisect 1.13.3 → 1.13.4; I tested 1.10.8 and 1.16.1, both safely on their respective sides of the claimed boundary.
2. **git `HEAD` does not contain `da978ec`** (§2). The working copy does, and the dist is built from it, but I did not resolve the jj/git divergence. If someone rebuilds from git `HEAD` rather than the working copy they may not get the fix.
3. **Kyneta's own 2062-test suite was not re-run.** S11 ran it against its patch; I did not re-run it against the landed fix. That is the Kyneta team's CI, not pine·trie's, but it means "the landed fix passes Kyneta's tests" is assumed here, not verified.
4. **`tsc --noEmit` still not run** — inherited from S11 residual #2. The landed code is different code, so S11's caveat does not transfer either way.
5. **`@kyneta/react` and `@kyneta/devtools` still unexercised.** S11 residual #3 flagged object-identity assumptions as the main risk of in-place mutation. The landed fix mutates in place *more* aggressively than S11's patch (set-op and tree too), so this risk is *larger* now, not smaller. Nothing in pine·trie's suites touches those packages.
6. **S5 was not re-run.** It is an LLM-quality spike with no Kyneta dependency; re-running would cost tokens and could not regress from a version bump. Deliberately skipped, not overlooked.
7. **The S3 drive/inference loop is still stubbed** — S3 residual #1 carries over untouched.
8. **Single-writer, in-memory, no persistence, no transport.** Same envelope as every prior spike: no `@kyneta/exchange`, no Line, no store backend.
9. **Machine-specific timings.** All numbers from one machine, unloaded. The ×20 margins are large enough to survive hardware variation, but the absolute budget figures may need a platform allowance in CI.
10. **n=50 000 is the tested ceiling.** Curve is linear to there; beyond is extrapolation.

---

## 9. Verified vs. assumed

**Verified by execution in this sandbox:**
- Resolved package versions in all four configs, read from `node_modules/*/package.json`.
- Stale-marker counts (`deepClonePlain(path.read`) = 1/1 in A and B, 0/0 in C.
- `stepInPlace` present in local dist (`index.js`, `index.d.ts`), absent from npm 3.0.0, and importable as a `function` from the barrel.
- All dist mtimes post-dating `da978ec`, and no `src/*.ts` newer than its dist.
- `git merge-base --is-ancestor da978ec HEAD` → NO.
- S2 21/21 on both memory and kyneta; the 163 ms slow case.
- S7 900/900 with all six entry totals matching published figures exactly; negative control exit=1.
- S8 1000/1000 with all five entry totals matching published; shared control 0/300, exit=1.
- S3 step1 12/12, step7 10/10, step3 seq collisions still reproducing.
- Every timing in §4 and §5, including the full 2×2 factorial and the 5-rep medians to n=50 000.
- The raw loro-crdt subscriber experiment (§4.3), run with zero Kyneta imports.
- The `undefined` element behaviour difference between npm and local builds.
- That nothing outside the s14 sandbox was modified.

**Assumed, not verified:**
- That the loro fix is *specifically* an O(keys²) event build, and that the boundary is exactly 1.13.3/1.13.4 — the commit message says so and the black-box behaviour is consistent, but neither was independently checked.
- That the local dist is a faithful build of the current working-copy source (inferred from mtimes and marker strings, not from rebuilding — building Kyneta was prohibited).
- That the landed fix passes Kyneta's own 2062-test suite (not re-run here).
- That config D's n=8 000 → n=10 000 extrapolation (~1.8 s) is accurate; I measured D only on the doubling series, not at 10 000.
- That `@kyneta/changefeed` and `@kyneta/random` were unaffected by `da978ec` — they were overlaid for consistency, but their dists were not diffed against npm.

## Review

**Verdict:** NOTHING REGRESSED

A 2×2 factorial (kyneta npm/local ×
loro 1.10.8/1.16.1) — the agent added config D itself, correctly noting the
factorial was incomplete without it and that S13 could not otherwise be answered.

- **Correctness invariant across all four configs.** S2 21/21; S7 900/900; S8
  1000/1000; S3 step1 12/12, step7 10/10. **Every entry total byte-identical to
  published figures** — behaviour unperturbed, not merely "still passing." Both
  negative controls still fail as designed.
- **Performance, pine·trie shape n=10 000:** entries **38 444 → 93 ms (413×)**,
  lists **12 731 → 92 ms (138×)**. Linear to **n=50 000**. Independently
  re-verified at n=8 000: entries `26 234 → 75 ms`, ×4.54 → ×1.75.
- **The factorial is the interesting part.** Lists need only the Kyneta fix
  (loro version irrelevant). **Maps need BOTH**: Kyneta alone takes 24 316 →
  1 159 ms but leaves ×3.77; the loro bump then takes it to 67 ms and ×1.83.
  **The loro fix alone buys ~4%** — the Kyneta defects mask it entirely.
- **S10 partially discharged** — linearity confirmed to n=50 000. Snapshot-size
  and sync-payload questions remain.
- **Flagged for you:** `da978ec` is **not an ancestor of git `HEAD`** in the
  colocated repo (`HEAD` = `c84a5ca`, a datalog line). The *working copy* carries
  the fix and the dist is built from it, but anyone rebuilding from git `HEAD`
  would not get it. A jj/git bookkeeping question, not a code one.
