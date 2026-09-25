# Pineta — project handoff

**Read this first.** It is the orientation document for anyone (human or agent)
picking the project up cold. The detailed record lives in `docs/`; this
file exists to tell you what matters, what is decided, and what to do next.

> The architectural record lives alongside this file in `docs/` and is
> **tracked**. `00`–`05` are the standing documents; `findings/` holds the 14
> spike reports that are the evidence behind them. This file is the orientation
> layer over the top.
>
> **Implementation plans are not here.** They live in `.jj/plans/`, one per
> change, and are untracked — see `docs/README.md` § Where documents live.
> `docs/` explains why the system is shaped as it is; a plan describes one
> piece of work and is spent once done.

---

## 1. What we are building

A **collaborative agentic harness**: pi's agent core on Kyneta's CRDT substrate,
with the conversation **tree** as the primary object rather than a transcript.

Every mainstream coding agent models a conversation as an append-only linear
transcript. That one choice creates the friction we set out to remove:

- you cannot ask a clarifying question without polluting the main context
- you cannot explore a tangent without derailing the trunk
- you cannot edit an earlier message without destroying what came after
- two people cannot work in the same conversation at all

The underlying interaction is *already* tree-shaped. The interface refuses to
admit it.

**Three capabilities, in order of ambition:** local bifurcation (branch from any
point, run several branches at once) → multiplayer (same tree, live, across
devices) → **merge** (fold a valuable exploration back into the trunk, mediated
by an LLM that sees both divergent branches).

Full statement: `docs/00-vision.md`.

### Branch kinds — the scope lever

| kind | context | tools | workspace | merge |
|---|---|---|---|---|
| **Aside** | full prefix | none | none | fold-in (optional) |
| **Scout** | full prefix | read-only | shared, read-only | fold-in |
| **Worktree** | full prefix | full | isolated (jj) | fold-in **+** file merge |

Aside and Scout are pure conversation-tree operations and cover most daily use.
**Worktree is out of v1** — it needs effect-merge, which is genuinely hard.

### Merge is three problems

Conflating these wasted time early, so keep them separate:

1. **Structural** — two peers append under different parents; the tree
   converges. *Free from CRDTs. Not where the work is.*
2. **Context** — what text enters the model's window when a branch lands.
   *The actual product problem.* Solved by a destination-aware three-way fold.
3. **Effect** — filesystem side effects of a branch that ran tools. *Unsolved,
   out of v1,* needs isolated workspaces + a real jj merge, committed atomically
   with the conversation merge.

---

## 2. Where we are

**The walking skeleton walks all five layers**, with automated coverage at each:

```
browser page ─┐
              ├─ Kyneta Line (websocket) ─ Node host ─ pi-agent-core AgentHarness
Node client ──┘                                              │
                                                     KynetaStorage (ADR-0013)
                                                             │
                              Loro doc ── replicated back ── ┘
```

Twelve spikes resolved, fourteen ADRs, **no open blockers**. The gate was fully
discharged before any non-disposable code was written.

### Current state

| gate | command | status |
|---|---|---|
| lint + format | `pnpm run lint` | clean (Biome, Kyneta's settings) |
| module boundaries | `pnpm run check` | ok |
| build guards | `pnpm run sanity` | ok |
| unit (pure core) | `pnpm test` | 11/11 (Vitest) |
| pi's own Storage suite | `pnpm run conformance` | 21/21 + 21/21 control |
| end-to-end | `pnpm run e2e` | 16/16 |
| with a real model | `pnpm run e2e:live` | 20/20 |
| **real browser** | `pnpm run e2e:browser` | 7/7 |
| types | `pnpm run typecheck` | clean (strict) |
| all-but-browser cascade | `pnpm run verify` | green |

19 TypeScript files, ~3 000 lines. Stack: pnpm workspace · TypeScript (strict,
**no build step** — Node 24 strips types natively) · Vite · Vitest · Biome ·
Playwright.

### Layout

```
packages/core/         @pineta/core        NO dependencies at all
packages/schema/       @pineta/schema      Kyneta only — never pi
packages/pi/           @pineta/pi          THE pi boundary
                         agent.ts    harness lifecycle, createAgent
                         storage.ts  our impl of pi's Storage port
                         deep.ts     pi entry points absent from its exports map
                         index.ts    re-exports OUR shapes; no pi type crosses
packages/conformance/  @pineta/conformance pi's Storage suite vs our adapter

protocol/ host/ client/ e2e/ test/ scripts/    the app (root package)
```

Dependency direction is physical: **core → schema → pi → app**.

---

## 3. Decisions that constrain everything (ADR-0001..0014)

Full text with rationale and rejected alternatives: `docs/02-decisions.md`.
The ones you must not violate by accident:

**ADR-0009 — entry ids must be unique and coordination-free.** Entries live in a
Loro map, which is a per-key LWW register. Grow-only-set semantics hold *only*
because each key is written exactly once. A same-key concurrent write **silently
discards one entry — no error, no conflict**. Never derive an id from content,
index, or position. Use pi's default `IdGenerator` (verified safe in S9: a
41-bit monotonic counter, intra-process collision probability exactly 0).

