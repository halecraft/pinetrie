# S11 — Why are `@kyneta/schema` writes quadratic?

## 1. VERDICT

**DEFECT, not inherent — and there are two independent defects, both fixed.** Cause A is a redundant deep clone that **is already fixed in Kyneta's `main` source but is still present in the published 3.0.0 dist**; cause B is `step`'s pure-arrow container rebuild, fixed here with an in-place fast path that passes Kyneta's own 2062-test suite unchanged. On the real Pineta shape at n=10 000, list append goes **13 106 ms → 185 ms (71×)** and entry writes **41 270 ms → 1 904 ms (22×)**. **The kill criterion is not met: Pineta does not need per-entry document granularity on account of write throughput.**

---

## 2. What I ran

Sandbox: `sandbox/s11-perf`. Nothing outside it was modified. `~/halecraft/kyneta`, `~/.pi`, the pi install and the sibling sandboxes were read-only (files were copied *out* of `s2-storage`/`s7-convergence`, never written to).

### Dependencies (exact pins)

```
@kyneta/schema      3.0.0
@kyneta/loro-schema 3.0.0
loro-crdt           1.10.8      (Kyneta's pnpm-lock version, not npm latest)
```

Node v24.19.0.

### Files

| File | Purpose |
|---|---|
| `repro-basic.mjs` | copy of S2's `perf-basic.mjs` — quick confirmation |
| `prof-target.mjs`, `prof-map.mjs`, `prof-loromap.mjs` | minimal `--cpu-prof` targets |
| `analyze.mjs` | folds a `.cpuprofile` into self-time per function |
| `probe-ops.mjs` | dumps the actual change instructions a `push` / `set` emits |
| `bench.mjs`, `bench-loro.mjs` | before/after curves, plain + Loro substrates |
| `bench-shapes.mjs` | `record(any)` vs `record(struct.json)` vs `record(struct)` |
| `bench-pineta.mjs` | the real shape from `01-architecture.md`, to n=10 000 |
| `patchB.py`, `apply-patches.sh`, `restore-pristine.sh` | toggle the fixes in `node_modules` |
| `fixB-reader.patch` | **the deliverable** — unified diff against Kyneta source |
| `srctest/` | copy of `packages/schema/src` + vitest, to run Kyneta's own suite |
| `verify/` | copies of S7's and S2's suites, run against the patched build |

### Commands

```bash
cd ./sandbox/s11-perf
npm install --no-audit --no-fund

./restore-pristine.sh && node bench-loro.mjs before      # baseline
./apply-patches.sh    && node bench-loro.mjs after       # both fixes
node bench-pineta.mjs patched

node --cpu-prof --cpu-prof-dir=prof  prof-target.mjs 4000 && node analyze.mjs prof
node --cpu-prof --cpu-prof-dir=prof3 prof-map.mjs    4000 && node analyze.mjs prof3

cd srctest && npx vitest run --reporter=dot             # Kyneta's own 2062 tests
cd ../verify && node run-conformance.mjs kyneta          # S2's suite, patched build
                node convergence.property.mjs 200 12648430   # S7's fitness fn
```

---

## 3. Evidence

### 3.1 Confirmation of the S2 reproduction

```
=== plain-JS substrate (@kyneta/schema/basic) ===
  basic: one batch of 1000                        137ms
  basic: one batch of 2000                        493ms
  basic: one batch of 4000                       1944ms
  basic: one batch of 8000                       7586ms
```

Matches S2 §3.4 (138/493/1944/7586 vs its 136/503/1934/7631). Reproduction confirmed; not re-derived further.

### 3.2 Profiling — and why the first profile was misleading

`node --cpu-prof` on the plain substrate, n=4000:

