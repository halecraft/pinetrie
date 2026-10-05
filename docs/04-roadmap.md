# Roadmap

## Shape

```
  spikes  ──►  walking skeleton  ──►  thicken  ──►  v1 demo
(kill bad          (thinnest          (tree, refs,    (two windows,
 assumptions)       end-to-end)        branches)       one tree)
```

Deliberately **not** a phase list of features. The gate is the spikes; the
spine is the skeleton; features thicken the spine.

## Gate — spikes ✅ PASSED

**S5, S2, S7 all returned PASS.** The three load-bearing questions are answered:
the product thesis holds (S5), the `Storage` port is real and satisfiable (S2),
and the document shape keeps divergent branches distinct (S7). No ADR was
invalidated; two were added (0009, 0010) and several were confirmed empirically
rather than by citation.

**The gate did its job in an unexpected direction.** No spike failed, but the
biggest new risk came from a *non-contractual* finding: `@kyneta/schema` write
throughput is quadratic (S2 §3.4). That is now **S11**, the highest-priority
remaining spike, because it is first-party code sitting under our two unbounded
containers and it gates the document-granularity decision.

**Remaining before the skeleton:**

- **S11** — root-cause the quadratic write. Gates document granularity.
- **S8** — `pi.branch.tip` is the one *known-contended* LWW register, and the v1
  demo depends on it.
- **S3** — can the harness tolerate foreign writes? Still the single largest
  scope fork: storage project vs. harness project. S2/T5 narrowed it — the
  single-writer mutex is contract-mandated, so the question is now precisely
  "can that mutex be per-replica?"

## Walking skeleton

Thinnest possible end-to-end path, deliberately trivial at every layer:

> one prompt → one entry → one Kyneta doc → one browser render

No tree UI. No branching. No references. No merge.

This matters more than usual because the system has five layers (browser /
transport / host / harness / storage) and the integration risk sits at the
**seams**, not inside any layer. A skeleton surfaces seam problems in week two
instead of month three, and gives a demo target that keeps the project legible.

## Thicken

Roughly in dependency order, each independently shippable:

1. ~~**Tree read**~~ — **done.** `projectSpine` in `@pinetrie/core`; the client
   renders a linear spine with branches hanging off it, dimmed and labelled
   "not in your context". Two findings: step 1 is not demonstrable without
   branched data, so the e2e fixture writes a fork as a foreign write (S3);
   and **navigation turned out to be free**, because the selected tip is
   client-local state rather than a write. The spine view was later replaced
   by columns and a rail, and then by a tab per root, each with its own rail
   and columns (`docs/06-interface.md`, ADR-0029).
2. ~~**Branch write**~~ — **done**, both directions. *Superseded by ADR-0020:*
   lanes no longer move, so a branch is a new thread (and, when the agent is
   asked, a new lane) rather than a navigated one. A `branch` command names a
   parent; the host navigates there with pi's `navigateTree`, then prompts. A
   `navigate` command moves the lane and runs nothing, which is how you come
   back from an Aside — without it a branch was one-way, and "return to your
   lane" returned to the branch. Findings:
   - `navigate` is its own decision, not a `run`: no runId, no stream, and it
     must not mark the lane busy. The opposite call from `branch`, which is a
     run with a different attachment point.
   - Navigation is awaited BEFORE the host replies, so pi's refusal travels
     back as a structured rejection (`unknown_target`). A run's refusal still
     cannot: the host replies with the acceptance first.
   - A foreign-written entry is NOT navigable: pi's session index never saw it
     created.

3. ~~**Concurrent lanes**~~ — **done.** *Superseded by ADR-0020:* lanes belong
   to threads, not writers; threads run concurrently. (Originally: a lane and a turn per writer, keyed by
   the transport's peer id. Two windows run turns at once; neither moves the
   other's lane; streams do not mix. Findings: pi refuses to navigate to the
   current tip (so attachment is a decision with a `stay` outcome); pi ignores
   `createAt` for a lane that exists and throws for an unknown one; and pi
   records a lane on creation, which is what lets the document tell "no lane"
   from "a lane at the root".)
4. ~~**References**~~ — **done, then withdrawn** (ADR-0043). Stored as pi
   values in `pinetrie.reference` (ADR-0017); backlinks derived; attached where
   the author is reading. Nothing read them, so they were removed. The v1 demo
   runs in a real browser, minus presence.
