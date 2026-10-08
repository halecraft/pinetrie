# S4 — Browser ↔ Node host over a Kyneta Line

- **Status:** Answered
- **Led to:** ADR-0007, ADR-0014

Spawned S16.

## Brief

**Size:** M · **Depends on:** nothing (cheap now that ADR-0007 fixes the design)

**Question.** Does a Line over `@kyneta/websocket-transport` carry command
traffic and replicated transcript state to a browser at streaming rates
(~50 token-deltas/sec)?

**Sub-question.** Should token deltas ride ephemeral presence or the durable
doc? pi already separates these (`message_update` vs `entry_appended`;
`pi.pending.assistant_frame` list ops are appended then deleted on commit).

**Kill criterion.** If delta rates saturate the doc layer, streaming moves to
presence and the durable doc only receives committed entries.

## Report

> ## ⚠️ CORRECTION (post-review) — §3.4's "connected client loses text" is a TEST-HARNESS BUG
>
> The report claims: *"C's early client: 2701/2702 … a client connected for the
> entire stream still lost a character, because ephemeral LWW coalesced two
> updates."* **That diagnosis is wrong.** The loss is an off-by-one in the
> observer, not a substrate property.
>
> The observer dedups on `seq`:
> ```js
> observe: (doc, obs) => { const s = doc.seq()
>   if (obs.length === 0 || obs[obs.length-1].seq !== s) obs.push({seq:s, text:doc.last()}) }
> ```
> and the writer uses `x.seq.set(i)` with **i starting at 0**. An unwritten
> ephemeral number **defaults to 0**, so the poller's first sample records
> `{seq: 0, text: ""}` *before any write*; delta index 0 then sets `seq` to 0 —
> unchanged — and is deduped away. `delta[0].text === "A"` (1 char), so exactly
> one character is lost, deterministically (2701/2702 on every run).
>
> Verified directly (`probe-offbyone.mjs`):
> ```
> BEFORE any write -> seq(): 0  last(): ""
> obs after first sample: [{"seq":0,"text":""}]
> obs after deltas 0 and 1: [{"seq":0,"text":""},{"seq":1,"text":"BBBB"}]
> reconstructed: "BBBB"   expected: "ABBBB"
> ```
>
> **Consequences:**
> - There is **no** silent-text-loss defect for a fully-connected ephemeral
>   client. That claim must not be cited.
> - **The 98.9 % coverage figures for B and C in §3.2 are suspect** — same
>   dedup pattern, 93/94 is consistent with the same off-by-one, not with
>   dropped deltas.
> - **§3.3's notification defect is unaffected and still real** — it is
>   root-caused in Kyneta source with a `json` control.
> - **§3.4's LATE-joiner result (1260/2702) is unaffected and still real** — a
>   delta-only channel genuinely cannot reconstruct a prefix it never saw. That
>   is inherent, not an artifact.
> - **ADR-0014's decision stands**, but on the notification defect and the
>   late-joiner result. See ADR-0014's own correction note.
>
> *Root cause of the error: the harness used a 1 ms poller rather than a
> subscription (because §3.3's defect makes subscription unavailable for
> ephemeral), and a sampling observer was mistaken for the substrate's
> behaviour.*

**Date:** 2026-09-20 · **Sandbox:** `sandbox/s4-transport` · **Node:** v24.19.0

---

## 1. VERDICT

**PASS — the kill criterion is not met.** A Kyneta `Line` carries every agent command kind over a real websocket with **p50 1.67 ms** round-trip, and replicated document state sustains **202.6 deltas/sec (4× the 50/s target) at p50 1.7 ms with 100 % delta coverage** — the document layer is nowhere near saturation, so streaming does **not** need to move to presence. **But the design question resolves the opposite way from the brief's hypothesis: token deltas must ride the DURABLE doc, because ephemeral presence is disqualified twice over** — it never fires `subscribe()` on remote arrival (a Kyneta defect, root-caused below), and a delta-only presence channel silently loses text **even for a client connected the whole time**.

---

## 2. What I ran