```
total sampled: 1982ms  (1587 samples)

SELF TIME    %   function @ file:line
  1840.0ms  92.8%  prepare  @ @kyneta/schema/dist/_shared/sync.js:4830
    25.1ms   1.3%  structuredClone  @ node:internal/worker/js_transferable:113
    20.0ms   1.0%  (garbage collector)
    17.5ms   0.9%  step  @ .../sync.js:4248
    10.0ms   0.5%  stepSequence  @ .../sync.js:4006
     9.2ms   0.5%  deepClonePlain  @ .../sync.js:3293
```

92.8% self-time in one function, with every callee near zero — and `applyChange` absent entirely. I suspected inlining and re-ran with `--no-turbo-inlining`; the shape was unchanged (93.0% in `prepare`). **I stopped trusting the attribution at that point and read the code instead**, then confirmed by bisection (§3.4). This is worth recording: on this bundled ESM build V8's self-time attribution collapses callees into `prepare`, so the profile localised the *statement group* correctly but named the wrong function.

The second profile, after fix A, was unambiguous (§3.5).

### 3.3 Cause A — a redundant deep clone, **already fixed upstream but not published**

The published dist, `node_modules/@kyneta/schema/dist/_shared/sync.js:4831-4833`:

```js
const record = options?.[RECORD_INVERSE];
if (record && !options?.compensating && !options?.replay) record(path, invert(deepClonePlain(path.read(doc)), change));
applyChange(doc, path, change);
```

`path.read(doc)` for a list append resolves to **the whole array**; for a `record.set`, **the whole map**. `deepClonePlain` then copies all of it — on every single write. That is O(n) per op ⇒ O(n²) per batch.

The current source at `packages/schema/src/substrates/plain.ts:304-314` no longer does this:

```ts
)?.[RECORD_INVERSE]
if (record && !options?.compensating && !options?.replay) {
  // Read, don't copy. `invert` snapshots whatever it retains — see
  // `invertReplace`, `invertMap`, `invertSequence` and the rich-text
  // marks in `inverse.ts`, each of which deep-clones the pre-state it
  // captures. Copying here as well protected nothing and cost a deep
  // clone of the written subtree on every local write.
  const pre = path.read(doc)
  const inverse = invert(pre, change)
  record(path, inverse)
}
```

`jj log` on that file:

```
960f52e refactor(schema): typed guards for the six symbol protocols
a5e2c8f perf(schema): remove the redundant inverse pre-state clone      <-- the fix
d40715f fix(schema)!: snapshot replace payloads before they enter the store
```

**The same stale pattern is in the Loro backend's published dist** (`@kyneta/loro-schema/dist/index.js:1121`), which keeps a *shadow* plain document and clones it identically — this is why S2 measured near-identical curves for both substrates:

```js
if (record && !options?.compensating) record(path, invert(deepClonePlain(path.read(shadow)), change));
applyChange(shadow, path, change);
```

Its source (`packages/schema/backends/loro/src/substrate.ts:382-391`) is likewise already fixed, carrying the same "Read, don't copy" comment. `grep -rn deepClonePlain` over the Loro backend source returns nothing.

> **So cause A needs no new code. It needs a republish of `@kyneta/schema` and `@kyneta/loro-schema`.** Every measurement in S2 §3.4 was taken against a dist that is behind `main`.

### 3.4 Cause B — `step` rebuilds the whole container per op

With cause A removed, list append becomes near-linear but `record.set` stays quadratic:

```
=== AFTER fix A only (plain core) ===
-- list append --                    -- record set --
  n= 1000       13ms                   n= 1000       71ms
  n= 2000       26ms   x1.96           n= 2000      276ms   x3.89
  n= 4000       67ms   x2.53           n= 4000     1269ms   x4.60
  n= 8000      173ms   x2.59           n= 8000     5584ms   x4.40
```

Re-profiling the map case gives clean attribution:

```
total sampled: 1346ms  (1076 samples)
  1246.2ms  92.6%  stepMap  @ @kyneta/schema/dist/_shared/sync.js:4036
```

