# S8 — Is `pi.branch.tip` a contended LWW register, and what are the right semantics?

**Date:** 2026-09-20 · **pi-agent-core:** 0.85.0 · **Sandbox:** `sandbox/s8-tip`

---

## 1. VERDICT

**PASS — the kill criterion is not met.** `pi.branch.tip` *is* genuinely contended and the clobber silently orphans whole turns (3/8 entries, no error), but per-peer tips reconcile with pi's lane model **natively and with no adapter trickery**: pi lanes are arbitrary named strings, multi-lane sessions are first-class, and making the lane name carry writer identity converts every lane-keyed register into a single-writer register — the same mechanism ADR-0009 already relies on. 1000/1000 property trials pass; the shared-lane control fails 300/300.

**Secondary finding that upgrades the problem:** it is **not one register, it is three**. `pi.lane.state` and `pi.lane.config` are keyed by lane name too, and `pi.lane.state` holds the steering **inbox**, so a clobber also silently drops queued user messages. The recommendation fixes all three at once.

**Scoping finding that de-risks v1:** the hazard requires **≥2 harness processes** against one logical session. The v1 demo in `00-vision.md` — *"Two browser windows, one pi host, one conversation tree"* — is a single host and is therefore **not exposed** to this at all. S8 is required for multi-device/team multiplayer, not for v1.

---

## 2. What I ran

Sandbox `sandbox/s8-tip`. Nothing outside it was written. `~/.pi`, `~/halecraft/kyneta`, the pi install, and the other sandboxes were read-only.

### Dependencies (exact pins)