### Dependency wiring — symlink into the local workspace (NOT S14's dist overlay)

The brief offered `link:` with a fallback to S14's dist-overlay. I used a third method that is simpler and strictly more faithful: **direct symlinks into the local workspace packages**. Node resolves symlinks by default, so each `@kyneta/*` import resolves its own transitive deps from the workspace's already-installed pnpm graph — no `workspace:^` protocol for npm to choke on, and no hand-assembled dist overlay that could drift.

```sh
ln -sfn ~/halecraft/kyneta/packages/schema                        node_modules/@kyneta/schema
ln -sfn ~/halecraft/kyneta/packages/schema/backends/loro          node_modules/@kyneta/loro-schema
ln -sfn ~/halecraft/kyneta/packages/exchange                      node_modules/@kyneta/exchange
ln -sfn ~/halecraft/kyneta/packages/exchange/transports/websocket node_modules/@kyneta/websocket-transport
…machine, changefeed, random, transport, wire, bridge-transport
ln -sfn ~/halecraft/kyneta/node_modules/.pnpm/loro-crdt@1.16.1/node_modules/loro-crdt node_modules/loro-crdt
```

`relink.sh` reruns this — **`npm install` deletes the symlinks** ("removed 11 packages"), so `ws` was installed first and the links recreated after.

**Correction to `01-architecture.md`.** It states *"Transports available: websocket, SSE, WebRTC, unix socket, bridge."* True, but they are **not** in `packages/` — they live at `packages/exchange/transports/{websocket,sse,webrtc,unix-socket,bridge}`, declared via the `packages/exchange/transports/*` line in `pnpm-workspace.yaml`. Stores are likewise at `packages/exchange/stores/*`. Worth recording because `ls packages/` makes them look absent.

Mandated sanity check, passing:

```
stepInPlace       : function          <- the da978ec fix is present
loro-crdt         : 1.16.1            <- above the >=1.13.4 floor
@kyneta/schema    : 3.0.0  (local)    @kyneta/exchange : 3.0.0 (local)
@kyneta/ws-transp : 3.0.0  (local)
ws/browser exports: DEFAULT_FRAGMENT_THRESHOLD, READY_STATE, WebsocketClientTransport,
                    createWebsocketClient, createWsClientProgram
```