5. **Humans in the tree** — reframed from "multi-writer composer" (ADR-0018).
   Split in three:
   - ~~**Chat and compelled responders**~~ — **done.** Human messages are pi
     `CustomMessage`s; a message that compels the agent is its prompt; a
     thread is agent work or a conversation, which since ADR-0021 is whether
     it has a lane, and mentions pick who a message is for.
     Findings (S19): append through the `Lane`, never the session; a pi run
     can only start with `prompt`.
   - ~~**Presence**~~ — **done** (ADR-0024): an ephemeral document, one entry
     per open column, decaying; rings on the rail, avatars in column headers,
     typing in the composer. The host refuses client writes to the session.
   - ~~**Self-hosting**~~ — **done** (ADR-0022): the development host's
     agent reads, writes, edits and runs commands in the repo, visibly, with the
     person's own pi models; stop, persistence, and an invite key off loopback.
     Then a workspace per lane (ADR-0032) and landing (ADR-0033), done; then
     a Linux container per lane on a disk cloned at its fork point, which is
     also the sandbox (ADR-0034), done. Next: the network as a grant, and
     skills readable in a lane.
   - **The session on `json.bind`** (ADR-0023): authoritative, compacted when a
     run ends and when the host starts; Loro removed.
   - ~~**Notes**~~ — **done** (ADR-0025): any message, the agent's included,
     can be opened for everyone to edit, and a thread's next message drafted
     together (which is what "shared composition" became). One Yjs document per
     note; the session holds its record; the entry stays as sent, and the model
     reads it so. Draft, open, done; contributors from each edit's `clientID`.
     Since removed by ADR-0048 (step 3): what you write is a card, and a
     branch from `→` carries a conversation about a message.
   - **Fold** (next). **Fold** brings what one line has and another lacks into the other,
     synthesized by the agent, as one merge entry on the target lane's tip whose
     `fromId` is the source's tip. What to fold is a set difference: everything
     reachable from the source's tip, minus everything reachable from the
     target's, over parent and `fromId` edges. So repeated folds take only what
     is new, criss-cross folds need no single common ancestor, and each target
     is its own destination (ADR-0010). A lane folds into a lane the
     same way; its files merge only once lanes have workspaces (ADR-0019). S26
     verifies: a `json` session and Yjs notes on one Exchange; rich text on Yjs;
     per-document write permission; pi appending an entry with `fromId`, and
     what reaches the model's context; and note hunks the model can use.
6. ~~**Scout kind**~~ — read-only tools, shared workspace. Obsolete under
   ADR-0032: every agent lane has its own workspace, so no lane needs a
   shared read-only one.
7. **Fold** — three-way merge producing a `fromId` node. Per ADR-0019 it is two
   merges, both agent-assisted: the branch of the tree, and the line of work's
   jj workspace.

Items 4–5 are independent of 1–3 and can proceed in parallel once the document
schema is fixed.

## v1 demo

Two browser windows, one pi host, one tree. A runs a long task on trunk; B
branches an Aside three turns back, asks, gets an answer, attaches a reference,
and it appears live in A's tree — **with zero tokens entering A's context.**

## Explicitly deferred

| Deferred | Until |
|---|---|
| Remote / team networking | designed for now (ADR-0007), shipped after v1 |
| Trust & authority model | before *any* networking; explicitly punted for local v1 |
| Replacing pi's TUI | indefinitely — not a goal |
| v4 JSONL exporter | on demand |

## Invariants to protect mechanically

Fitness functions, written early, so they cannot erode. These are what allow
aggressive refactoring later without fear:

- **pi's conformance suite** in CI against `KynetaStorage` — their tests, not ours
- **Convergence property test** — N random concurrent op streams, all replicas
  equal. This is the premise; test it like a premise.
  **Available now** from S7: `sandbox/s7-convergence/convergence.property.mjs`
  (2–4 peers, seeded PRNG, random sync interleavings). Needs only a test-runner
  wrapper. **Keep `negative-control.mjs` beside it** — it collapses the id space
  to force a failure, guarding against the property test silently going vacuous.
- **Entry id uniqueness** (ADR-0009) — enforce mechanically. Violation is silent
  conversation-data loss, not an error. **Concretely (S9): assert the configured
  `idGenerator` is pi's default**, unless a replacement has cleared S9's bar
  (no derivation from content/index/position; ≥ 2⁻⁰ pairwise cross-instance;
  structurally unique within a process). The default is verified safe; the
  *injection point* is the hazard.