`packages/schema/src/step.ts:131-135`:

```ts
export function stepMap<T extends Record<string, unknown>>(
  state: T,
  action: MapChange,
): T {
  const result = { ...(state ?? ({} as T)) }     // ← full copy, every set
```

`stepSequence` (`step.ts:80-114`) is the same story for arrays: it walks every `retain` item into a fresh `result` array. The residual `x2.5` superlinearity in the list column above is exactly this.

`applyChange` (`src/reader.ts:304`) is what forces it:

```ts
const current = path.read(state)
const next = step(current, change)
writeByPath(state, path, next)
```

And the emitted changes confirm the full-container touch (`probe-ops.mjs`):

```
-- push --
{"type":"sequence","instructions":[{"retain":3},{"insert":[{"x":1}]}]}
-- map set --
{"type":"map","set":{"a":{"y":2}}}
```

`retain: 3` is the current length — so `stepSequence` copies all n retained items per push.

**Mechanism in plain terms:** `step` is a *pure arrow* `σ' = step(σ, δ)`. Purity is right for the algebra, but `applyChange` materialises it by rebuilding the entire container and writing the new object back. k writes into a container of size n therefore cost O(n·k); for a batch filling a container, O(n²).

**Why this is a DEFECT and not INHERENT.** The algebra requires `step` to be pure; it does *not* require the substrate to materialise every intermediate state. Three facts make in-place mutation observationally equivalent here:

1. The substrate owns the document. `plainReader`'s contract in `src/reader.ts` states: *"**Liveness invariant:** The returned reader is a live view — mutations to the state via `applyChange` are immediately visible through the reader. The reader and the mutator share the same backing object."* Callers already cannot rely on container identity being stable across a write.
2. The inverse is computed **before** the mutation — `prepare()` calls `invert(pre, change)` and only then `applyChange`.
3. The inverse snapshots what it retains. `invertMap` (`inverse.ts:165-191`) `deepClonePlain`s each touched key's pre-value — O(keys changed), not O(n). `invertSequence` (`inverse.ts:125-149`) clones only `delete`d segments; a pure append produces `{retain}`/`{delete}` instructions and clones nothing.

So nothing downstream holds the pre-state by reference expecting immutability.

### 3.5 The fix, and the new curve

`fixB-reader.patch` (full diff in §3.6) adds two in-place fast paths to `applyChange`: map set/delete, and pure append. Anything else falls through to the existing `step` + `writeByPath` path.

```
=== AFTER fix A + fix B (plain core) ===
-- list append --                    -- record set --
  n= 1000       12ms                   n= 1000       10ms
  n= 2000       20ms   x1.60           n= 2000       18ms   x1.81
  n= 4000       35ms   x1.80           n= 4000       33ms   x1.87
  n= 8000       69ms   x1.95           n= 8000       67ms   x2.03
```

Both columns are now linear (x2.0 per doubling). Against the published baseline at n=8000: list **7642 → 69 ms (111×)**, map **17 617 → 67 ms (263×)**.

Loro substrate, same fixes:

```
=== @kyneta/loro-schema ===
                 BEFORE (3.0.0)        AFTER (A+B)
-- list append --
  n= 1000          157ms                 32ms
  n= 2000          531ms  x3.38          45ms  x1.41
  n= 4000         1991ms  x3.75          79ms  x1.74
  n= 8000         7766ms  x3.90         144ms  x1.83
-- record set --
  n= 1000          208ms                 32ms
  n= 2000          919ms  x4.42          96ms  x2.97
  n= 4000         4239ms  x4.61         325ms  x3.39
  n= 8000        18983ms  x4.48        1177ms  x3.62
-- RAW loro-crdt control (unchanged) --
  n= 8000           12ms  x2.02
```

### 3.6 The patch

Against `packages/schema/src/reader.ts` (Kyneta `main`). Also at `sandbox/s11-perf/fixB-reader.patch`.