**ADR-0011 — the lane name carries writer identity. Never `"main"`.** pi keys
three registers by lane name (`pi.branch.tip`, `pi.lane.state`,
`pi.lane.config`). Two writers on one lane silently orphan a whole turn, drop
queued steering messages, and lose an in-flight operation record. `LaneName` is
a branded type mintable only by `laneNameForWriter()`, so `"main"` is not
assignable.

**ADR-0013 — `seq` is a derived, replica-local ARRIVAL index.** Two different
mechanisms keep it off the wire, and they are not interchangeable: Line
messages are `Schema.struct`, so an undeclared `seq` is *dropped at the
boundary* (structural); stored entries are `Schema.record(Schema.any())`, where
nothing strips anything and the `findSeqKeys` scan is the only guard. Both
verified by injection. A `LocalSeq` brand was deleted — brands constrain
creation, and the risk here is serialization. The derivation
is `orderNewEntries()` in `packages/core` — pure, and property-tested for
permutation invariance (`test/ordering.test.ts`, 9 cases, ~2 ms, no substrate).
`KynetaStorage` only assigns the seqs it returns. Not convergent,
deliberately. A convergent order and stable integer cursors are **mutually
exclusive**: pi computes `fromSeq: cursor.seq + 1`, so any convergent key lets a
late arrival sort *below* a live cursor and vanish. `seq` must never cross the
wire as a durable identifier — entry `id` is durable. Nothing may render by seq
order; ordering comes from the `parentId` walk.

**ADR-0015 — entries are a TYPED row**, not `Schema.any()`. Kyneta is
schema-first: with `any()` the catamorphism has nothing to walk, so validation,
typed reads, observation granularity and indexes are all forfeited for the
document's primary content. A flat `struct.json` with six columns — `id`,
`parentId`, `type`, `timestamp`, `fromId`, `payload` — and `Schema.any()` at
`payload` only, where the pi boundary forbids naming `AgentMessage` /
`JsonValue` / `Usage`. `type` is *unconstrained*, so a new pi `EntryType` needs
no schema change; a `discriminatedUnion` was rejected for demanding one every
time. `.json()` because entries are written once, making per-field CRDT merge
unused machinery. **S17/P1: Kyneta's migration walk cannot reach inside a
`Schema.record`, so no entry-shape change is migratable** — keep the typed
surface small, and treat changes as coordinated upgrades.

**ADR-0014 — token deltas stream into a durable `Schema.text()`** via
`insert(at, delta)`, cleared on commit. **Never `Schema.string()` for anything
that accumulates** — it is a whole-value LWW register, so appending is O(n²) on
*every* substrate (measured: 144 582 B vs 18 131 B for the same stream).

**ADR-0010 — a fold is destination-relative.** Summarize at *landing* time, not
at leave time, with a three-way structure: `base` = path to the LCA (sent once),
`theirs` = the folded leg, `ours` = the destination leg. The `ours` leg is
**mandatory** — dropping it is a correctness regression, not a quality one (S5's
ablation: without it the model confidently recommends a design the destination
already rejected).

**ADR-0012 — the trunk is a derived value over an append-only promotion DAG**,
not a mutable pointer. `prev` is a *list*, so a promotion resolving a fork
extends every leaf it supersedes. Two concurrent folds onto one trunk tip are a
semantic conflict in *any* representation; this makes it fail **loudly**
(`leaves.length > 1` is a queryable "unresolved trunk fork").

