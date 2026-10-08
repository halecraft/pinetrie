# S2 — Does a minimal `KynetaStorage` pass pi's conformance suite?

- **Status:** Answered
- **Led to:** ADR-0003, ADR-0011, ADR-0013, ADR-0014

Confirmed ADR-0003; spawned S11.

## Brief

**Size:** M · **Depends on:** nothing

**Question.** Can `Storage`'s 10 methods be satisfied over a Kyneta/Loro
document? Single-writer, in-memory is fine for this spike.

**Method.** Stub `KynetaStorage`, point
`pi-agent-core/harness/session/testing/conformance/storage.js` at it, count
failures and classify them.

**Kill criterion.** Binary. Systematic failure ⇒ ADR-0003 is wrong and the plan
changes shape.

**Throw away.** The implementation. Keep the failure taxonomy — it *is* the
implementation plan.

## 1. Verdict

**PASS (21/21), with one serious non-contractual finding: `@kyneta/schema` write
throughput is quadratic in container size — ~650× slower than raw `loro-crdt` at
n=8000.** The kill criterion was structural failure of the `Storage` contract;
no such failure occurred. **ADR-0003 is confirmed.**

---

## 2. What was run

All work in `sandbox/s2-storage`. Nothing outside it was
modified; `~/.pi`, `~/halecraft/kyneta` and the pi install were read-only.

### Dependencies (exact pins, from npm)

```
@kyneta/schema      3.0.0
@kyneta/loro-schema 3.0.0
loro-crdt           1.10.8
```

### Files

| File | Purpose |
|---|---|
| `kyneta-storage.mjs` | `KynetaStorage` — the `Storage` port over a Kyneta/Loro doc |
| `run-conformance.mjs` | Runs pi's suite against `kyneta` or `memory` (control) |
| `perf.mjs` | Where the time goes: writes vs reads, per shape |
| `perf-attribute.mjs` | Batch-size vs doc-size; Kyneta vs raw `loro-crdt` |
| `perf-basic.mjs` | Localises the cost to core vs the Loro binding |
| `roundtrip.mjs` | Proves the doc is genuinely the source of truth |
| `probe.mjs`, `smoke.mjs` | Harness discovery / API smoke |

### Commands

```bash
cd ./sandbox/s2-storage
npm install --no-audit --no-fund
node run-conformance.mjs memory    # control baseline
node run-conformance.mjs kyneta    # the spike
node perf.mjs ; node perf-attribute.mjs ; node perf-basic.mjs ; node roundtrip.mjs
```

### How the suite is invoked

Verified, not assumed. The suite is runner-independent:

```ts
createStorageConformance(factory: () => Promise<StorageFixture>): readonly ConformanceCase[]
// StorageFixture = { readonly storage: Storage } & AsyncDisposable
// ConformanceCase = { group, name, run(): Promise<void> }
```

It uses `node:assert/strict` internally and is framework-agnostic — no vitest/jest
needed. It ships **21 cases** across 8 groups. pi modules were imported by
absolute path; their internal bare imports resolve from their own `node_modules`,
so no vendoring was required.

---

## 3. Evidence

### 3.1 Control — `MemoryStorage` (pi's own implementation)

```
=== Storage conformance: memory ===
  TOTAL: 21/21 passed, 0 failed
```

Establishes the harness is wired correctly.

### 3.2 `KynetaStorage`

```
=== Storage conformance: kyneta ===

  [transactions]
    PASS  commits mixed writes atomically in write order  (12ms)
    PASS  rolls back every store when a mixed transaction fails  (2ms)
    PASS  preserves overwritten and deleted values when a transaction fails  (1ms)
    PASS  enforces one shared entry and usage id namespace  (1ms)
    PASS  resolves parents only from prior entries and earlier writes  (2ms)
    PASS  places pending content under its reserved entry id  (1ms)
  [values]
    PASS  sets, replaces, deletes, and recreates values without tombstones  (1ms)
    PASS  applies same-transaction value and list operations in write order  (3ms)
    PASS  does not change historical stores during value-only commits  (1ms)
  [lists]
    PASS  pages appends by global sequence and deletes whole lists  (2ms)
    PASS  clamps one read page without limiting list growth  (12198ms)   <-- see §3.4
    PASS  commits mixed list writes atomically and rolls them back with siblings  (1ms)
  [entry queries]
    PASS  stores custom entries with and without data  (0ms)
    PASS  scans global entries with explicit ranges, filters, orders, and limits  (1ms)
  [branch queries]
    PASS  applies stops before filters and cursors before limits  (1ms)
    PASS  returns branch structure without payload fields  (0ms)
    PASS  applies branch query semantics to structure scans  (1ms)
  [usage and stats]
    PASS  scans the usage ledger with explicit ranges, orders, and limits  (1ms)
    PASS  keeps stats equal to message count and ledger totals  (1ms)
  [serialization]
    PASS  serializes back-to-back commits in admission order  (1ms)
  [lifecycle]
    PASS  seals admission, drains admitted commits, and closes idempotently  (0ms)

  TOTAL: 21/21 passed, 0 failed
```