```diff
--- src/reader.ts.orig
+++ src/reader.ts
@@ -5,7 +5,7 @@
-import type { ChangeBase, ReplaceChange } from "./change.js"
+import type { ChangeBase, MapChange, ReplaceChange, SequenceChange } from "./change.js"
 import { deepClonePlain } from "./clone.js"
 import { isNonNullObject } from "./guards.js"
 import type { Path } from "./path.js"
@@ -324,6 +324,59 @@
     return
   }
   const current = path.read(state)
+
+  // In-place fast paths. `step` is a pure arrow (σ' = step(σ, δ)) and
+  // therefore rebuilds the WHOLE container on every op, so k writes into a
+  // container of size n cost O(n·k). The substrate owns this plain document
+  // and `plainReader` is a documented live view, and `prepare()` computes the
+  // inverse from σ *before* calling `applyChange`, so mutating the existing
+  // container is observationally equivalent to replacing it.
+  if (
+    change.type === "map" &&
+    isNonNullObject(current) &&
+    !Array.isArray(current)
+  ) {
+    const target = current as Record<string, unknown>
+    const mapChange = change as MapChange
+    if (mapChange.delete) {
+      for (const key of mapChange.delete) delete target[key]
+    }
+    if (mapChange.set) {
+      for (const [key, value] of Object.entries(mapChange.set)) {
+        target[key] = value
+      }
+    }
+    return
+  }
+
+  if (change.type === "sequence" && Array.isArray(current)) {
+    const instructions = (change as SequenceChange<unknown>).instructions
+    const first = instructions[0]
+    const second = instructions[1]
+    // A pure append is `[{ retain: len }, { insert: [...] }]`, or a lone
+    // `{ insert }` into an empty array. Anything else falls through.
+    const tail =
+      instructions.length === 2 &&
+      first &&
+      second &&
+      "retain" in first &&
+      "insert" in second &&
+      first.retain === current.length
+        ? second.insert
+        : instructions.length === 1 &&
+            first &&
+            "insert" in first &&
+            current.length === 0
+          ? first.insert
+          : null
+    // `stepSequence` drops `undefined` items; keep the slow path for those so
+    // the fast path can never change observable contents.
+    if (tail !== null && !tail.some(item => item === undefined)) {
+      for (const item of tail) (current as unknown[]).push(item)
+      return
+    }
+  }
+
   const next = step(current, change)
   writeByPath(state, path, next)
 }
```

### 3.7 Correctness verification

**Kyneta's own suite** — `packages/schema/src` copied to `srctest/`, vitest 3.2.4, `@kyneta/schema` aliased to the local source:

```
baseline (unpatched source):   Test Files  84 passed (84)   Tests  2062 passed (2062)
patched  (fix B applied):      Test Files  84 passed (84)   Tests  2062 passed (2062)
```

**S2's conformance suite, run against the patched build** (`verify/`):

```
=== Storage conformance: memory ===   TOTAL: 21/21 passed, 0 failed
=== Storage conformance: kyneta ===   TOTAL: 21/21 passed, 0 failed
```

The suite's own slow case improves as a side effect — S2 recorded it at 12 198 ms:

```
PASS  clamps one read page without limiting list growth  (267ms)
```

**S7's convergence property, run against the patched build:**

```
convergence property: 200/200 trials passed (seed=12648430, up to 4 peers, 3347 entries total)
convergence property: 100/100 trials passed (seed=42, up to 4 peers, 1748 entries total)
convergence property: 100/100 trials passed (seed=2026, up to 4 peers, 1623 entries total)
```

Entry totals are **identical** to those in the S7 report for the same seeds (3347, 1748), i.e. the patch did not perturb behaviour. The negative control still fails as designed:

```
TRIAL 0 FAILED (seed=42): entry t0-collide-1 parent t0-collide-2 !== t0-collide-1  peers=3 ops=23
```