**ADR-0008 — the conversation tree is explicit (`parentId`); Loro's version
history is infrastructure.** A CRDT op-DAG is a *merge* DAG, not a *branch* DAG:
two branches in one `Schema.text()` converge into a single linear transcript.
jj makes the same split (operation log vs commit DAG).

---

## 4. Hard-won context you would otherwise rediscover

### The recurring failure mode

Four times, a **measurement apparatus drifted out of alignment with the thing it
measured**, and each time it produced a confident wrong answer:

- S11's control ran without a subscriber, so it measured a different code path
  and concluded the bug was in Kyneta's binding. It was upstream in loro-crdt.
- S4's observer was a 1 ms poller, read as substrate behaviour. The "connected
  client loses text" finding was an off-by-one in the *test*.
- `check-boundaries` walked only `.mjs`, so it silently stopped enforcing the
  architecture as each file converted to `.ts`.
- A probe "proved" pnpm strictness while its install had silently failed.

**The defence that works is a negative control: prove the check can still fail.**
There are permanent ones for convergence, seq, trunk semantics, and boundaries.
*A check without a proof that it can fail is not yet a check.*

### Sandbox (`~/.config/pi-jail/policy.json`)

`allowWrite` is a **whitelist** (`"."` = the session's cwd); `denyWrite` carves
exceptions *inside* it; reads are open with a `denyRead` blacklist.

- **pnpm 12 cannot reach the registry** — its Rust fetcher validates through the
  macOS keychain and cannot see the sandbox CA. `packageManager: "pnpm@10.18.0"`
  routes through corepack's Node fetcher. **Do not remove that pin.**
- **Chromium cannot be launched inside the jail.** Seatbelt denies
  `mach-register`, which Chromium needs for `MachPortRendezvousServer`. Upstream
  `anthropics/sandbox-runtime#210` is open with zero comments; PR #407
  implemented `allowMachRegister` and was **closed unmerged**. No pi upgrade
  fixes it.
  **Workaround, and it works:** start a Playwright server *outside* the jail —
  `pnpm exec playwright run-server --port 3100` — then `pnpm run e2e:browser`
  drives it over loopback. The operator owns the browser; the agent owns the
  automation.

### Kyneta

Local workspace at `~/halecraft/kyneta`, wired by `link:` deps. **Published
`@kyneta/*` 3.0.0 is unusable** — it predates the O(δ) write fix and declares a
`loro-crdt` floor of `>=1.8.0` where the real floor is `>=1.13.4`.
`pnpm run sanity` gates on both markers (`stepInPlace` exported, loro ≥ 1.13.4)
and refuses to start otherwise.

Three issues were filed to the Kyneta team (`docs/findings/kyneta-issues-verification.md`):
`compact()` throws on live Loro docs (**still open** — it is why ADR-0014 leaves
~5.6 KB residue per message); the `Line` schemaHash collision (**fixed**); and
the ephemeral wire cost (**withdrawn — our error**, we used `Schema.string()`
where `Schema.text()` was the right primitive).

### pi

Pinned exactly at **0.87.1** across three packages. pi is mid-rewrite into a
distributed architecture (coordinator → server → worker-per-session → N
clients) behind `PI_EXPERIMENTAL=1`; we deliberately embed `pi-agent-core`
directly and use none of it (ADR-0001). `Storage` is a real supported port with
a conformance suite — that is the single deep coupling, and it survived the
0.85 → 0.87.1 bump unchanged.

---

## 5. What makes this codebase unusual — respect these

**The pi boundary is correct-by-construction, not checked.** `@earendil-works/*`
is declared *only* by `packages/pi` and `packages/conformance`. pnpm's
`node_modules` is strict, so from the app every spelling fails at resolution —
`import()`, a template literal, `createRequire`. This replaced a syntax scan
that **all three evaded**. `scripts/check-boundaries.ts` now asserts the
*manifest* properties that make resolution the enforcer (root declares no pi;
`@pineta/core` declares nothing), plus the intra-app rules.

**ADRs are encoded as types where possible.** `LaneName` and `LocalSeq` are
branded; `projectTranscript(entries, tipId)` cannot even accept a seq.

**FC/IS — gather → plan → execute. Decisions are values.** `packages/core` is
pure and imports nothing; the shell in `host/` performs the decision. This
mirrors pi's own lane loop.

**No build step.** Node 24 strips types natively, so imports name the real file
(`./index.ts`). Native stripping does **not** support enums, namespaces,
parameter properties, or decorators.

---

## 6. What to do next

**The stack is complete.** `client/app.tsx` is React, rendering from the same
Exchange `connectSession` already owns (handed to `ExchangeProvider`), so Node
and browser still share one connection story and `e2e` drives the real thing.
Hook names, verified against source: **`useTracked(thunk)`** for a derived
read — *not* `useValue`, which takes a `CallableRef`; `useDocStatus` returns the
string union `"pending" | "empty" | "populated"`, not an object.

`useText` is **not yet used** — the composer is still local `useState`. Wiring
it to a `Schema.text()` is step 5 and the first genuinely collaborative edit.

**Step 1 (tree read) is done.** Now continue thickening (`docs/04-roadmap.md`), each step
independently shippable:

1. ~~tree read~~ — done: `projectSpine`, spine + branch markers, navigation is client-local state
2. branch write — create a branch from any entry; Aside first
3. concurrent lanes — two branches at once
4. references (ADR-0006) — entry and entry-span kinds, with backlinks
5. multi-writer composer — `Schema.text()`
6. Scout — read-only tools
7. fold — three-way merge producing a `fromId` node

**v1 demo:** two browser windows, one host, one tree. A runs a long task on
trunk; B branches an Aside three turns back, asks, gets an answer, attaches a
reference — and it appears live in A's tree **with zero tokens entering A's
context.**

### Open, non-blocking

- **S15** — the trunk winner rule uses wall-clock `ts`; clock skew is
  adversarial. Needs a Lamport clock (S1 deliberately built none).
- **S16** — a disposable per-message doc would remove ADR-0014's ~5.6 KB
  residue. Lower priority since the wire-cost half of its premise dissolved.
- **S10 remainder** — snapshot/sync-payload size at scale.
- **S6** — file-range reference anchoring (only matters for Worktree branches).
- `scripts/check-boundaries.ts` is ~290 lines and has no tests of its own.
  It has now failed the same way twice (`.mjs`-blind, then `.tsx`-blind) while
  reporting "all boundary rules hold".
- Multi-writer is proven only at the *storage* layer. The drive/inference loop
  has never been exercised with two concurrent writers.

### Standing chores

- Republish `@kyneta/*` **and raise the declared loro floor** — shipping the code
  fix with `>=1.8.0` lets consumers install a 17×-slow combination silently.
- Exercise `@kyneta/react` + `@kyneta/devtools` against Kyneta's in-place
  mutation change (they are the likeliest holders of an object-identity
  assumption).
- Periodically diff pi upstream; `pnpm run conformance` is the gate.

---

## 7. Working agreements

Adopted from Kyneta's `AGENTS.md` because they match how this project has run:

- **No backwards compatibility.** Delete old code. Take the elegant path even if
  it means a bigger refactor.
- **Fix pre-existing problems** you notice; code health is everyone's.
- **No non-null assertions (`!`)**, even in tests.
- **`pnpm run verify` must be green after every change.** Never leave it red and
  move on.
- **Boundary rules are not negotiable.** If a change seems to need a new
  cross-module import, a type is in the wrong module — move the type, not the
  boundary.
- **Report honestly.** A clean negative result is a success; a layer that does
  not work, stated plainly, beats one that appears to.

### Map of the record

| file | what |
|---|---|
| `docs/00-vision.md` | product thesis, branch kinds, v1 scope |
| `docs/01-architecture.md` | evidence base, layer cake, data model, module layout |
| `docs/02-decisions.md` | **ADR-0001..0014** with rationale |
| `docs/03-spikes.md` | S1–S16, each with question + kill criterion |
| `docs/04-roadmap.md` | sequencing, invariants, action items |
| `docs/05-stack.md` | stack decisions, sandbox constraints |
| `docs/findings/` | 14 spike reports — the evidence |
| `sandbox/` | disposable spike code (gitignored), kept for reproduction |