| Package | Version |
|---|---|
| `@kyneta/schema` | 3.0.0 |
| `@kyneta/loro-schema` | 3.0.0 |
| `@kyneta/changefeed` | 3.0.0 |
| `loro-crdt` | **1.10.8** (Kyneta's `pnpm-lock` version, per the S7 precedent — not npm latest) |

Node v24.19.0.

| File | Purpose | Command |
|---|---|---|
| `hazard.mjs` | Step 1 — reproduce the clobber, quantify the loss | `node hazard.mjs` |
| `designs.mjs` | Step 3 — four designs under one identical workload | `node designs.mjs` |
| `property.mjs` | Step 4 — property test + negative control | `node property.mjs [trials] [seed] [shared]` |

Both scripts model pi's real write semantics rather than an abstraction: `hazard.mjs`'s `appendToBranch` is a line-for-line transcription of `session.js:316-340` (read tip → commit `insertEntry({parentId: tip.value})` + `setValue(branchTip(lane), newId)`).

---

## 3. Evidence

### 3.1 Step 2 — how pi actually uses the tip (source reading)

All paths relative to
`…/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/`.

**The address.** `harness/session/values.js:62-63`:

```js
export const branchTip = (branch) => value("pi.branch.tip", branch);
export const branchTipInventoryPrefix = () => value("pi.branch.tip");
```

Key = branch/lane name. Names are near-arbitrary — `session.js:349-355` rejects only empty names and names containing `\u0000`:

```js
assertValidBranchName(name) {
    if (name.length === 0)
        throw new SessionInvalidBranchError(name, "branch name must not be empty");
    if (name.includes("\u0000")) {
        throw new SessionInvalidBranchError(name, "branch name must not contain \\u0000");
    }
}
```

**Is it read-modify-write? Yes — at the Session layer.** `session.js:316-340`:

```js
async appendToBranch(name, entry, context) {
    ...
    const id = this.idGenerator.next();
    await this.mutate(async (mutator) => {
        const tip = await mutator.getValue(branchTip(name), context);   // READ
        if (tip === undefined)
            throw new SessionInvariantError(`Unknown branch: ${name}`);
        await mutator.commit([
            insertEntry({ id, parentId: tip.value, ... }),              // uses it as parent
            setValueWrite(branchTip(name), id),                        // blind overwrite
        ], context);
    }, context);
    return id;
}
```

**Is it read continuously? No — the lane caches it in memory.** `lane.js:128-131`:

```js
async getTipId(_context) {
    this.assertOpen();
    return this.state.tipId;
}
```

Storage is read for the tip only on restore/attach — `restore.js:39-45` (`readLaneStorage`) and `restore.js:48-71` (`restoreSession`). Thereafter the lane advances `state.tipId` in memory and writes it out. So a peer **never observes** a foreign tip mid-run; the drift is invisible until the next restore. (The `state.tipId !== observedTipId` check at `lane.js:584` is an *in-process* optimistic guard inside `acceptNavigation`; it compares local memory against local memory and cannot detect a remote write.)

**Who else writes it?** 12 non-test write sites of `setValue(branchTip(...))`:

| File | What triggers the write |
|---|---|
| `runtime/harness.js:105` | lane attach/creation |
| `runtime/drive/checkpoint.js:48` | user prompt committed (run start) |
| `runtime/drive/tool-placement.js:151` | tool results placed |
| `runtime/drive/response.js:258` | assistant response committed |
| `runtime/drive/boundary.js:76,129` | turn boundary / follow-up |
| `runtime/drive/structural.js:168,184,186,902` | compaction, branch summary, **navigation** |
| `session/session.js:266,336` | `createBranch`, `appendToBranch` |

**Does `navigateTree` write it? Yes** — `structural.js:902`:

```js
const writes = [setValue(branchTip(lane.name), current.targetId)];
```

So the tip is rewritten on essentially every commit in the drive loop, not once per turn.

**It is not the only lane-keyed register.** `values.js:64-65`:

```js
export const laneConfig = (lane) => value("pi.lane.config", lane);
export const laneState  = (lane) => value("pi.lane.state",  lane);
```

`setValue(laneState(...))` has **11 write sites in `lane.js` alone** (lines 260, 280, 464, 538, 672, 821, 1157, 1188, 1520, 1548). `LaneState` carries `{ currentOperationId, lastOperationId, inbox }` — the **inbox is the steering/follow-up queue**, so clobbering it drops queued user messages, not just a pointer.

### 3.2 Step 1 — the clobber, reproduced and quantified

`node hazard.mjs`. Two peers, shared prefix `root → A`, then each runs a realistic 3-entry turn (user / assistant / toolResult) on lane `main` with no sync, then converge:

```
=== S8.1 — pi.branch.tip clobber under two peers ===

peer1 loro peerId=3592838700384472
peer2 loro peerId=8090395281781983

shared prefix: root=…5567b7 -> A=…e3c177
tip @p1 = …e3c177
tip @p2 = …e3c177

-- concurrent, no sync: each peer runs a 3-entry turn on lane 'main' --
p1 appended 3 entries, local tip = …2f9a67
p2 appended 3 entries, local tip = …7533d4

-- after sync --
tip @p1 = …7533d4
tip @p2 = …7533d4
tips agree: true
entry count @p1 = 8  @p2 = 8
entry sets identical: true

surviving tip belongs to: peer2

-- reachability from the surviving tip --
total entries in doc : 8
reachable from tip   : 5
ORPHANED             : 3
   orphan …936d0e  parent=…e3c177  [user] "P1: add TTL eviction"
   orphan …9c700f  parent=…936d0e  [assistant] "P1: here is the TTL sweep"
   orphan …2f9a67  parent=…9c700f  [toolResult] "P1: tests pass"

-- what the loser's user actually sees --
   entries survived in storage : yes (3/3)
   reachable by pi.scanBranch  : NO  — scanBranch starts at the tip
   error raised anywhere       : none
   turns lost                  : 1 complete turn (3 entries)

after one more append, still orphaned: 3 entries
(the losing branch is permanently off the lane's path; only an explicit
 navigateTree to its id could ever bring it back)

CONVERGED (tips agree, accounting balances): true
```

**The shape of the loss is worth stating precisely.** This is *not* S7 §3.4's "an entry disappears." Every entry survives — `entry sets identical: true`. What is lost is **reachability**: the losing peer's whole turn is detached from the lane's path. Because `scanBranch` walks parents from the tip (`lane.js:1478`: `const start = query.start ?? this.state.tipId`), that turn is invisible to the transcript, to context assembly, and to the UI. It converges, it is consistent, and it is wrong — the worst failure profile, since nothing anywhere reports an error.

### 3.3 Step 3 — four designs, one identical workload

`node designs.mjs`. Each peer performs a 3-entry turn **plus** a queued inbox message, no sync until the end:

```
=== (a) shared tip per lane  [STATUS QUO] ===
  physical tip keys   : "pi.branch.tip\u0000main"
  tips                : …67c698
  entries total       : 8
  reachable from tips : 5
  ORPHANED            : 3  <-- DATA LOSS
  inbox msgs surviving: 1/2  <-- QUEUED USER MESSAGE LOST
  concurrent ops seen : 1/2  <-- an in-flight operation vanished
  replicas converged  : true

=== (b) per-peer tip keys, lane name stays 'main'  [adapter rewrites keys] ===
  physical tip keys   : "pi.branch.tip\u0000main@p1", "pi.branch.tip\u0000main@p2"
  tips                : …7d1e20, …644b59
  entries total       : 8
  reachable from tips : 8
  ORPHANED            : 0  <-- none
  inbox msgs surviving: 2/2
  concurrent ops seen : 2/2
  replicas converged  : true

=== (c) one lane per peer  [lane name = writer identity] ===
  physical tip keys   : "pi.branch.tip\u0000lane-p1", "pi.branch.tip\u0000lane-p2"
  tips                : …da3511, …025501
  entries total       : 8
  reachable from tips : 8
  ORPHANED            : 0  <-- none
  inbox msgs surviving: 2/2
  concurrent ops seen : 2/2
  replicas converged  : true

=== (d) tip as an add-wins set of tips ===
  Schema.set under loro.bind: REJECTED at runtime
    changeToDiff: 'set-op' is not yet supported by the Loro backend (Schema.set requires 'add-wins-per-key' which is not in LoroLaws).
```

Note (a) loses **three** things per clobber — the turn, the queued message, and the in-flight operation record — because all three registers are keyed by lane name.

**(d) is unavailable.** I verified the `Schema.set` rejection myself rather than relying on S7's report; the error above is from this run. And the reachable alternative — a *record* of tips keyed by writer — is not actually a different design: it is (b)/(c). Uniqueness of the **key** is what removes contention, not set semantics.

**(b) leaks.** Key rewriting inside the adapter is not transparent, because pi enumerates lanes by scanning the tip namespace by prefix — `restore.js:51,55`:

```js
reader.scanValues(branchTipInventoryPrefix(), context)
...
const tipByLane = new Map(tips.map((value) => [value.address.key, value]));
```

Measured consequence:

```
=== (b) leak test — pi's restoreSession scans the tip inventory by PREFIX ===
  lane names pi would restore: ["main@p1","main@p2"]
  -> pi sees 2 lanes, not 1. The rewrite is NOT transparent;
     the adapter would have to filter scanValues per-peer as well.
```

So (b) buys nothing over (c) and costs an adapter that must lie consistently across `getValue`, `setValue`, **and** `scanValues` — with `restoreSession` and `harness.lanes()` both reading through the lie.

**(c) is natively supported.** Multi-lane sessions are first-class, not a hack:

- `AgentHarness.lane(name, options, context)` and `AgentHarness.lanes(context): Promise<LaneInfo[]>` (`agent-harness.d.ts`).
- `AcquireLaneOptions = { createAt?: string | null }` — a lane can be created rooted at **any** existing entry (`harness.js:85`: `const tipId = stored.kind === "branch" ? stored.tip.value : (options.createAt ?? null)`), which is exactly the Aside/Scout branch operation.
- `Harness.lanesByName` is a `Map`; lanes are held concurrently (`harness.js:18,54,73,80,115,133`).
- pi's own conformance suite exercises a three-lane session — `conformance/session-repo.js` sets up lanes `"main"`, `"review"`, `"empty"` and forks with `{ scope: "branch", branch: "review" }`.

### 3.4 Step 4 — property test for (c), with negative control

`node property.mjs [trials] [seed] [shared]`. 2–4 peers, 10–34 random ops (70% append, 15% `navigateTree`, 15% pairwise sync), random sync interleavings, seeded PRNG.

**The first invariant I wrote was wrong, and the test caught it.** I initially asserted "every entry is reachable from some tip," which failed 169/200 even for (c). The cause was not the design: `navigateTree` **intentionally** orphans entries — abandoning a branch is what branching *is* (ADR-0004: entries are immutable, branches persist). Reachability is therefore not a valid invariant once navigation exists.

The correct invariant is **single-writer fidelity**: a lane register has exactly one writer, so its converged value must equal the last value its owner wrote. Any deviation is a silently lost write.

```
--- design (c): lane-per-peer (single-writer registers) ---
design (c) lane-per-peer: 200/200 trials passed (seed=20260920, 3264 entries)
design (c) lane-per-peer: 200/200 trials passed (seed=1, 3221 entries)
design (c) lane-per-peer: 200/200 trials passed (seed=999, 3226 entries)
design (c) lane-per-peer: 200/200 trials passed (seed=42, 3256 entries)
design (c) lane-per-peer: 200/200 trials passed (seed=7777, 3272 entries)

--- CONTROL: shared lane 'main' (must FAIL) ---
CONTROL (all peers share lane 'main'): 0/100 trials passed (seed=20260920, 0 entries)
  first failure: trial 0 — peer 1: lane main tip is 2db6bb but this peer last wrote 80b0b5 — LOST WRITE (peers=2, ops=17)
  exit=1
CONTROL (all peers share lane 'main'): 0/100 trials passed (seed=1, 0 entries)
  first failure: trial 0 — peer 1: lane main tip is 84f9b5 but this peer last wrote 8b04e9 — LOST WRITE (peers=3, ops=10)
  exit=1
CONTROL (all peers share lane 'main'): 0/100 trials passed (seed=999, 0 entries)
  first failure: trial 0 — peer 0: lane main tip is 211fe2 but this peer last wrote cd1786 — LOST WRITE (peers=4, ops=25)
  exit=1
```

**1000/1000 pass for (c); 0/300 for the control.** The test is not vacuous.

### 3.5 Design scorecard

| | (a) shared tip | (b) per-peer keys, lane `main` | (c) lane per peer | (d) add-wins set |
|---|---|---|---|---|
| Orphaned turns | **3/8** | 0 | 0 | — |
| Inbox preserved | **1/2** | 2/2 | 2/2 | — |
| Satisfies `AgentLane` | yes, incorrectly | only if adapter lies in 3 places | **yes, natively** | N/A |
| Adapter complexity | none | rewrite `getValue`/`setValue`/`scanValues` | none | — |
| Available on Loro | yes | yes | yes | **no — runtime reject** |
| What the UI shows | one path; a turn vanishes | N tips, pi thinks 1 lane | **N named lanes, N tips** | — |

---

## 4. Recommendation

**Adopt (c): the lane name carries writer identity.**

Each writer (peer/device/session-participant) gets its own lane, created at the entry it branched from:

```js
const lane = await harness.lane(`peer-${peerId}`, { createAt: branchPointEntryId }, ctx)
```

Why this one:

1. **It is the ADR-0009 mechanism, reused.** ADR-0009 established that a Loro per-key LWW register is safe precisely when *each key has exactly one writer*. Entry ids achieve that via UUIDv7; lane names achieve it via writer identity. One idea, applied twice — no new machinery, no new failure mode to reason about.
2. **It fixes all three registers at once.** `pi.branch.tip`, `pi.lane.state` (incl. the inbox), and `pi.lane.config` are all keyed by lane name, so partitioning the lane name partitions all of them.
3. **Zero adapter complexity.** `KynetaStorage` stays exactly as S2 built it. Compare (b), which requires the adapter to rewrite keys consistently across `getValue`, `setValue`, and `scanValues` while `restoreSession` and `harness.lanes()` read through the deception.
4. **It is what pi's model already means.** A lane is pi's unit of concurrent execution — `AgentHarness.lanes()`, `lanesByName`, three-lane conformance fixtures. Per-peer lanes use the grain as designed rather than against it.
5. **It matches the product.** `00-vision.md` wants Aside/Scout branches "running concurrently," and each is naturally its own lane with its own tip. `LaneInfo { name, tipId, operation }` is close to a ready-made UI model for the tree's live cursors.

### What it costs

- **A naming discipline, enforced mechanically.** Two peers must never pick the same lane name. Lane names are user-supplied strings validated only for emptiness and `\u0000` (`session.js:349-355`), so `"main"` is an easy accidental collision — and the failure is silent. This is a **safety invariant of the same class as ADR-0009** and needs the same treatment: derive the lane name from a coordination-free peer id, never from a user string or a default.
- **Lanes accumulate and there is no deletion API.** I found **no** non-test `deleteValue` on `branchTip`/`laneConfig`/`laneState`. Every peer that ever joins leaves three permanent registers. Bounded by distinct-writers-over-session-lifetime, so not urgent, but it is a real leak and the UI will need to distinguish live lanes from historical ones.
- **"The trunk" becomes a convention, not a lane.** If every writer has its own lane, no single lane is canonical. The trunk has to be expressed some other way — a named pointer, a label, or simply the path to a designated leaf. **This is an open design question S8 does not answer** (see §5.1).
- **Each host materialises foreign lanes.** `restoreSession` restores *every* lane in the inventory into `lanesByName`, so a host holds `Lane` objects for other peers' lanes with in-memory state that goes stale as those peers write. Convergence at the storage layer is proven here; whether the *harness* tolerates that is **S3's** question, and this sharpens it.

### Scope: v1 is not blocked

The hazard needs ≥2 harness processes on one logical session. Under ADR-0001/ADR-0007 the v1 architecture is **one Node host owning the harness, with thin browser clients**, and S2/T5 established that `Storage`'s admission queue serialises commits within a process. Two browser windows driving one host therefore contend on nothing — and two concurrent Aside/Scout branches in that host are already two lanes with distinct keys. **S8 is a prerequisite for multi-device/team multiplayer, not for the v1 demo.**

> **Annotation (step 3).** "Two browser windows driving one host contend on
> nothing" was true of the *design* and false of the *implementation* until
> step 3: the host minted a single lane at startup and every window drove it.
> Since `PLAN-2026-09-25-lane-per-writer`, each window has its own lane, keyed by
> the transport's peer id, and the claim holds. The original sentence is left
> as written; findings are the evidence record.

---

## 5. Consequences for the plan

**Kill criterion not met.** Per-peer tips reconcile with pi's lane model. Concurrent branch navigation does **not** move onto the v1 critical path.

**Answers the S8 hypothesis as posed.** `03-spikes.md` asks: *"Do these reconcile, or does per-peer tip require a LANE PER PEER?"* — the answer is the second disjunct, and it is good news rather than bad: lane-per-peer is pi's native grain, not a workaround.

**Spawns a proposed ADR-0011 — "Lane name carries writer identity."** Same shape as ADR-0009: a uniqueness requirement on a key, enforced mechanically, whose violation is silent data loss.

**Amends `01-architecture.md` § Document shape.** The `values` bullet currently reads *"LWW map over `(namespace, key)`. Carries `pi.branch.tip`, `pi.lane.*`, `pi.op.*`, labels."* It should record that lane-keyed registers are safe **only** under single-writer lane names, and that `pi.lane.state` carries the inbox.

**Sharpens S3.** Storage-layer convergence for lane-per-peer is now proven. The remaining question is narrower and better posed: does the *harness* tolerate `restoreSession` materialising foreign lanes whose durable state advances underneath its cached `state.tipId`?

**Retires a worry.** `00-vision.md` proposes per-peer tips as *presence*. That is unnecessary for correctness — durable per-peer lanes are sufficient and simpler. Presence remains the right home for *ephemeral* cursors (selection, scroll, live typing), but the authoritative tip should stay durable in the lane register.

**Fitness function available.** `property.mjs` (single-writer register fidelity + `shared` negative control) is ready to promote alongside S7's `convergence.property.mjs`.

---

## 6. Residual unknowns (NOT resolved)

1. **§5.1 — what is "the trunk" when every writer has a lane?** The single biggest open question this spike raises. Candidate answers (a designated lane, a label on an entry, a separate `pi.session.*` pointer) were not evaluated. It interacts with fold (ADR-0010: a fold is destination-relative — destination = which lane's tip?).
2. **No real harness was run.** Everything models pi's write semantics over Kyneta docs; `KynetaStorage` was never handed to an `AgentHarness` with two live harnesses. That is S3, and S2 §6.5 flagged the same gap.
3. **`pi.lane.config` contention not separately tested.** Shown to be lane-keyed and written at `harness.js:106`, `lane.js:1468`, `tool-placement.js:149`; the fix follows from lane partitioning, but no dedicated test was run.
4. **Lane lifecycle.** No deletion API was found, but I did not check whether `SessionRepo.fork` or any higher-level path prunes lanes. Accumulation cost is therefore an upper bound, not a measured one.
5. **Lane-name length/charset limits at scale.** Only emptiness and `\u0000` are validated; whether very many lanes degrade `scanValues(branchTipInventoryPrefix())` was not measured (adjacent to S10/S11).
6. **`operationMeta`/`operationState`/`pi.result`** are keyed by `operationId`, which is minted per operation and so presumptively uncontended — **assumed, not verified**.
7. **Two peers deliberately sharing one lane** (genuine co-driving of a single agent turn) is not addressed. This design forbids it; whether the product ever wants it is a product question.
8. **Persistence/transport untested.** In-process `exportSince`/`merge` only — no `@kyneta/exchange`, no Line, no store backend, no partition healing.
9. **`navigateTree`'s full commit path.** I modelled navigation as a tip write (`structural.js:902`), but the real path also writes labels, operation state, and possibly a branch summary; interactions of those writes under concurrency were not examined.

---

## 7. Verified vs. assumed

**Verified by execution:** the clobber and its exact accounting (8 entries, 5 reachable, 3 orphaned, entry sets identical, no error); inbox and operation-record loss under (a) (1/2 and 1/2); zero orphans and full preservation under (b) and (c); `Schema.set` runtime rejection with the quoted message; the (b) prefix-scan leak producing lane names `["main@p1","main@p2"]`; 1000/1000 property trials for (c) across five seeds; 0/300 for the shared-lane control.

**Verified by source reading (quoted above with file:line):** `branchTip`/`laneConfig`/`laneState` addresses; `appendToBranch` read-modify-write; `getTipId` returning cached in-memory state; tip read from storage only at restore; 12 non-test `setValue(branchTip(...))` sites incl. `navigateTree`; 11 `setValue(laneState(...))` sites in `lane.js`; branch-name validation; `AcquireLaneOptions.createAt`; `lanesByName` as a Map; three-lane conformance fixtures.

**Assumed, not verified:** that modelling pi's writes over a Kyneta doc faithfully predicts a real two-harness deployment (S3 owns this); that operation-scoped namespaces are uncontended because `operationId` is unique; that the v1 single-host architecture holds as written in ADR-0001/0007 (read from the plans, not re-derived); that no pi code path outside `dist/harness` writes lane-keyed registers (I searched `dist/harness` only).