Stable: 21/21 on three consecutive runs. **Passed on the first execution** — no
contract-shape iteration was needed.

### 3.3 The Loro doc is genuinely the source of truth

This is load-bearing for ADR-0002, so it was verified rather than asserted. The
implementation keeps **no shadow index** — every read materialises from the doc
(`doc.entries()`, `doc.values.get(k)`, `doc.lists.at(k)()`, `doc.meta.get(...)`).
`roundtrip.mjs` exports the doc to bytes, rehydrates a *fresh replica*, and
re-reads:

```
exported bytes: 731            (Loro binary snapshot; magic bytes "loro")
round-trip: OK — all five namespaces identical after export→import
value physical keys survived: ["pi.branch.tip\u0000main","test.value\u0000prefix/","test.value\u0000prefix/𐀀"]
list physical keys survived:  ["pi.pending.assistant_frame\u0000op:ent"]
branchTip via reimported doc:  kid
```

Notably `\u0000` separators in physical keys and astral-plane characters
(`U+10000`) survive Loro map keys intact.

### 3.4 The performance finding — writes are quadratic

`perf.mjs`: **reads are fast; writes are not.**

```
=== list append scaling (one commit, N appends) ===
  commit 1000 appends                                164ms
    readList (materialise 1000)                        6ms
  commit 5000 appends                               3194ms
    readList (materialise 5000)                       13ms
  commit 10001 appends                             12270ms
    readList (materialise 10001)                      42ms

=== append in SEPARATE commits (realistic streaming shape) ===
  1000 separate 1-append commits                     247ms

=== entry scaling ===
  commit 1000 entries                                675ms
    scanEntries (materialise all 1000)                 3ms
    getEntries([one])                                  0ms
    scanBranch from tip (walk 1000)                    1ms
  commit 5000 entries                              18977ms
    scanEntries (materialise all 5000)                16ms
    scanBranch from tip (walk 5000)                    3ms

=== value scaling ===
  commit 5000 setValue                             11959ms
    getValue(one)                                      0ms
    scanValues (materialise 5000)                     19ms
```

`perf-attribute.mjs` isolates the cause. **It is not batch size, and it is not
Loro:**

```
-- all in ONE batch --              -- same totals, batches of 100 --
  one batch of 1000     158ms         1000 total, chunks of 100     141ms
  one batch of 2000     533ms         2000 total, chunks of 100     523ms
  one batch of 4000    2020ms         4000 total, chunks of 100    1998ms
  one batch of 8000    7783ms         8000 total, chunks of 100    7806ms

=== RAW loro-crdt, same shapes ===
  raw loro list push x1000     2ms
  raw loro list push x2000     3ms
  raw loro list push x4000     6ms
  raw loro list push x8000    12ms
  raw loro map set   x4000     7ms
```

- Kyneta: 158 → 533 → 2020 → 7783 — **~4× per doubling ⇒ O(n²)**
- Raw Loro: 2 → 3 → 6 → 12 — **~2× per doubling ⇒ O(n)**
- At n=8000: **7783ms vs 12ms ≈ 650×**
- Chunking into 100-write batches changes nothing ⇒ cost is **quadratic in
  container size**, not batch size.
- Hoisting the `.at()` navigation out of the loop changes nothing (7661ms).

`perf-basic.mjs` localises it further — the plain-JS substrate shows the *same*
curve, so this is **`@kyneta/schema` core, not the Loro binding**:

```
=== plain-JS substrate (@kyneta/schema/basic) ===
  basic: one batch of 1000    136ms
  basic: one batch of 2000    503ms
  basic: one batch of 4000   1934ms
  basic: one batch of 8000   7631ms
```

---

## 4. Failure taxonomy

The requested deliverable. **There were no conformance failures**, so the
taxonomy instead records what the contract *demanded* and how each demand was
met — these are the real implementation constraints for the production adapter.

| # | Contract demand | How met in the spike | Production risk |
|---|---|---|---|
| T1 | **Dense, strictly-increasing global `seq`** across all four op kinds | `meta.nextSeq` counter in the doc | **The centralized sequencer.** Explicitly allowed for S2; this is S1's problem |
| T2 | **Atomic commit / no partial apply** | Validate *before* the `batch()`; every rejection the suite exercises is validation-time, so "atomic" = "never started" | Holds only while all rejections are pre-computable. A substrate-level write failure mid-`batch()` would need real rollback — untested |
| T3 | **Shared id namespace** for entries + usage | `validateCommittedWrites` with `hasEntryOrUsageId` reading both records | None — pi supplies the validator |
| T4 | **Parent resolution** from prior entries *and earlier writes in the same txn*, order-sensitive | pi's validator handles it | None |
| T5 | **Synchronous admission ordering** (`commit()` must be admitted before a later `close()`, and commit *N+1* may depend on commit *N*) | Sync state check + promise-chain queue, mirroring `MemoryStorage` | **This is a single-writer mutex by construction.** Directly relevant to S3 |
| T6 | **`scanValues` ordered by Unicode code point** (not UTF-16 code unit) | Ported pi's `compareKeys` | Subtle; astral keys sort *after* `U+E000`. Easy to get wrong |
| T7 | **List cursors are `{seq}` ints** with asc/desc and a 10 000 clamp | `resolveListReadOptions` reused verbatim from pi | **Will break under CRDT list semantics.** Named in 01-architecture as the "API-visible break" |
| T8 | **`EntryScan{fromSeq,toSeq}` range scans** | Materialise all entries, sort by `seq`, filter | Works, but O(n) per read. Confirms S1's concern that range scans need more than comparability |
| T9 | **Durable aggregates** (`stats` exact after every commit, incl. optional `cacheWrite1h`/`reasoning`) | `meta.messageCount` + `meta.usage`, updated in-commit via pi's `addUsage` | None — matches what `InMemoryStorageState` docs prescribe for DB backends |
| T10 | **Lifecycle**: close seals admission, drains admitted, is idempotent, and *all* reads reject after | State machine copied from `MemoryStorage` | None |
| T11 | **Exact deep-equality round-trip of entry payloads** (nested arrays, absent optional keys) | `Schema.any()` | Passed. `undefined`-valued keys are never written, so no `undefined`→`null` coercion was exercised |

### Reusable machinery discovered

pi supplies more than the interface. These were imported and used directly,
which is why the spike passed first try and why the adapter is small:

- `prepareStorageCommit(writes, firstSeq, timestamp)` — assigns `seq`/`timestamp`
- `validateCommittedWrites(writes, firstSeq, state)` — id + parent validation
- `resolveListReadOptions(options)` — limit defaults (1 000) / clamp (10 000) / rejects
- `value()`, `list()` — address construction
- `addUsage()`, `emptyUsage()` — exact stats arithmetic
- `MemoryStorage` — a working reference for the queue/close state machine

`InMemoryStorageState`'s own docstring sanctions the approach taken here:
*"unsuitable for database backends… Those backends should query indexed durable
state and update durable aggregates within each commit transaction."*

---

## 5. Consequences for the plan

**ADR-0003 (implement the `Storage` port) — CONFIRMED.** All 21 cases pass with
a Loro document as the sole source of truth. The adapter is ~290 lines, of which
roughly half is query semantics ported from `InMemoryStorageState`. Third-party
backends are a genuinely supported extension point.

**ADR-0002 (Kyneta as storage of record) — SUPPORTED.** §3.3 shows a complete
session export/import into a fresh replica with byte-level fidelity, including
`\u0000`-separated and astral-plane keys.

**S1 (dissolving `seq`) — scope sharpened.** T1/T7/T8 are now concrete: the dense
counter is reachable but load-bearing in three distinct places. §3.4 also removes
one worry — materialising a container is cheap (42ms for 10 001 elements), so a
**derived local index** for range scans is affordable.