**Not verified: `tsc --noEmit`.** It OOM'd (4 GB heap) on my ad-hoc tsconfig — the schema type algebra is deeply recursive and I did not reproduce the package's real build config. vitest transpiles without typechecking, so the two `as` casts in the patch are **type-unverified**. This should be checked in Kyneta's own build before the patch is accepted.

### 3.8 The real Pineta shape

`Schema.record(Schema.struct.json({id,parentId,type,text}))` for entries plus `Schema.record(Schema.list(Schema.any()))` for `pi.pending.assistant_frame`, on the Loro substrate:

```
                        pristine 3.0.0      patched (A+B)     speedup
entries record.set
  n= 1 000                    331ms               50ms          6.6x
  n= 5 000                   9420ms              520ms         18.1x
  n=10 000                  41270ms             1904ms         21.7x
pending list append
  n= 1 000                    231ms               27ms          8.6x
  n= 5 000                   3299ms              101ms         32.7x
  n=10 000                  13106ms              185ms         70.8x
```

Filling a 10 000-entry session went from **41 seconds to 1.9 seconds**; a 10 000-frame pending list from **13.1 s to 0.19 s**.

### 3.9 A third, separate cause — in Loro's wasm, not Kyneta

After both fixes the Loro `record.set` column is still superlinear (x3.6 per doubling; the entries row above shows x3.66 for 2× n). Profiling it puts the cost in wasm, not JS:

```
total sampled: 398ms  (321 samples)
   141.3ms  35.5%  wasm-function[1744]  @ wasm://wasm/00c501de:1
    49.0ms  12.3%  wasm-function[1980]  @ wasm://wasm/00c501de:1
    48.6ms  12.2%  wasm-function[4133]  @ wasm://wasm/00c501de:1
```

It is **not** the opaque-JSON-boundary path — all three candidate shapes behave the same:

```
-- record(any) --          n=8000  1232ms  x3.61
-- record(struct.json) --  n=8000  1189ms  x3.50
-- record(struct) --       n=8000  1539ms  x3.50
```

Raw `loro-crdt` map-set is linear (`raw loro map set x4000 → 7ms`), so this is something the Kyneta→Loro binding does per key, not a `LoroMap` limitation. **I did not root-cause it** (see §5). It is roughly 20× smaller than the two defects fixed here and does not threaten the kill criterion, but it is the next thing to look at if 10k-entry bulk writes need to get below ~2 s.

---

## 4. Consequences

**Kill criterion NOT met.** The quadratic cost is two implementation defects, not a property of the schema algebra. **Pineta does not need per-entry document granularity for write-throughput reasons**, and the production adapter can be built on the shape S7 settled (`Schema.record(Schema.struct.json({...}))`). Note this only discharges the *write-throughput* half of the granularity question — S10's snapshot-size and sync-payload concerns are untouched.

**`01-architecture.md` § Risks — the row `**@kyneta/schema writes are O(n²)**` should be downgraded**, with the caveat that it is only fixed once the packages are republished. Suggested replacement: *"Fixed. Cause A already on `main` (a5e2c8f) but unpublished; cause B has a candidate patch (S11). Residual: Loro map-write path ~x3.5 per doubling, unexplained."*

**Confirms ADR-0002/ADR-0003 indirectly.** The S2 adapter is unchanged and still 21/21; the slowest conformance case dropped 46×.

**Does not touch ADR-0009.** S7's convergence property is byte-identical on the patched build, entry counts included.

**Action item that is not a spike: republish.** `@kyneta/schema` and `@kyneta/loro-schema` 3.0.0 ship a dist that predates `a5e2c8f`. Anyone measuring Kyneta from npm today is measuring code that `main` has already fixed. Worth checking whether other published `@kyneta/*` packages are similarly stale — I only examined these two.

**Spawns S12 (suggested):** root-cause the residual x3.5 superlinearity in the Loro backend's map-write path (§3.9). Size S–M, not urgent.