- **pi's `Storage` conformance suite** — available now and passing 21/21 against
  the S2 adapter (`sandbox/s2-storage/run-conformance.mjs`). Keep
  `MemoryStorage` as the control run.
- **Deterministic build guards — prefer these over the stopwatch** (S14 §5).
  Timing budgets are machine-dependent and flaky in CI; these are not:
  ```js
  import { stepInPlace } from "@kyneta/schema"
  assert(typeof stepInPlace === "function")            // absent in npm 3.0.0
  assert(semverGte(loroCrdtVersion, "1.13.4"))         // floor respected
  ```
- **Write-throughput budget** (S14 §5, measured on the fixed build; median of 5):

  | | measured | budget | headroom |
  |---|---|---|---|
  | entries `record.set`, n=10 000 | **103 ms** | **≤ 1 000 ms** | ~10× |
  | pending list append, n=10 000 | **94 ms** | **≤ 500 ms** | ~5× |

  > **The entries budget TIGHTENS from 2 s to 1 s — this is the point.** S11's
  > 2 s figure is *too loose to catch a loro-crdt floor violation*: correct
  > Kyneta with loro below the floor runs ~1.8 s at n=10 000 and would slip
  > under it. 1 s trips on that, and still trips ~370× earlier on an unpatched
  > Kyneta republish (38 s). Keep wall-clock as a backstop for *new* regressions
  > the two markers above cannot see.
- **The `ours` leg is never dropped** (ADR-0010) — assert it in the budget
  ladder. Dropping it is a correctness bug, not a quality tradeoff.
- **Single-writer register fidelity** (ADR-0011) — a lane register's converged
  value must equal the last value its owner wrote. Available now:
  `sandbox/s8-tip/property.mjs`, with a `shared` negative control that fails
  0/300. **Use this, not reachability** — see below.
- **`seq` integrity under partition** — now **PASSING**. Promote
  `sandbox/s1-seq/seq.property.mjs` (P1–P6: no collisions, topological order,
  paginated reads return every entry exactly once, *including while merges land
  mid-pagination*), **with its `broken` negative control** (the old shared
  counter, 0/300).
- **`seq` never escapes its replica** (ADR-0013) — assert no cursor is persisted
  or transmitted as a durable identifier. Browser clients receive `seq` in
  transcript events and must treat it as an **opaque local ordering key**; entry
  `id` is the durable identifier. Nothing may render by seq order.

> **Fitness-function correction.** S3 proposed *"every entry is reachable from
> some branch tip."* **That invariant is invalid.** S8 tried it first and it
> failed 169/200 trials *even for the correct design*, because `navigateTree`
> **intentionally** orphans entries — abandoning a branch is what branching
> *is* (ADR-0004: entries are immutable, branches persist). Reachability is not
> an invariant once navigation exists. Use single-writer register fidelity
> instead. Two spikes disagreed; S8 had the evidence.
- **Entry immutability** — no code path mutates a committed entry
- **No eager summarization** — folds are additive; source branches survive verbatim
- **Single deep coupling** — nothing outside the storage adapter imports pi
  internals beyond the public `Storage`/lane API

## Churn management

`pi-agent-core` (pinned 0.87.1; was 0.85.0) is unreleased and moves in lockstep across seven
packages. Pin exact versions, vendor the type definitions we depend on, keep
`Storage` the only deep coupling, and run a scheduled "diff against upstream"
chore rather than discovering breakage at upgrade time.

Decide and record: **do we intend to upstream the `seq` work?** If yes, S1's
output is a proposal, not a workaround — which changes how it is built.

## Action items (not spikes)

1. **Republish `@kyneta/schema` + `@kyneta/loro-schema` — AND raise the declared
   peer floor.** This is the one that matters. Published 3.0.0 predates both
   `a5e2c8f` and `da978ec`, **and declares `loro-crdt >= 1.8.0`** where the
   working copy declares `>= 1.13.4`. S14 §4.2 shows why that combination is a
   trap: a republish shipping the code fix but keeping `>=1.8.0` lets consumers
   install a supported-looking setup that is **17× slower on the entries path,
   with no warning**. `da978ec` is breaking (`!`), so this is a version bump, not
   a patch. **Check whether other `@kyneta/*` packages are similarly stale.**
2. **Resolve the git/jj divergence.** `da978ec` is **not an ancestor of git
   `HEAD`** (`c84a5ca`); the working copy carries the fix and the dist is built
   from it, but a rebuild from git `HEAD` would silently lose it. Bookkeeping,
   not code — but it would bite a CI build or a fresh clone.