**S3 (harness tolerance of foreign writes) — a hard constraint identified.** T5:
the admission queue is a single-writer mutex *required by the contract*, not an
implementation choice. The suite mandates that commit *N+1* may reference an
entry created by commit *N*, and that commits serialize in admission order. Any
multi-writer design must either keep that mutex per-replica (and converge
underneath) or renegotiate the contract.

**NEW — a roadmap risk that did not previously exist.** §3.4 is a Kyneta-side
finding, in `@kyneta/schema` core, independent of substrate and of pi. Current
behaviour rules out large single-container writes. In pine·trie's shape a session's
entry record and `pi.pending.assistant_frame` lists are exactly the containers
that grow without bound. Mitigating facts: the realistic streaming shape (1 000
separate single-append commits = 247ms ≈ 0.25ms/commit) is fine today, and the
code is first-party and fixable. This belongs on the roadmap's invariant list as
a **performance fitness function** (e.g. "10 000 appends stay under N seconds")
before it is designed around.

---

## 6. Residual unknowns (NOT resolved)

1. **Root cause of the quadratic write cost.** Localised to `@kyneta/schema` core
   and shown substrate-independent, but not traced to a function. Changefeed
   materialisation or per-op path/address work are the obvious suspects — unverified.
2. **Whether `seq` can actually be dissolved.** Untouched by design; this spike
   used a dense counter, as permitted. **S1 owns this.**
3. **True atomicity under substrate failure.** All conformance rejections are
   validation-time, so no rollback path was exercised. If a `batch()` can fail
   part-way in Loro, T2 is unproven.
4. **Concurrency / convergence.** Entirely out of scope here — single writer, one
   replica. **S7 owns divergent-branch convergence; S3 owns harness tolerance.**
5. **Real harness integration.** The suite was driven directly. `KynetaStorage`
   has never been handed to `StorageBackedSession` or an `AgentHarness`, so
   integration-level assumptions (caching, `SessionMutation` barrier interaction,
   `captureForkSource` — which `MemoryStorage` implements but `Storage` does not
   require) are untested.
6. **Persistence.** Everything ran in memory. No `@kyneta/exchange` store backend
   (sqlite/leveldb) was wired, and no fsync/durability semantics were examined.
7. **`undefined` handling.** The suite never writes an `undefined`-valued key, so
   whether `Schema.any()` coerces `undefined`→`null` is unknown. pi entries do
   carry optional fields.
8. **Scale beyond ~10k.** Nothing was tested at realistic long-session sizes, and
   the quadratic curve makes extrapolation actively misleading.

---

## 7. Verified vs. assumed

**Verified by execution:** the 21-case count and their names; the
`createStorageConformance` invocation contract; `MemoryStorage` 21/21 as control;
`KynetaStorage` 21/21, stable over three runs; export/import fidelity including
exotic keys; every timing number in §3.4; that raw `loro-crdt` is linear where
`@kyneta/schema` is quadratic; that the quadratic cost reproduces on the plain-JS
substrate.

**Assumed, not verified:** that the 21 cases fully characterise the `Storage`
contract (pi's own `Storage` implementations may rely on unspecified behaviour the
suite does not probe — `session-repo.js` ships a second, unexercised suite); that
passing implies the harness will accept the adapter (see unknown #5); that
`Schema.any()` round-trips every payload pi can produce (only suite-generated
payloads were exercised).

## Review

**Verdict:** PASS (21/21)

Passed **first execution**, stable over
three runs, independently re-verified. `MemoryStorage` control also 21/21.
Adapter is ~305 lines.

- **ADR-0003 confirmed.** Third-party `Storage` backends are a genuinely
  supported extension point.
- **ADR-0002 supported:** full export → fresh replica → re-read with byte
  fidelity, including `\u0000`-separated and astral-plane keys.
- **No shadow index** — every read materialises from the Loro doc, so the
  document really is the source of truth.
- pi supplies far more than the interface: `prepareStorageCommit`,
  `validateCommittedWrites`, `resolveListReadOptions`, `addUsage`, and
  `MemoryStorage` as a reference state machine. This is why it passed first try.
- **Spawned S11** (the quadratic-write finding).
