# WS1 — The walking skeleton

**Date:** 2026-09-21 · **Repo:** the repo root (source at root; tracked)
**Build:** local Kyneta workspace via symlink · `loro-crdt` 1.16.3 · Node v24.19.0
**Model:** `cerebras/qwen-3.8-27b`

> **Provenance note.** The build subagent (`7af358ce`) wrote all the code but
> **timed out at 30 minutes before writing this report**, after getting stuck
> trying to drive a real browser through Playwright. Everything below was
> verified by the orchestrator re-running the acceptance set directly. Two
> follow-ups were completed by hand: `scripts/sanity.mjs` (referenced by
> `package.json` but never written) and a display bug in it.

---

## 1. VERDICT

**It walks, end to end, through every layer, with a real model turn.**

```
browser page ─┐
              ├─ Kyneta Line (websocket) ─ Node host ─ pi-agent-core AgentHarness
Node client ──┘                                              │
                                                    KynetaStorage (ADR-0013)
                                                             │
                              Loro doc ── replicated back ── ┘
```

| layer | real or stubbed |
|---|---|
| storage (`KynetaStorage`, seq dissolved) | **real** — the S1 adapter |
| `AgentHarness` + drive loop | **real** — model actually called |
| Kyneta document + replication | **real** |
| Line command protocol | **real** |
| Node client | **real** |
| browser page + bundle | **real — verified by hand in a browser (see §3.6)** |

`e2e: pass=20 fail=0` including a live turn where the model was asked to emit a
token and did.

---

## 2. How to run it

```bash
cd the repo root
./relink.sh            # symlink local Kyneta; npm install DELETES these, re-run after
npm run sanity         # refuse to run on a stale Kyneta / old loro
npm run check          # import-boundary rules
npm test               # pure core/ tests
npm run e2e            # browser-free end to end
npm run e2e:live       # … and assert on real model output
npm run build:client   # esbuild → client/app.bundle.js
npm run host           # serve the page + websocket
```

---

## 3. Evidence

### 3.1 Module boundaries — the point of the exercise

```
module dependency map (as built)

  core      -> — nothing —
  schema    -> kyneta
  protocol  -> kyneta
  storage   -> kyneta, pi, schema/
  host      -> core/, kyneta, node:*, protocol/, schema/, storage/, ws
  client    -> core/, kyneta, protocol/, schema/
  e2e       -> client/, core/, host/, schema/
  test      -> core/, node:*
  scripts   -> esbuild, node:*

  modules importing pi: storage

check: ok — all boundary rules hold
```

**`core` imports nothing. Exactly one module imports pi.** ADR-0003's
"single deep coupling" is now mechanically enforced rather than aspirational.

*Deviation from the brief:* `protocol/` imports Kyneta. The brief said it should
import neither pi nor Kyneta. This is acceptable — a Line schema *is* a Kyneta
schema, so `Schema`/`json.bind` are unavoidable, and these are public API rather
than internals. Worth revisiting only if we ever want the protocol consumed by a
non-Kyneta client.

### 3.2 Pure core tests

```
✔ projectTranscript: non-message entries and unknown roles are dropped
✔ projectTranscript: a cycle is reported, not spun on
✔ messageText: flattens pi's content parts
✔ compareVersions / checkEnvironment: the deterministic build guards
ℹ tests 11 · pass 11 · fail 0
```

### 3.3 End to end, offline (16/16)

```
  PASS  prompt accepted, runId issued (d24ef90c)
[host] run d24ef90c done
  PASS  committed entries replicated to the client (213ms)
  PASS  lane name carries writer identity, not "main": w-01a0c675-6736-7527-8c6e-d3c725a80441
  PASS  client and host agree on the lane name
  PASS  transcript ordered by parentId walk: [user, assistant]
  PASS  user turn round-tripped: "hello"
  PASS  assistant replied (26 chars)
  PASS  client observed 15 live streaming updates
  PASS  streamed text grew monotonically (insert(at, delta), never a whole-value replace)
  PASS  pendingText cleared on commit
  PASS  no entry in the replicated document carries a stored seq (2 entries checked)
  PASS  no seq key on any wire message (2 replies checked)
  PASS  lane tip in the document matches the harness's own tip
  PASS  host and client project the same transcript (2 messages)

--- final client view ---
  user      "hello"
  assistant "Hello, how can I help you?"

=== e2e: pass=16 fail=0 ===
```

