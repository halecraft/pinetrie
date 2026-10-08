# S3 — Does `pi-agent-core` tolerate storage it did not write?

- **Status:** Answered
- **Led to:** ADR-0009, ADR-0011, ADR-0013

## Brief

**Size:** M · **Depends on:** S2

**Question.** Two harness instances against one Kyneta doc, appending on
different tips. Does the harness cope with `scanBranch`/`getEntries` returning
entries that appeared from another peer mid-run?

**Why it matters.** `SessionMutation` is documented as an *"exclusive keyless
mutation barrier for one Session"* — a per-process mutex. It may assume a
private world. Measured behaviour today: two clients on one lane **serialize**.

**Kill criterion.** If the harness caches, assumes monotonic local growth, or
corrupts on foreign entries, multi-writer needs *harness* changes, not just
storage — a materially larger project.

**Throw away.** The driver. Keep a written list of every assumption violated.

## Report

**Date:** 2026-09-20 · **pi-agent-core:** 0.85.0 · **Sandbox:** `sandbox/s3-harness`

---

## 1. VERDICT

**KILL CRITERION MET — but the mitigation is a design change, not a harness patch.**
The harness **caches** (confirmed) and **assumes monotonic local growth** (confirmed); it does **not** corrupt or crash. A *shared* lane across replicas is unusable. However, **one lane per writer fully avoids every tip-level failure** (10/10 assertions), because lanes are keyed by name, each owns its own `branchTip` register, and `harness.lane()` re-reads storage at acquisition. `seq` remains broken under either shape and is now empirically S1's problem, not a theoretical one.

**Net: multi-writer pine·trie stays a STORAGE project, on the condition that writers never share a lane.**

---

## 2. What I ran

Sandbox only. `~/.pi` (11 session dirs, unchanged), `~/halecraft/kyneta` (`git status` clean, 0 lines), the pi install, and the sibling sandboxes were read-only.

### Dependencies (exact pins, as S2)

```
@kyneta/schema 3.0.0 · @kyneta/loro-schema 3.0.0 · loro-crdt 1.10.8
```

Node v24.19.0. `kyneta-storage.mjs` copied verbatim from `sandbox/s2-storage` — **not modified**.

### Files