3. ~~**Land `fixB-reader.patch`**~~ — **done, superseded** by `da978ec`, which
   covers more cases (set-op, tree, middle inserts, deletes) and needs no
   `undefined` guard.
4. **Pin `loro-crdt >= 1.13.4` in pine·trie.** Every existing sandbox uses `1.10.8`.
5. **Decide the lane-naming scheme** (ADR-0011). Coordination-free and
   mechanically enforced; a collision is silent data loss.
6. **⚠️ Tell the Kyneta team that `kyneta-ephemeral-wire-cost.md` is WRONG.**
   It was sent before we tested `Schema.text()`. It attributes a quadratic wire
   cost to ephemeral/snapshot-only; the cost is actually from accumulating into
   a `Schema.string()` whole-value register, and reproduces identically on the
   **durable** substrate (144 582 B). Kyneta already solves this properly with
   `Schema.text()` (18 131 B). The report should be withdrawn, not fixed — there
   is no Kyneta defect there. Evidence: `sandbox/s4-transport/probe-text.mjs`,
   `probe-residue.mjs`.
   *Of the three filed: #1 `compact()` stands, #2 Line collision is fixed, #3 is
   invalid.*
7. ~~**Report two Kyneta defects**~~ — status after re-verification:
   - **`ephemeral` remote `merge()` never notifies subscribers.** State lands;
     `subscribe()` never fires. Root-caused: `merge()`
     (`substrates/ephemeral.ts:429-451`) calls `substrate.afterBatch()` and
     **discards its return value**, where the sibling `tick()` path correctly
     routes through `ctx.runBatch` — and says so in its own comment. The
     `merge()` comment states it intends to wake subscribers, so this reads as a
     bug, not a design choice. **This is what disqualifies presence for reactive
     UI** (ADR-0014). Control: the `json` substrate notifies correctly under an
     identical configuration.
   - **`exchange.compact()` throws on a live Loro substrate** — *"advance() on a
     live Loro substrate is not yet supported. Use advance() on a LoroReplica
     instead."* Works on plain/json. Note `Line.#pruneOutbox` calls it inside
     `.catch(() => {})`, so a Loro-doc caller gets a **silent no-op**.
8. **Exercise `@kyneta/react` + `@kyneta/devtools`** against the landed fix.
   S11 flagged object-identity assumptions as the main risk of in-place
   mutation; `da978ec` mutates *more* aggressively than S11's patch did, so the
   risk **grew**. Nothing in pine·trie's suites touches those packages.

## S17 — typed entries (resolved)

Entries are a typed Kyneta row, not `Schema.any()` (ADR-0015,
`findings/S17-typed-entries.md`).

One finding constrains **every future schema change in this repository**:
Kyneta's migration walk descends product-to-product fields only, so
`Schema.record` is a barrier and so is a sum. Nothing about the entry row is
migratable. A change to it is a coordinated upgrade, not a migration. A new
schema does still read old data locally, with absent fields taking defaults;
it is peer negotiation between different builds that is exposed.

Practical rule: keep the typed surface small and stable. Every typed field is
one that forces a coordinated upgrade if pi moves it.

## Open process questions

1. ~~**These plans are untracked.**~~ **Settled.** Two tiers with different
   lifetimes: `docs/` is the tracked architectural reference (this file
   included); `.plans/` holds untracked per-change implementation plans.
   `@halecraft/plans` will later give them their own VCS namespace. A
   plan may cite `docs/` and source paths, never anything under `.plans/`
   or `.jj/`.
   See `README.md` § Where documents live.
2. ~~**Repo layout**~~ **Settled.** A pnpm workspace with `packages/core`,
   `packages/schema`, `packages/pi`, `packages/protocol` and `packages/client`,
   with `apps/pinetrie` and `apps/conformance` for what is run. Superseding the
   earlier arrangement of
   `client/`, `protocol/`, `e2e/` stay in the root app. The pi boundary is
   enforced by module resolution rather than by the scanner — see
   `01-architecture.md`.
3. **Language/runtime for the host** — Node assumed (pi is Node). Bun is viable
   and Kyneta has `internal/bun-server`.
4. **Does pine·trie vendor Kyneta or depend on published `@kyneta/*`?** Published
   is 3.0.0; local source is at `~/halecraft/kyneta`.