**Feeds the roadmap's fitness functions.** `04-roadmap.md` already calls for a write-throughput budget. Concrete numbers now exist: on the Pineta shape, **10 000 entry writes ≤ ~2 s and 10 000 list appends ≤ ~0.25 s** on the patched build. Pin the budget just above these so a regression (e.g. an unpatched republish) trips it.

---

## 5. Residual unknowns (NOT resolved)

1. **The wasm-side superlinearity in the Loro map path** (§3.9). Localised to wasm and shown shape-independent, not traced to a binding call. This is now the dominant remaining cost for entry writes.
2. **Typecheck of the patch** — `tsc --noEmit` OOM'd; the two `as` casts are unverified by the compiler (§3.7).
3. **Whether the in-place fast path is safe for every consumer.** 2062 Kyneta tests + 21 conformance cases + 400 convergence trials pass, but I did not audit every reader of a container for an identity assumption (e.g. a memoiser keyed on object identity, or React-style referential-equality change detection). The `@kyneta/react` and `@kyneta/devtools` packages were **not** exercised at all.
4. **Sequence fast path covers only pure append.** Inserts in the middle, deletes, and moves still take the O(n) `step` path. That is correct but unoptimised; a MovableList-heavy workload would not benefit.
5. **`undefined` items.** The fast path deliberately defers to `step` when an inserted item is `undefined`, because `stepSequence` silently drops them. I did not test whether any real workload inserts `undefined`.
6. **Ephemeral / state-tree substrates** (`substrates/ephemeral.ts`, `state-tree.ts`) were not benchmarked. They may share `applyChange` and benefit, or have their own paths.
7. **Memory.** I measured time only. The clone removal should reduce allocation churn substantially, but I did not measure heap or GC pressure.
8. **Scale beyond 10 000** and concurrent/multi-peer write throughput were not measured. All benchmarks are single-writer, in-memory, no persistence, n≤10 000.
9. **Whether `a5e2c8f` has other unpublished siblings.** I checked `plain.ts` and the Loro `substrate.ts` only; other source/dist divergences in these packages are unexamined.

---

## 6. Verified vs. assumed

**Verified by execution:**
- The S2 reproduction (§3.1), and every before/after timing in §3.4, §3.5, §3.8 — all run in this sandbox on pinned 3.0.0 / loro-crdt 1.10.8.
- The published dist contains `deepClonePlain(path.read(doc))` and the source does not — both quoted verbatim from the files at the cited line numbers, plus the `jj log` line for `a5e2c8f`.
- The same stale pattern in `@kyneta/loro-schema/dist/index.js:1121`, and its absence from the Loro backend source (`grep -rn deepClonePlain` → no matches).
- The change instructions a `push`/`set` emit (`probe-ops.mjs` output, §3.4).
- `stepMap` at 92.6% self-time after fix A.
- 2062/2062 Kyneta tests on both unpatched and patched source; 21/21 conformance; 400 convergence trials across three seeds with entry counts matching S7's published figures; negative control still failing.
- That the residual Loro cost is in wasm frames and is shape-independent.

**Assumed, not verified:**
- That in-place mutation is safe for *all* consumers — argued from the documented liveness invariant and the ordering of `invert` before `applyChange`, and supported by three test suites, but not proven by audit (residual #3).
- That the profiler's collapse of callees into `prepare` (§3.2) is V8 inlining. I worked around it rather than confirming the cause; the conclusion rests on code reading plus the bisection in §3.4/§3.5, not on that profile.
- That republishing is sufficient for cause A — I verified the *source* is fixed, but did not build the packages from source and re-measure. The patched-dist measurements are a proxy for that.
- That `x2.0` per doubling constitutes linearity over the measured range (1k–8k). Confirmed to 10 000 on the Pineta shape for lists (x1.84), not beyond.