| File | Purpose |
|---|---|
| `harness-util.mjs` | Replica factory: Loro doc → `KynetaStorage` → `StorageBackedSession` → `AgentHarness`; `sync()` via `exportSince`/`merge` |
| `step1-single.mjs` | One harness end to end (closes S2 residual #5) |
| `step2-two-harnesses.mjs` | **The spike.** Probes (a)–(e) + recovery |
| `step3-seq-collision.mjs` | True partition → `seq` collision + cursor loss |
| `step4-asymmetric.mjs` | Asymmetric partition → orphan analysis |
| `step5-counter-lww.mjs` | Does the LWW counter accept a later *lower* write? |
| `step6-natural-race.mjs` | Does counter regression arise *naturally*? (negative control) |
| `step7-lane-per-peer.mjs` | **The mitigation.** One lane per writer |

```bash
cd ./sandbox/s3-harness && npm install --no-audit --no-fund
node step1-single.mjs      # exit 0, pass=12 fail=0
node step2-two-harnesses.mjs
node step3-seq-collision.mjs
node step4-asymmetric.mjs ; node step5-counter-lww.mjs ; node step6-natural-race.mjs
node step7-lane-per-peer.mjs   # exit 0, pass=10 fail=0
```

**Model layer: stubbed.** `stubModel`/`stubModels` in `harness-util.mjs`; `prompt()` is never called, so no network and no cost. Every probe exercises the real `Lane` append/tip/read paths, which is where the ownership assumptions live. **The drive/inference loop was not exercised** — see §5.

**IDs:** I supplied my own `IdGenerator` with a peer tag embedded, so ADR-0009 uniqueness holds by construction and id collision could not confound the results. pi's own generator is untested (S9).

---

## 3. Evidence

### 3.1 Step 1 — a real `AgentHarness` runs over `KynetaStorage`

Closes S2 residual #5 positively. `pass=12 fail=0`, stable over 3 runs.

```
PASS  createAgentHarness() returned a harness
PASS  harness.lane('main') acquired
PASS  appendMessage -> 386854
PASS  lane tip advanced to the newest entry
PASS  findEntries walked the branch (2 entries)
PASS  durable stats reflect 2 messages
PASS  pi.lane.state written (pi.lane.state main)
PASS  pi.lane.config written (pi.lane.config main)

  doc entries:
    seq=  4 id=386854 parent=—      message "first"
    seq=  7 id=2bfcdc parent=386854 message "second"
  value namespaces present: pi.branch.tip, pi.lane.config, pi.lane.state
```

### 3.2 Step 2 — shared lane, two replicas. Stable across 3 runs.

```
  (a) CACHING            CONFIRMED — harness caches
  (a2) READ PATH         CONFIRMED — invisible
  (b) MONOTONIC GROWTH   CONFIRMED — forked from stale tip
  (b2) TIP CLOBBER       CONFIRMED — LWW discards one branch head
  (c) seq COLLISION      not observed in this interleaving
  (d) MUTATION BARRIER   CONFIRMED — per-process only
  (e) SILENT WRONG CONTEXT CONFIRMED — no crash, silently divergent context
  (f) RECOVERY           AVAILABLE
```

**(a) Caching.** A appends, docs sync, then:

```
  B doc     pi.branch.tip[main] = a1a183
  B SESSION getBranchTip('main') = a1a183   <- reads storage
  B LANE    getTipId()           = ac3ba5   <- reads memory
```

The storage layer is correct; the *lane* is stale. **`StorageBackedSession` does not cache — `Lane` does.**

**(a2) Read path.** `laneB.findEntries()` returned 1 entry; the foreign entry `a1a183` was absent from B's branch walk despite being present in B's document.

**(b) Monotonic growth.** B appended `4f784a` with `parentId = ac3ba5` (the cached tip), not A's newer `a1a183`.

**(b2) Tip clobber.** After sync:

```
    seq=  4 id=ac3ba5 parent=—      message "shared root"
    seq=  7 id=a1a183 parent=ac3ba5 message "A-writes-this"
    seq= 10 id=4f784a parent=ac3ba5 message "B-writes-this"

  pi.branch.tip[main] after sync = 4f784a
    A believed: a1a183   B believed: 4f784a
```

Both entries survive (ADR-0009 holds). One branch head is unreferenced by the tip pointer. Step 4 confirms the orphan directly: `reachable from tip: 7 / 8`, orphan = `"B-1"`.

**(d) Mutation barrier.**

```
  cross-replica mutations overlapped : true
  same-session mutations overlapped  : false  (control — must be false)
```

`MutationLine` serializes correctly *within* one `StorageBackedSession` and not at all *across* replicas.

**(e) No crash, no corruption — divergent context.**

```
  reads after divergence threw: no
  A's model context: "shared root" | "A-writes-this"
  B's model context: "shared root" | "B-writes-this"
```

Each replica prompts on a different branch of the same converged document. Nothing signals it.

**(f) Recovery.** `restoreSession()` returned the converged tip `4f784a`. **The cache is refreshable — it is simply never refreshed during a lane's lifetime.** This is the crack that step 7 exploits.

### 3.3 Step 3 — true partition: `seq` collides and pagination silently drops an entry

Step 2 synced between writes, so the counters never diverged. Partitioning 3 writes each (stable across 3 runs):

```
  converged entry seq map:
    seq=  4  4312f0="shared root"
    seq=  7  474105="A-1"  ,  24b50e="B-1"   <<< COLLISION
    seq= 10  ad4089="A-2"  ,  2a18fc="B-2"   <<< COLLISION
    seq= 13  7d617f="A-3"  ,  da6dd2="B-3"   <<< COLLISION

  total entries: 7 · distinct seq values: 4 · COLLIDING seq values: 3
```

Consequence, using pi's own cursor rule (`findEntries` → `fromSeq: cursor.seq + 1`):

```
  cursor pagination (limit=2, asc):
    page0: 4:4312f0 , 7:474105
    page1: 10:ad4089 , 10:2a18fc
    page2: 13:7d617f , 13:da6dd2

    entries paged: 6  unique: 6  total in doc: 7
    >>> SKIPPED BY PAGINATION: 7:24b50e="B-1"
```

**An entry present in the document is silently unreachable through the paginated read path.** No error.

### 3.4 Step 5 — the LWW counter accepts a later, *lower* write

```
  converged meta.nextSeq = 10 · max seq in use = 22
  >>> LWW accepted the later LOWER value: true
  >>> REGRESSION (nextSeq <= maxUsed): true
  new entry 04c478 allocated seq=10
  >>> that seq was ALREADY IN USE: true
      collides with be9f82 "A-2"
```

Stable over 3 runs. **Caveat (§6):** I forced the lower write with an explicit `batch()`. Step 6 ran 8 trials of an in-flight commit racing a sync and produced **0/8 regressions** — because `KynetaStorage` reads `meta.nextSeq` from the post-merge document. So regression is a **demonstrated mechanism, not an observed natural outcome** in my interleavings. Collision (§3.3) *is* natural and reproducible.

### 3.5 Step 7 — MITIGATION: one lane per writer. `pass=10 fail=0`, stable over 5 runs.

Both peers acquire their own lane branching at the shared trunk tip via `harness.lane(name, { createAt }, ctx)`, then write 3 messages each while partitioned:

```
  branch tips in the converged document:
    main     -> ed8b36
    peer-a   -> 7310fc
    peer-b   -> 18eab6
  PASS  peer-a tip survived the merge (no clobber)
  PASS  peer-b tip survived the merge (no clobber)
  PASS  trunk tip untouched
  PASS  A's cached tip for its OWN lane matches the document
  PASS  B's cached tip for its OWN lane matches the document

  entries=8  reachable from some tip=8  orphans=0
  PASS  no orphaned entries — every write is on a named branch

  converged tree:
    seq=  4 id=2017e4 parent=—      message "trunk-1"
    seq=  7 id=ed8b36 parent=2017e4 message "trunk-2"
    seq= 13 id=7a78aa parent=ed8b36 message "A-1"
    seq= 13 id=af6a71 parent=ed8b36 message "B-1"
    seq= 16 id=60e564 parent=7a78aa message "A-2"
    seq= 16 id=55578b parent=af6a71 message "B-2"
    seq= 19 id=7310fc parent=60e564 message "A-3"
    seq= 19 id=18eab6 parent=55578b message "B-3"
```

That is **exactly the branched conversation tree pine·trie wants**, produced by two concurrent partitioned writers with zero coordination.

Cross-lane reads work without restart:

```
  A reading peer-b's branch via session.scanBranch: 5 entries
    "trunk-1" | "trunk-2" | "B-1" | "B-2" | "B-3"
  PASS  A can read B's branch through the Session (storage-level) read path
  PASS  acquiring a NOT-yet-built lane re-reads storage and sees foreign writes
```

But:

```
  entries=8  distinct seq=5  duplicates=3
  >>> lane-per-peer does NOT fix seq: collisions remain
```

---

## 4. THE DELIVERABLE — every exclusive-ownership assumption, with evidence

Paths relative to `pi-agent-core/dist/`.

| # | Assumption | Source evidence | Measured | Fixed by lane-per-peer? |
|---|---|---|---|---|
| **A1** | `Lane.state` is an in-memory authoritative projection, never invalidated | `harness/runtime/lane.d.ts:27` — *"Authoritative live control projection **while this harness owns the Session**"*. `harness/runtime/harness.js:290` calls `restoreSession` **once**, at construction | step2 (a) | ✅ each lane is owned by exactly one writer |
| **A2** | `getTipId()` never touches storage | `lane.js:128-131`: `async getTipId(_context) { this.assertOpen(); return this.state.tipId; }` — the context param is underscore-prefixed, i.e. unused | step2 (a): returned `ac3ba5` vs doc `a1a183` | ✅ |
| **A3** | Branch reads default to the cached tip | `lane.js:1478`: `const start = query.start ?? this.state.tipId;` | step2 (a2): foreign entry invisible | ✅ |
| **A4** | Appends chain from the cached tip — no re-read, no compare-and-swap | `lane.js:1513`: `chainEntries(state.tipId, ...)`; `lane.js:1519`: `setValue(branchTip(this.name), id)` | step2 (b) | ✅ |
| **A4b** | Same assumption is **systemic in the drive loop**, not localised | `runtime/drive/checkpoint.js:34`, `drive/response.js:240`, `drive/structural.js:158` all build `parentId` from `state.tipId` | not exercised (stub model) | ✅ by construction; ⚠️ unverified |
| **A5** | Command planning reads cached state and writes derived state | `lane.js:200`: `plan(this.state, mutator)`; `lane.js:208`: `this.state = decision.next` — next state derives from cached previous, not from a read | step2 (b) | ✅ |
| **A6** | `branchTip` is a blind LWW overwrite; one tip per lane name | `lane.js:1519` (no CAS) | step2 (b2), step4 orphan `"B-1"` | ✅ separate register per lane |
| **A7** | The mutation barrier is object-local | `session/mutation-line.d.ts:1` — *"Serializes complete read-modify-write jobs for **one Session**"*; `session/types.d.ts:426` — *"**Exclusive** keyless mutation barrier for one Session"*; `session.js` ctor: `options.mutationLine ?? new MutationLine()` | step2 (d): cross-replica overlap `true`, same-session `false` | ✅ (and see T5 below) |
| **A8** | `seq` comes from a single global dense counter | S2/T1; `KynetaStorage` `meta.nextSeq`. Forced by the contract, not by our design | step3: 3 collisions | ❌ **unfixed** |
| **A9** | `seq` doubles as a pagination cursor | `session.js` `findEntries`: `fromSeq: query.cursor.seq + 1` / `toSeq: query.cursor.seq - 1` | step3: `"B-1"` silently skipped | ❌ **unfixed** |
| **A10** | Failures are silent — no crash, no corruption, no signal | — | step2 (e) | partially: lane-per-peer removes the *tip* divergence |

**Positive counter-findings (the escape hatches):**

| # | Fact | Evidence |
|---|---|---|
| **P1** | `StorageBackedSession` does **not** cache. Every read delegates to `Storage` | `session.js` `getEntries`/`scanBranch`/`getValue` are pass-throughs; step2 (a) shows `getBranchTip` correct while `Lane` is stale |
| **P2** | The cache **is** refreshable | `restoreSession()` returned the converged tip — step2 (f) |
| **P3** | Refresh granularity is **lane acquisition**. `harness.lane()` re-reads storage for a lane not already in `lanesByName` | `harness.js:76-79` `readLaneStorage` + `restoreLaneState` inside `session.mutate`; step7 confirms |
| **P4** | Lanes can be created at an arbitrary entry | `AcquireLaneOptions { createAt?: string \| null }` (`agent-harness.d.ts:676`); `harness.js:83` `options.createAt ?? null` |
| **P5** | `MutationLine` is **injectable** — `StorageBackedSessionOptions.mutationLine?: MutationLine` (`session.d.ts`) | a distributed barrier could be supplied without forking |

---

## 5. Answer to T5 — can the admission mutex be per-replica?

**Yes.** And the question turns out to be aimed at the wrong object.

The mutex's job is to make a **read-modify-write atomic locally** (read tip → append child → move tip). Step 2 (d) shows it does that correctly within a replica and not at all across replicas. But cross-replica serialization is not what the `Storage` contract requires: `validateCommittedWrites` only demands that an entry's parent **resolves**. In the concurrent case B's parent (the stale tip) *does* exist, so validation passes and `commit` is contract-clean. **No `Storage`-contract violation was produced by any probe in this spike.**

What actually breaks is one level up: the **single shared `branchTip` register** (A6) and the **global dense `seq`** (A8/A9). Those are the real coupling, and neither is the mutex.

So:

- **Mutex: keep it per-replica.** Local atomicity + CRDT convergence underneath is sufficient. No distributed lock needed. (P5 leaves the door open if that ever changes.)
- **`branchTip`: must not be shared by concurrent writers.** Shard it — one lane per writer (step 7). This is the answer S8 was looking for: per-peer tips are reconcilable with pi's lane model, via `harness.lane(peerName, { createAt }, ctx)`. **They do not require a fork; they require a naming convention.**
- **`seq`: genuinely unresolved.** S1.

---

## 6. Consequences for the plan

**S3 resolved — kill criterion met on 2 of 3 counts** (caches ✅, monotonic growth ✅, corrupts ❌). Read strictly, that says "harness changes needed." Read precisely, step 7 shows the harness already supplies the primitives (P3, P4) and the required change is **a pine·trie design rule, not a pi patch**.

**ADR-0001 (embed `pi-agent-core`) — HOLDS, with a new constraint.** The calculus does not change: no fork is required. Add the constraint below.

**Proposed ADR-0011 — "One lane per writer; never share a lane."**
Concurrent writers MUST each own a distinct lane name. A shared lane produces stale caches, forked parents, tip clobber, and silently divergent model context (§3.2) — none of which surface as errors. Branch a writer's lane from a shared point with `harness.lane(name, { createAt: tipId }, ctx)`. Corollary: a `Lane` object is single-writer state and must never outlive its writer's ownership; to observe another writer's branch, either read through the `Session` (P1 — always fresh) or acquire that lane by name (P3).

**ADR-0009 (id uniqueness) — reinforced.** Every entry survived every partition in every probe. Unique ids are what keep divergence recoverable instead of lossy.

**S8 (`pi.branch.tip` contention) — substantially answered, ahead of schedule.** `pi.branch.tip` *is* a contended LWW register when shared (step2 b2, step4 orphan) and *is not* contended when sharded per writer (step7). S8's open hypothesis — "do per-peer tips reconcile with pi's lane model?" — is **yes**, via lane naming. S8 should narrow to: what is the lane naming/lifecycle policy, and how do trunk lanes relate to peer lanes?

**S1 (`seq`) — promoted from theory to demonstrated defect.** Not an abstract risk: 3 collisions per 6 partitioned writes, reproducible, and one entry silently dropped by paginated reads. Lane-per-peer does **not** help. S1 now has a concrete reproduction (`step3-seq-collision.mjs`) and a mechanism demo for counter regression (`step5-counter-lww.mjs`). This is the top remaining storage blocker.

**Roadmap — new fitness functions.** (1) "No two entries share a `seq` after a partition heal" — currently **failing**, and the right regression target for S1. (2) "Every entry is reachable from some branch tip" — step7's orphan check, currently passing under lane-per-peer.

---

## 7. Residual unknowns (NOT resolved)

1. **The drive/inference loop was never exercised.** The model was stubbed and `prompt()` never called. A4b shows `state.tipId` is used pervasively in `drive/{checkpoint,response,structural,boundary,reconcile}.js`; compaction, steering, inbox, and operation-state machinery are all untested under foreign writes. Lane-per-peer *should* make this moot, but that is inference, not measurement.
2. **Counter regression was not naturally reproduced.** Step 5 forced it; step 6 got 0/8 naturally. Whether a real deployment can hit it is open.
3. **Only two replicas, cooperative lossless sync.** No 3+ peers, no true network, no reordering/duplication, no `@kyneta/exchange`, no persistence.
4. **`pi.lane.state` / `pi.lane.config` contention unexamined.** Both are LWW registers written by `harness.lane()` and on every operation transition. Under lane-per-peer they are per-lane, but two harnesses acquiring the *same* lane name would contend. Not probed.
5. **Concurrent operations (`pi.op.*`) untested.** `inbox`, `currentOperationId`, and `OperationState` are durable and were never exercised concurrently.
6. **`captureForkSource` not implemented by `KynetaStorage`.** `MemoryStorage` has it, `Storage` does not require it, `MemorySessionRepo.fork()` calls it. Session forking would fail. Untested.
7. **pi's own `IdGenerator` untested** (S9). I supplied a peer-tagged generator so ADR-0009 held by construction. pi's default `uuidv7` under concurrent multi-peer use remains unverified — and A8's severity would compound with id collision.
8. **Lane-per-peer at scale.** 2 lanes, 8 entries. Unknown: many lanes, lane GC, whether `restoreSession` cost grows with lane count, and what `lanes()` does with hundreds.
9. **No `AgentLane.navigateTree` testing.** In-place branch navigation is the S8/product-critical path and was not touched.

---

## 8. Verified vs. assumed

**Verified by execution:** that `KynetaStorage` runs under a real `AgentHarness` (step1, 12/12, 3 runs); every step-2 finding (3 identical runs); the step-3 `seq` collision and the pagination-skipped entry (3 identical runs); the step-4 orphan; the step-5 LWW-accepts-lower-value mechanism and consequent seq reuse (3 runs); step-6's 0/8 natural regressions; every step-7 assertion (10/10, 5 runs). All source citations in §4 are quoted from the files at the stated line numbers.

**Assumed, not verified:** that lane-per-peer survives the drive loop (residual #1) — the strongest claim in this report rests on append/read paths only; that no *other* pi subsystem caches session state (I audited `Lane`, `StorageBackedSession`, `Harness`, and `restore`, not compaction/hooks/tools); that two replicas generalise to N; that `seq` collision is the *only* remaining storage-level blocker under lane-per-peer.

**Explicitly not claimed:** that counter regression occurs naturally; that the `Storage` contract is violated by concurrency (it was not, in any probe); that lane-per-peer is sufficient for the v1 demo without S1 being solved.

## Review

**Verdict:** (kill criterion met; mitigated by design)

**Closed S2 residual #5: a real
`AgentHarness` runs over `KynetaStorage`** (step1 12/12, re-verified).

- **Confirmed:** the harness **caches** and **assumes monotonic local growth**.
  It does **not** crash or corrupt. `StorageBackedSession` does *not* cache —
  **`Lane` does** (`lane.js:128-131`, `getTipId` ignores its context param).
- **Mitigation proven:** lane-per-writer → 10/10, re-verified, zero orphans,
  producing exactly the branched tree pine·trie wants from two partitioned writers
  with zero coordination.
- **T5 answered: yes, the mutex can be per-replica.** The question was aimed at
  the wrong object — no probe produced a `Storage`-contract violation. The real
  coupling is the shared `branchTip` register and the global `seq`.
- **Itemised 10 exclusive-ownership assumptions (A1–A10) with file:line
  evidence**, plus 5 escape hatches (P1–P5) — notably `MutationLine` is
  *injectable*, so a distributed barrier is possible without forking.
- **Net: multi-writer pine·trie stays a STORAGE project**, conditional on ADR-0011.
- Model layer was **stubbed**; the drive/inference loop is untested (residual #1).