### 3.4 End to end, live model (20/20)

```
  PASS  live turn completed and replicated (143ms)
  model said: "PINETA-OK"
  PASS  model output contains the requested token
  PASS  live turn streamed 13 updates through Schema.text()

--- final client view ---
  user      "hello"
  assistant "Hello, how can I help you?"
  user      "Say exactly: PINETA-OK"
  assistant "PINETA-OK"

=== e2e: pass=20 fail=0 ===
```

### 3.5 The host serves the browser page

```
[host] env ok — loro-crdt 1.16.3, node v24.19.0, stepInPlace present
[host] agent ready — model cerebras/qwen-3.8-27b, lane w-01a0c681-…

  /                    status=200 bytes=2049
  /app.js              status=200 bytes=771082
  /loro_wasm_bg.wasm   status=200 bytes=3269100
```

The host runs the same sanity gate at startup and refuses to start on a stale build.

### 3.6 Browser — verified by hand ✅

Four turns in a real browser, rendering live:

```
Pineta — walking skeleton
status connected · lane w-01a0c688-1a27-7476-88e9-b6b862196f4b · entries 6
  user       PINETA-OK
  assistant  Walking-skeleton harness ready for the PINETA scenario.
  user       Hi
  assistant  Hello!
  user       What can you do?
  assistant  I respond to the PINETA walking-skeleton command with predefined status updates.
```

Six entries across four turns — so streaming, commit, replication and the
`parentId` transcript walk all hold in the browser, not just in the Node client.
The lane name again carries writer identity (ADR-0011).

*(The assistant's self-description is faithful to the system prompt set at
`storage/pi.mjs:75`, not a canned response — these are real model turns.)*

### 3.7 Browser — AUTOMATED ✅ `e2e/browser.mjs`

```
=== Pineta — real browser against a real host ===
  playwright server : ws://localhost:3100/
  browser           : 141.0.7390.37
  host              : http://localhost:49790/

  PASS  page loaded, wasm instantiated, client connected to the host
  PASS  no page errors during load
  PASS  lane carries writer identity, not "main": w-01a0d558-e992-75c2-92bc-3570493e4ee5
  PASS  streaming text appeared in the DOM while the turn was running
  PASS  assistant reply rendered in the DOM
  PASS  transcript ordered by parentId walk: [user, assistant]
  PASS  no page errors overall

=== browser e2e: pass=7 fail=0 ===
```

**How it works, and why it must.** Chromium cannot be *launched* inside the
jail: Seatbelt denies `mach-register`, and Chromium must register
`MachPortRendezvousServer` via `bootstrap_check_in` to reach its own child
processes — `Permission denied (1100)`. It can, however, be *driven* from
inside: the jail does not restrict loopback, and `chromium.connect()` is pure
websocket (verified — it fails `ECONNREFUSED`, never attempting a local launch).
So the operator owns the browser process, the agent owns the automation:

```bash
pnpm exec playwright run-server --port 3100   # outside the jail
pnpm run e2e:browser                          # inside
```

**Upstream:** `anthropics/sandbox-runtime` **#210** (open since 2026-04-06, zero
comments) reports this exact failure. PR **#407** implemented `allowMachRegister`
and was **closed unmerged** (2026-08-26). Neither srt 0.0.75 (bundled in pi
0.85–0.87.1) nor 0.0.77 (latest) can emit `mach-register`, so no pi upgrade
fixes it.

**What this catches that the Node e2e cannot:** wasm instantiation (where the
`LinkError` struck), any `pageerror`/console error, and streaming visible in the
**DOM** mid-turn — ADR-0014's `Schema.text()` insert path observed through real
rendering rather than asserted against a document.

**Two defects were found and fixed getting here**, both invisible to the Node
e2e because it never loads the bundle:

1. **wasm / JS-glue version mismatch** — `LinkError: __wbg_error_… is not a
   Function`. `scripts/build-client.mjs` hardcoded
   `node_modules/loro-crdt/bundler/loro_wasm_bg.wasm` while esbuild resolved
   `loro-crdt` through Node resolution (following our symlink into Kyneta's
   pnpm store). They pointed at different copies; the served wasm matched
   *neither* the resolved 1.16.1 nor the 1.16.3 in `.ignored_loro-crdt`.
   Fixed by resolving the wasm from the same module esbuild bundles
   (`require.resolve("loro-crdt/bundler/loro_wasm_bg.wasm")`), and the build now
   prints the version and path it used.
   > **Missed signal:** `npm run sanity` reported loro-crdt **1.16.3** while the
   > host reported **1.16.1** in the same session. Two resolutions of one
   > package is the smoking gun; it was explained away as a display artifact.
2. **`EADDRINUSE` gave a bare stack trace.** A stale host holding port 7391 is
   the most likely startup failure and said nothing about recovery. It now
   fails with find/stop/alternate-port instructions; `PINETA_PORT=0` takes any
   free port.

---

## 4. What this proves that twelve spikes could not

Every spike validated one layer in isolation; **no two had ever been connected.**
Three residual-unknown entries are now closed:

1. **The drive loop runs over `KynetaStorage`.** S3 stubbed the model and never
   called `prompt()`; S3 residual #1, S1 residual #1 and S2 residual #5 all
   carried this forward. A real `AgentHarness` now drives a real turn against a
   real model through the S1 adapter. **Closed.**
2. **ADR-0014's `Schema.text()` survives real pending-frame handling.** The
   decision rested on a standalone probe. The e2e asserts the streamed text grows
   **monotonically via `insert(at, delta)` and never as a whole-value replace**,
   and that `pendingText` is cleared on commit. 13–15 live updates per turn.
3. **ADR-0013's constraint holds against a real client.** Asserted directly: no
   entry in the replicated document carries a stored `seq`, and no wire message
   carries a `seq` key. `seq` does not escape its replica.
4. **The Line protocol drives a real harness**, not S4's immediate-reply stub —
   prompt → runId → streaming → commit → replication.
5. **ADR-0011 is honoured even with one writer** — the lane is
   `w-01a0c681-…`, derived from a peer id, never `"main"`.

---

## 5. Residual unknowns

1. ~~No browser runtime executed the bundle.~~ **FULLY CLOSED — now automated**
   (§3.7): `pnpm run e2e:browser`, 7/7, stable across runs.
   *Caveat:* requires a Playwright server started **outside** the jail. There is
   no self-contained path until sandbox-runtime#210 lands.
2. **One client, one lane, one writer.** No concurrency, no second peer, no
   partition — all deliberately out of scope.
3. **No persistence.** In-memory only; no store backend wired.
4. **No reconnection.** The Line's resume-after-disconnect path is untouched.
5. **Everything excluded by design remains excluded:** tree UI, branching,
   Aside/Scout, references, fold, trunk/promotions, presence, compaction, auth.
6. **`scripts/sanity.mjs` was written by the orchestrator**, not the build agent,
   and is the one file not produced by the same hand as the rest.

---

## 6. Verified vs assumed

**Verified by execution:** the boundary checker's full output; 11/11 core tests;
16/16 offline e2e; 20/20 live e2e including the model emitting `PINETA-OK`;
HTTP 200 for page, bundle and wasm; the host's startup sanity gate;
`stepInPlace` present and loro-crdt 1.16.3 ≥ the 1.13.4 floor.

**Assumed, not verified:** that the served bundle executes correctly in a
browser (item 1 above); that in-process host+client latency predicts
cross-process behaviour (it does not, and no claim is made).

### Addendum — conformance re-run from this repo

The last assumption above has been closed. pi's 21-case `Storage` conformance
suite was re-pointed at the **vendored** `storage/kyneta-storage.mjs` and run
from this repo, with pi's own `MemoryStorage` as the control:

```
=== Storage conformance: kyneta ===   TOTAL: 21/21 passed, 0 failed
=== Storage conformance: memory ===   TOTAL: 21/21 passed, 0 failed
```

Harness kept at `test/conformance/run-conformance.mjs`. **This should be wired
into `npm test`** — `04-roadmap.md` lists "pi's conformance suite in CI" as a
fitness function, and it is currently a manual invocation.