Only external dependency: `ws@8.18.3` (Node websocket **server**; Node 24's global `WebSocket` is the client).

### Was a browser exercised? **NO.**

I want to be unambiguous, because the spike is named "browser transport":

- **Exercised:** the `@kyneta/websocket-transport/browser` entry point — `WebsocketClientTransport`, the exact module a browser loads — driven by Node 24's global `WebSocket`, over a real `ws://` socket to a real `ws` server bound to `WebsocketServerTransport`.
- **NOT exercised:** any browser runtime, bundler, page lifecycle, tab suspension, `BroadcastChannel`, IndexedDB store, or browser websocket implementation.

Host and client Exchanges run in **one Node process**. The transport is real (real TCP, real CBOR framing, real fragmentation); only the OS process boundary is elided. This was deliberate: it makes `performance.now()` a shared clock so the latency figures are exact rather than clock-skew estimates.

### The delta stream is REAL, not synthesised

`capture.mjs` drove one real pi turn over RPC (`cerebras/qwen-3.8-27b`, `--no-tools --no-skills --thinking off`) and recorded every `text_delta` with real inter-delta timing:

```
captured 94 text_delta frames, 2702 chars over 464ms
observed rate: 202.6 deltas/sec
delta size: mean 28.7 chars (min 1, max 66)
inter-delta gap p50=4.9ms max=20.1ms
first 200 chars: "A token-bucket rate limiter and a sliding-window log are two fundamentally
different approaches to controlling request throughput, distinguished primarily by how they
handle sudden spikes, their memor"
```

Saved to `deltas.json` and replayed identically in every condition. **Note the real rate is 202.6/s — 4× the 50/s the brief targets.** Every condition was replayed at both the captured pacing and a fixed 50/s.

*(My first capture attempt read `m.frame.type`; the field is `m.assistantMessageEvent.type`. `docs/rpc.md:953` documents it correctly — my error, not a doc discrepancy.)*

### Files and commands

| File | Purpose |
|---|---|
| `harness.mjs` | real `ws` server + Exchange pair, byte/frame counters on the socket |
| `capture.mjs` | drives one real pi turn → `deltas.json` |
| `e1-commands.mjs` | Q1 — Line carries commands |
| `e2-streaming.mjs` | Q2/Q3 — three streaming conditions, poll + subscribe observers |
| `e3-hydration.mjs` | Q4 — reconstruction fidelity + mid-stream attach |
| `e4-commit-cost.mjs` / `e5-compaction.mjs` | durable history residue; can compaction reclaim it |
| `e6-line-bounded.mjs` | does the command Line stay bounded |
| `probe-ephemeral{,2}.mjs`, `probe-outlier.mjs` | root-cause probes |

```sh
./relink.sh && node smoke.mjs
node capture.mjs
node e1-commands.mjs ; node e2-streaming.mjs ; node e3-hydration.mjs
node e4-commit-cost.mjs ; node e5-compaction.mjs ; node e6-line-bounded.mjs
```

---

## 3. Evidence

### 3.1 Q1 — the Line carries agent command traffic (E1: 10/10, stable ×3)

Protocol modelled on pi's `AgentController` facade (`services/agent-controller.d.ts`): an asymmetric Line, client sends `Command`, host replies `Reply{accepted, operationId, errorCode}`.

```
  PASS  all 7 command kinds round-tripped (8ms)
  PASS  host received 7/7 commands
  PASS  commands arrived IN ORDER: prompt,steer,followUp,abort,compact,navigate,fold
  PASS  all 7 replies accepted
  PASS  lane name (ADR-0011 writer identity) survived the wire
  PASS  payload intact: "payload for prompt"
  PASS  structured rejection returned: {"id":"bad","accepted":false,"operationId":"",
        "errorCode":"unknown_entry","errorMessage":"no entry does-not-exist"}
  PASS  200/200 rapid commands acknowledged
  PASS  burst of 200 preserved total order
  PASS  sequential RTT p50 = 1.65ms (< 50ms)
```

Latency, one command in flight at a time (40 samples):

```
{"n":40,"min":0.34,"p50":1.68,"p90":1.83,"p99":157.61,"max":157.61,"mean":5.35}
```

**The p99 is one sample, and it is explained.** Per-sample output shows it is sample **#0** only:

```
157.6, 1.9, 1.8, 1.9, 1.8, 0.5, 1.7, 0.4, 1.7, 1.8, 0.5, 1.6, 0.3, 1.7, …
```

That first sequential command runs immediately after the 200-command burst, while the Line drains and prunes its backlog. A clean sequential run with no preceding burst has **no outlier at all** (`probe-outlier.mjs`: all 40 samples 0.52–3.23 ms, `samples > 20ms: []`). So: **a one-time ~150 ms stall after a large burst, attributable to outbox prune + compaction at quiescence**, not a recurring tail.

Throughput: 200 command/reply pairs in ~190 ms ≈ **1 050 commands/sec**.

### 3.2 Q2/Q3 — the three streaming conditions (E2)

Identical stream, pacing, harness and observers across all three; only substrate/shape differs (S13's control discipline). Two independent observers, so *"did state arrive"* is separated from *"was the client told"*:

- **POLL** — 1 ms polling loop → arrival latency + coverage
- **SUBSCRIBE** — `subscribe()` callback → reactive notification

```
PACING: captured (202.6/s)
  condition           coverage   subFires  p50     p99      bytes→cli   final-ok
  A DURABLE-LIST      100%       94        1.78    14.96    20348       true
  B EPHEMERAL-ACC     98.9%      0         1.32    1.98     139643      true
  C EPHEMERAL-DELTA   98.9%      0         1.31    1.69     13602       true

PACING: 50/s fixed
  A DURABLE-LIST      100%       94        1.30    2.46     20348       true
  B EPHEMERAL-ACC     98.9%      0         1.42    1.61     139643      true
  C EPHEMERAL-DELTA   98.9%      0         1.40    1.70     13602       true
```

Byte figures are **bit-identical across runs** (deterministic); latency reproduces within noise (rep 2: A p50 1.70/1.19, B 1.31/1.39, C 1.31/1.34).

Three things to read out of this table:

1. **The document layer is not saturated.** At 4× the target rate, A delivers 100 % of deltas at p50 1.78 ms. The kill criterion required delta rates to saturate the doc layer; they do not.
2. **B is quadratic on the wire.** 139 643 bytes vs A's 20 348 — **6.9×** — because ephemeral is snapshot-only (`ephemeral.ts:16`: *"Because it is snapshot-only (`SYNC_EPHEMERAL`), it has no delta-sync log (`exportSince` returns `null`)"*), so every update resends the whole accumulated prefix. The arithmetic confirms it: sum of all prefix lengths = **127 218 chars** vs the message's 2 702.
3. **`subFires = 0` for both ephemeral conditions.** State arrived correctly (`final-ok true`), but the client was never notified. That is the finding in §3.3.

A's per-delta cost is 216 bytes for a mean 28.7-char delta — ~7.5× overhead, which is the price of op metadata.

### 3.3 DEFECT — ephemeral presence never notifies on remote arrival

Isolated with a control that exercises the identical configuration (`probe-ephemeral2.mjs` — same exchange pair, same transport, same `subscribe()` API, same write loop; only the binding differs):

```
ephemeral LOCAL writes  -> subscribe fires: 5 (expect 5)
ephemeral REMOTE arrive -> subscribe fires: 0   client.seq = 10  (expect 5 fires, seq 10)
json     REMOTE arrive  -> subscribe fires: 5   client.seq = 5   (expect 5 fires, seq 5)
```

So: ephemeral notifies fine for **local** writes; the authoritative `json` substrate notifies fine for **remote** arrivals; ephemeral **remote arrivals are silent** while the data itself lands correctly.

**Root cause — two sibling code paths in `packages/schema/src/substrates/ephemeral.ts` disagree.** `merge()` (the remote path) pushes a wake-up op and then calls the substrate hook directly, discarding what it returns:

```ts
// merge(), ephemeral.ts:429-451
core.pendingOps.push({
  path: RawPath.empty,
  // The shadow itself, deliberately: this op exists to wake
  // subscribers, and its payload is never read.
  change: replaceChange(trustAsOwned(shadow)),
})
substrate.afterBatch(replayOptions)      // <- return value dropped
```

`afterBatch` (`ephemeral.ts:355-376`) merely **returns** the flushed ops (`return flushed.length > 0 ? [flushed] : []`) — it does not deliver them. The decay path `tick()` does it correctly, routing through the writable context and saying so in its own comment:

```ts
// tick(), ephemeral.ts:~493
// Route through the writable context's batch machinery so the
// changefeed fires for local subscribers.
ctx.runBatch(() => { ctx.prepare(RawPath.empty, replaceChange(trustAsOwned(shadow)),
                                 { replay: true, projection: true }) }, …)
```

And `writable.ts:217-220` states the rule `merge()` breaks: *"`flush` — deliver accumulated notifications as a single Changeset per subscriber… **Replay batches call `flush` directly without entering `runBatch`.**"* `merge()` calls neither.

The intent is unambiguous from its own comment (*"Fire a blanket root replace event so subscribers update"*), so this reads as a **Kyneta bug, not a design choice**. Until fixed, ephemeral presence is usable only by polling.

### 3.4 Q4 — hydration and reconstruction (E3: 3/3, stable ×3)

A client attaches **mid-stream, after delta 50 of 94**, and each condition's renderer rebuilds the message the way it naturally would.

```
--- A DURABLE-LIST (loro list append) ---
  early client rebuild : 2702/2702 chars  exact=true
  late  client rebuild : 2702/2702 chars  exact=true
  late has the PREFIX  : true

--- B EPHEMERAL-ACC (full text each update) ---
  early client rebuild : 2702/2702 chars  exact=true
  late  client rebuild : 2702/2702 chars  exact=true
  late has the PREFIX  : true

--- C EPHEMERAL-DELTA (newest delta only, renderer accumulates) ---
  early client rebuild : 2701/2702 chars  exact=false
  late  client rebuild : 1260/2702 chars  exact=false
  late has the PREFIX  : false
  late starts with     : " the moving time frame. This memory footprint scales linearly with tra"
  FULL  starts with    : "A token-bucket rate limiter and a sliding-window log are two fundament"
```

**The sharpest result in this spike is C's *early* client: 2701/2702.** A client connected for the entire stream still lost a character, because ephemeral LWW coalesced two updates and the intermediate value was never observable. That is silent, permanent text loss on a fully-connected client — strictly worse than the late-joiner hazard S2/S14 anticipated, and it is *not* repairable by reconnecting.

The late joiner then loses the whole 1 442-char prefix, reproducing the S2/S14 hazard exactly.

B self-heals (each snapshot carries the full prefix) and A is correct by construction (the list holds every frame).

### 3.5 The cost of DURABLE: permanent history residue (E4/E5)

pi's shape appends `pi.pending.assistant_frame` ops then deletes them on commit. Does deleting reclaim the cost? Measured as **what a late joiner must download**, with a control that never streamed:

```
  scenario                          snap-before  snap-after  late-joiner-bytes  correct
  never streamed (control)          4405         4405        6061               true
  streamed + committed              11347        11347       15646              true
  streamed + committed + compact    11347        11347       15654              true
  never streamed + compact          4405         4405        6061               true

  residue WITHOUT compaction : 9585 bytes (2.58x control)
  residue WITH compaction    : 9593 bytes (2.58x control)
  compact() call result      : ERROR: advance() on a live Loro substrate is not yet
                               supported. Use advance() on a LoroReplica instead.
```

Two findings:

1. **Streaming 94 deltas through the durable doc leaves ~9.6 KB of permanent history** for a 2 702-char message — 2.58× the never-streamed document — paid by **every future late joiner, forever**, even though the pending list is empty and the committed entry is intact.
2. **`exchange.compact()` throws on a live Loro substrate**, so that residue cannot be reclaimed today. Note `Line.#pruneOutbox` calls exactly this API at quiescence and swallows the result (`.catch(() => {})`); Line docs are `json.bind()`-ed so they are unaffected, but any Loro-doc caller would get a silent no-op.

### 3.6 The command Line stays bounded (E6)

```
compact() on a json/plain doc : ok

  batch   bytes→host    bytes→client   bytes/cmd   cum.replies
  0       208100        195600         832.4       250
  1       209031        196531         836.1       500
  …
  7       210030        197530         840.1       2000

  bytes/command first batch : 832.4
  bytes/command last batch  : 840.1
  growth factor             : 1.01x
  verdict                   : BOUNDED (flat)
  all 2000 commands acked   : true
```

Ack-based pruning works: 2 000 commands, **1.01× growth**, all acked. And `compact()` *does* work on the plain substrate — so the failure in §3.5 is specific to Loro-backed docs.

### 3.7 Gotcha — structurally identical client/server schemas collide

An asymmetric protocol whose two schemas have the *same shape* breaks:

```
Error: Document 'line:o:client→host' already exists with a different BoundSchema.
```

`line.ts` documents the mechanism: *"two calls produce distinct references with the same schemaHash, and the capabilities registry overwrites on duplicate hashes."* `Line.protocol({client, server})` calls `json.bind()` twice, so if `client` and `server` are structurally identical the two `BoundSchema`s collide. **Use the symmetric form `{schema}` when both directions carry the same shape.** E1 was unaffected (`Command` and `Reply` differ); my probe hit it and was fixed by switching to `{schema}`.

---

## 4. Consequences for the plan

**ADR-0007 is CONFIRMED.** Commands over a Line, state over replicated docs, works end to end over a real websocket at rates well above what a coding agent produces. No bespoke protocol needed. The CQRS split is sound.

**The S4 sub-question is ANSWERED — and against the brief's leading hypothesis.** The brief framed it as *"should token deltas ride ephemeral presence or the durable doc?"*, with the kill criterion anticipating a move **to** presence. The measurements say the opposite:

| | A DURABLE-LIST | B EPHEMERAL-ACC | C EPHEMERAL-DELTA |
|---|---|---|---|
| reactive notification | **94/94** | **0** ✗ | **0** ✗ |
| delta coverage | **100 %** | 98.9 % | 98.9 % |
| connected client renders exactly | **yes** | yes | **no (2701/2702)** ✗ |
| mid-stream joiner renders exactly | **yes** | yes | **no (1260/2702)** ✗ |
| live wire bytes | 20 348 | 139 643 (6.9×) | 13 602 |
| permanent history residue | **9 585 B** ✗ | none | none |

**Recommendation: stream token deltas on the DURABLE doc (A) for v1.** It is the only option that both notifies reactively and reconstructs exactly, and its latency at 4× the real delta rate is 1.8 ms. Mirror pi's own shape — append to a pending list, delete on commit — since that is already the storage-v4 pattern S2 observed.

**The tradeoff being accepted, stated plainly:** ~9.6 KB of unreclaimable history per streamed message (3.5× the message's own size), paid by every future late joiner. For a long session this is the dominant growth term and it is **not** currently reclaimable, because `compact()` throws on Loro docs. Two escapes exist, neither verified here: keep pending frames in a **separate, disposable Loro doc per message** (destroy it on commit, so the residue never enters the session doc), or fix/await Loro-substrate compaction. **The separate-doc option looks strictly better and should be the first thing S4's successor tests** — it preserves A's correctness with none of its residue.

**B becomes the better answer if two things change:** the notification defect is fixed, and the O(n²) wire cost is mitigated (send a windowed tail rather than the whole prefix). B is the only condition with correct hydration *and* zero history cost, so it is the right long-term destination — just not reachable today.

**C is disqualified outright.** Not merely "late joiners miss the prefix" (the known hazard) but **silent permanent text loss on a fully-connected client**. No amount of reconnection repairs it. It should not appear in any design.

**Two Kyneta defects to report**, both with reproductions in this sandbox:

1. **`ephemeral` remote `merge()` does not notify subscribers** (§3.3). Root-caused to `merge()` calling `substrate.afterBatch()` and discarding the ops, where the sibling `tick()` path correctly routes through `ctx.runBatch`. The code's own comment says it intends to wake subscribers. This is the blocker that disqualifies presence for reactive UI.
2. **`exchange.compact()` throws on a live Loro substrate** (§3.5) — *"advance() on a live Loro substrate is not yet supported."* Works on plain/json. `Line.#pruneOutbox` calls it inside `.catch(() => {})`, so for a Loro doc it fails silently.

**A correction for `01-architecture.md`** (§2): the transports are at `packages/exchange/transports/*`, not `packages/*`.

**S10 gains a concrete input.** The per-message durable residue (9.6 KB per 2.7 KB message) is exactly the sync-payload growth S10 still owns; §3.5's control-vs-streamed comparison is a ready-made measurement method.

---

## 5. Residual unknowns (NOT resolved)

1. **No browser was run.** The browser *module* was exercised under Node (§2). Browser websocket behaviour, bundling, tab suspension/backgrounding, and the IndexedDB store are all untested — and tab suspension in particular interacts badly with presence liveness.
2. **Single process.** Host and client share an event loop. Real deployments add process/network scheduling; the sub-2 ms latencies are a floor, not a forecast. No WAN latency, loss, jitter, or bandwidth limit was simulated.
3. **One client, one stream.** No concurrency: not N clients on one host, not two lanes streaming at once, not the ADR-0011 multi-writer case. Byte costs per client are additive but unmeasured.
4. **No reconnection.** `reconnect: { enabled: false }` throughout. Line resume-after-disconnect (the `ackLineage` path) is untested, and it is precisely the path a real browser exercises constantly.
5. **No persistence.** No store backend; everything in memory. Whether a store changes the residue picture is unknown.
6. **The separate-disposable-doc mitigation is untested** (§4). I recommend it on the strength of E4/E5's decomposition, not on measurement.
7. **Commands were driven against a stub host.** E1's host replies immediately; it is not a real `AgentHarness`. Line↔harness integration (S3's territory) is untouched.
8. **Only `text_delta`.** No `thinking_delta`, no `toolcall_delta`, no large tool results — which are the payloads most likely to stress fragmentation.
9. **One capture, one model.** 94 deltas at 202.6/s from `cerebras/qwen-3.8-27b`. Slower providers, longer messages, and bursty stalls are unmeasured; the message is ~2.7 KB where real turns run much larger.
10. **The ephemeral defect was root-caused by reading, not by patching.** I did not modify Kyneta (prohibited) so I did not confirm that routing `merge()` through `ctx.runBatch` fixes it.
11. **`compact()`'s Loro limitation was observed, not investigated.** Whether `LoroReplica.advance()` offers a usable path for a live document is unexamined.

---

## 6. Verified vs. assumed

**Verified by execution in this sandbox:**
- The sanity check (`stepInPlace` a function; `loro-crdt` 1.16.1) on every run.
- E1 10/10 across 3 reps; all 7 command kinds, ordering under a 200-burst, structured rejection, lane-name survival; sequential RTT p50 1.65–1.70 ms across reps; the 157 ms outlier being sample #0 and absent from a clean run.
- E2's full table at both pacings, 2 reps — byte counts bit-identical, latencies within noise.
- The ephemeral notification defect, with the `json` control under identical configuration.
- E3 across 3 reps with identical figures (2702/2702, 2702/2702, 2701/2702 and 1260/2702).
- E4/E5 byte accounting including the never-streamed control, and the verbatim `compact()` error.
- E6: 2 000 commands, 1.01× growth, all acked; `compact()` succeeding on a plain doc.
- The `BoundSchema` hash collision for structurally identical asymmetric schemas.
- Every quoted line of `ephemeral.ts`, `writable.ts`, `line.ts` read from the files at the cited locations.
- Read-only compliance: **zero** files under `~/halecraft/kyneta` or any sibling sandbox modified since this spike began; the 19 files `git status` reports as modified are exactly `da978ec`'s own 19-file set, pre-existing. `~/.pi` still 11 session dirs.

**Assumed, not verified:**
- That the ephemeral defect's fix is to route `merge()` through the changefeed flush — inferred from the `tick()` sibling path and `writable.ts`'s stated flush rule, not tested.
- That in-process results predict cross-process/browser behaviour for *correctness* (coverage, hydration, ordering). Latency explicitly does not transfer.
- That the 9.6 KB residue scales linearly with message length; measured at one size only.
- That `Line`'s json-bound docs are unaffected by the Loro `compact()` failure — inferred from `line.ts` using `json.bind()`, and consistent with E6's flat growth, but the two were not connected by a direct test.
- That `cerebras/qwen-3.8-27b`'s 202.6/s delta rate is representative of the fast end of the range.

## Review

**Verdict:** PASS (and it inverted the hypothesis)

Re-verified: E2's table and
E3's 2701/2702 reproduce exactly.

- **ADR-0007 confirmed** over a real websocket: 7 command kinds in order,
  p50 **1.67 ms**, ~1 050 cmd/s, 2 000 commands at **1.01×** outbox growth.
- **Used a REAL captured pi stream**, not a synthetic one — and found the real
  rate is **202.6 deltas/sec, 4× the 50/s** the brief assumed.
- **The design question resolved AGAINST the brief's hypothesis** — durable, not
  presence. See ADR-0014.
- **Honest about scope:** the browser *module* was exercised under Node over a
  real socket; **no browser runtime was run**, and it says so unambiguously.
  Host and client share a process, so latencies are a floor, not a forecast.
- **Explained its own outlier** instead of just reporting it: the p99 157 ms was
  sample #0 only — a one-time post-burst outbox prune; a clean run has no tail.
- Spawned **S16**; gave **S10** a concrete measurement method.
