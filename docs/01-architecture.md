# Architecture

## Evidence base

Everything below rests on reverse-engineering `@earendil-works/pi-coding-agent`
**0.85.0**, since bumped to **0.87.1** (conformance re-verified), and reading the Kyneta source at `~/halecraft/kyneta`. Findings that
carry load are cited. **pi's experimental surface is unreleased, undocumented,
and version-locked across seven packages — treat all of it as churning.**

### pi facts established

- **`Storage` is a real port.** `pi-agent-core/dist/harness/session/types.d.ts:386`
  — 10 methods: `commit`, `getEntries`, `getValue`, `scanValues`, `readList`,
  `scanBranch`, `scanBranchStructure`, `scanEntries`, `scanUsage`, `getStats`,
  `close`. A **conformance suite** ships at
  `harness/session/testing/conformance/storage.js`, plus in-memory, gating,
  instrumented, and benchmark implementations. Third-party backends are expected.
- **`IdGenerator` is injectable.**
- **Storage format v4 is an op-log.** Lines are *batches* (arrays) of ops.
  Op kinds: `entry`, `value` (set/delete), `list` (append/delete), `usage`.
  Namespaces observed: `pi.branch.tip` (keyed by lane), `pi.lane.config`,
  `pi.lane.state`, `pi.op.meta`, `pi.op.state`, `pi.result`,
  `pi.pending.assistant_frame`.
- **Entry IDs are UUIDv7** — globally unique, time-sortable, coordination-free.
- **Entries are immutable**; branching is a tip-pointer move.
- **`seq` is a storage-assigned commit LSN.** `NewEntry = Omit<Entry,"seq"|"timestamp">`;
  `commitWrite(write, seq, timestamp)`. Global and dense per session (observed
  1→69 across all op kinds). It serves three roles — replay order, pagination
  cursor (`EntryCursor`/`ListCursor`), and recency stamp on `StoredValue`.
  `EntryScan{fromSeq,toSeq}` additionally requires **range scans**.
- **`SessionMutation` is an "exclusive keyless mutation barrier for one Session"** —
  a per-session-process mutex.
- **`BranchSummaryEntry {fromId, summary, details, usage}` already exists** — pi
  has a merge-commit primitive, generated on *leaving* a branch.
- **Lanes are the concurrency primitive.** `AgentHarness.lanes()`; `AgentLane`
  has `getTipId`, `navigateTree`, `prompt/steer/followUp/nextRun`, `watch`.
- **Measured:** two clients, one session, concurrent prompts → **both accepted,
  strictly serialized** on lane `main`; tip advanced monotonically. Multi-client
  attach works today; concurrent writes queue behind one lane.
- **chord's `ReplicatedState` is single-authority** — "producers mutate…and call
  `publish()`; consumers receive complete immutable values… replicas become
  unready on disconnect until rehydrated."
- **`@earendil-works/pi-client` ships unix transport only.** No websocket/SSE.
  There is no browser path in pi today.

### Kyneta facts established

- **`Line`** (`packages/exchange/src/line.ts`) — reliable bidirectional message
  stream: two `json.bind()` authoritative docs (one per direction), seq
  numbering, ack-based pruning, policy routing. `Line.protocol()` reifies
  schema+topic; `open()` = client, `listen()` = server.
- **Substrate-agnostic** `@kyneta/schema`: plain JS, Loro, Yjs.
- **The Loro backend exposes `version()` → `VersionVector` for sync only.** No
  `checkout`, `detach`, or `frontiers` in `packages/schema/backends/loro/src`.
- Transports available: websocket, SSE, WebRTC, unix socket, in-process bridge.
  **They live at `packages/exchange/transports/*`, not `packages/*`** (stores
  likewise at `packages/exchange/stores/*`) — `ls packages/` makes them look
  absent. Declared via `pnpm-workspace.yaml`. (S4 correction.)
- **Wiring recipe** (S12/S4): `link:` is a pnpm/yarn protocol and npm rejects it
  (`EUNSUPPORTEDPROTOCOL`). **Symlink the local workspace packages into
  `node_modules/@kyneta/`** — Node resolves through realpath, so each package
  picks up its own workspace deps, and `workspace:^` never has to resolve.
  Note `npm install` **deletes the symlinks**; re-link afterwards.
- ~~**Gotcha:** `Line.protocol({client, server})` … schemaHash collision~~ —
  **fixed upstream.** `exchange.get()` now compares what a schema can *read*,
  not object identity. Verified.
- **Line API renamed** (same window): `open()` → `sender()`, `listen()` →
  `claimReceiver()`, plus a new `manager()`.

## Layer cake

```
┌──────────────────────────────────────────────┐
│ Browser client — tree UI, composer, refs     │
└───────────────┬──────────────────────────────┘
                │  Kyneta Line (commands)
                │  Kyneta docs  (state, replicated)
┌───────────────┴──────────────────────────────┐
│ Node host — owns the harness                 │
│   pi-agent-core: agent loop, tools,          │
│   providers, compaction, skills, extensions  │
└───────────────┬──────────────────────────────┘
                │  pi `Storage` interface (10 methods)
┌───────────────┴──────────────────────────────┐
│ KynetaStorage — json.bind, Exchange, store   │
└──────────────────────────────────────────────┘
```

**We do not use:** chord, `pi-server`, `pi-client`, the coordinator, the
experimental session worker. We embed `pi-agent-core` directly and own the
replication boundary. (ADR-0001)

## The thin waist

Five contracts. Fix these and everything else proceeds in parallel.

| # | Contract | Status |
|---|---|---|
| 1 | pi `Storage` (10 methods + conformance suite) | **Given.** Adopt, don't design |
| 2 | Kyneta session document schema | Design — the core one |
| 3 | Reference union | Withdrawn (ADR-0043): nothing read references |
| 4 | Merge node shape (`parentId` + `fromId`) | Decided; one field |
| 5 | Host↔client boundary | **Given.** Kyneta Line + replicated docs |

## Module layout (as built)

```
apps/         things you RUN; nothing imports them
  pineta/        @pineta/app          the host (server) and its e2e suites
  conformance/   @pineta/conformance  pi's own Storage suite vs our adapter

packages/     libraries; their boundaries are enforced by resolution
  core/          @pineta/core         declares NOTHING; pure decisions and types
  schema/        @pineta/schema       Kyneta only; the document shape (TECHNICAL.md)
  pi/            @pineta/pi           THE pi boundary (TECHNICAL.md)
  protocol/      @pineta/protocol     the wire contract and its codec
  marginalia/    @pineta/marginalia   Pineta's shapes stored in pi: chat, notes, threads, outbox
  reads/         @pineta/reads        document reads shared by the host and the client
  lanes/         @pineta/lanes        a lane's container and disk: the one place container, jj and git run (TECHNICAL.md)
  client/        @pineta/client       browser UI and session client; owns its Vite build

(root)        a bare workspace: development tooling only, no dependencies
```

Unit tests sit beside the code they test. `workspace.test.ts` at the root is
the one exception: it checks the manifests.

The host's shell, `apps/pineta/host/`, is split by responsibility: runs, the
outbox, settling, startup, each command, HTTP. Each module takes its
dependencies as a parameter, and `index.ts` alone wires them. Its order rules
(a run's end, startup) are in `apps/pineta/host/TECHNICAL.md`.

### The pi rule is correct-by-construction, not checked

`@earendil-works/*` is declared **only** by `packages/pi` and
`apps/conformance`. pnpm's `node_modules` is strict, so from the app every
spelling fails at resolution:

| from the app | result |
|---|---|
| `import("@earendil-works/pi-agent-core")` | `ERR_MODULE_NOT_FOUND` |
| `` import(`@earendil-works/pi-agent-core`) `` | `ERR_MODULE_NOT_FOUND` |
| `createRequire(...)("@earendil-works/pi-agent-core")` | `MODULE_NOT_FOUND` |
| `import("@pineta/pi")` | ✅ resolves |

This replaced a syntax scan that **all three of those spellings evaded**. A
scanner reads syntax and a specifier can be spelled unboundedly many ways;
resolution is the one chokepoint they all pass through.

### Every boundary is enforced by resolution

A package can import only what it declares, plus whatever its parent
directories declare, because Node resolves by walking up through each parent's
`node_modules`. Workspace packages sit inside the root, so **the root declares
only development tooling**. With nothing runtime at the root, an undeclared
import fails at type-check time (`TS2307`, including side-effect imports via
`noUncheckedSideEffectImports`) and at run time (`ERR_MODULE_NOT_FOUND`).

This replaced `scripts/check-boundaries.ts`, a regex scanner that failed
silently three times. It was needed while all app code lived in the root
package, and it was the only thing enforcing "core imports nothing": measured
before the split, `core` resolved `ws`, `vite` and Kyneta because the root
declared them.

`workspace.test.ts` checks the manifest rules resolution cannot express: the
root's tooling allowlist, that only `packages/pi` and `apps/conformance` declare
pi, that `core` declares nothing, that `protocol` declares only Kyneta and core,
that `client` declares no server package, that nothing depends on an app. It
also re-measures the resolution claim itself in a child process. Each rule has
been shown to fail when violated.

**Residue, stated rather than hidden.** None of these is structural:

- Every package can reach the root's development tooling (Biome, TypeScript,
  Vitest, Playwright). The test holds that list to an exact allowlist.
- `client` can reach `vite`, its own devDependency for the build.
- Nothing stops the client importing `node:*`; builtins always resolve. The
  browser build and `e2e:browser` catch it.
- **Under Vitest, anything resolves.** It runs under a pnpm shim that sets
  `NODE_PATH` to pnpm's hidden hoist, so a unit test could import an
  undeclared package and still run. `typecheck`, which is in `verify`, still
  reports it.
- Per-file rules are gone. `messages.ts` "imports nothing" became "the protocol
  package declares only Kyneta and core".

Dependency direction is physical: `core → schema → pi → app`. A package cannot
reach up into the app, which is what forced `core` and `schema` to become
packages — pi depends on them.

### Writers, lanes and the host

The host owns one pi harness and is **not a writer**. Each connected client is
a writer, identified by the transport's `LineSender.peer` and recorded in every
message it sends; writers own no lanes. A lane belongs to a thread: created
where agent work is first wanted there, never moved, never written while it
runs (ADR-0020). Threads run concurrently. Decisions are pure (`planChat`,
`planNote` and the rest in `@pineta/marginalia`, over facts read by `@pineta/reads`);
the host gathers, plans and executes each command in one serial step.

Wire sentinels live only in `packages/protocol/codec.ts`. The wire is total, so `""`
stands for "absent"; the codec decodes commands into an `Intent` union and
replies into an `Outcome` union, and nothing past it sees `""`. Likewise pi's
`string | null` for a tree position becomes a `Position` inside
`packages/pi` only.

### Branching

A branch command names a parent. The host navigates the lane there with pi's
`navigateTree`, then prompts, so the turn forks from that entry. pi owns the
tree operation; we do not reimplement it. One `run` decision carries
`parentId: string | null` — a branch is a run with a different attachment
point, so there is no second decision variant. See `packages/pi/TECHNICAL.md`
for the limits, including that a foreign-written entry is not navigable.

### Two projections over the same `parentId` edges

`projectTranscript(entries, tipId)` returns the **tip path**: exactly what the
model sees on the next turn. `projectSpine(entries, tipId)` returns the same
path, each node also carrying the children that are *not* on it.

They answer different questions, so both exist:

| | answers |
|---|---|
| `projectTranscript` | what will the model see? (the context window) |
| `projectSpine` | what exists around that path? (the shared reality) |

The difference between those two sets is the product. An Aside is an entry that
exists without being in context. Both share `renderableMessage`, so they cannot
disagree about which entries are messages.

`projectSpine` is deliberately not a generic tree. Almost every node has one
child, so an n-ary tree would be an intermediate structure the UI discards; the
UI renders a linear spine with branches hanging off it.

## Data model

### Two orthogonal axes — do not conflate

| Axis | Owner | Answers |
|---|---|---|
| the substrate's op log | substrate | "which edits reached which replica"; compacted away (ADR-0023) |
| `parentId` tree | us | "what follows what, conversationally" |

Precedent: **jj has both** — an operation log (undo, cross-machine concurrency)
*and* a commit DAG with explicit parents. It deliberately does not derive
branches from the op log. Our mapping is exact. (ADR-0008)

### Document shape (entries: settled by S7; rest sketch)

- **entries** — `Schema.record(Schema.struct.json({...}))`: a dynamic-key map
  keyed by UUIDv7, values opaque immutable blobs. **Not** `Schema.list` (not
  idempotent — the same entry appended on two peers yields two copies, so any
  retry or at-least-once delivery silently duplicates conversation entries).
  **Not** `Schema.set` (rejected at runtime by the Loro backend this ran on
  then: `'set-op' is not yet supported`). `record` also gives O(1)
  `getEntries(ids)`, which is exactly pi's `Storage` access pattern.
  Since ADR-0023 the document is authoritative JSON (`json.bind`), written by
  the host alone and compacted between runs.

  > **Load-bearing invariant (ADR-0009): entry ids must be unique.** A Loro map
  > is a per-key LWW register; grow-only-set semantics emerge *only* because
  > every key is written exactly once and therefore never contended. S7 §3.4
  > confirms a same-key concurrent write **silently discards one entry with no
  > error**.

  Fields: `{id, parentId, fromId?, seq?, timestamp, type, …}`
- **values** — LWW map over `(namespace, key)`. Carries `pi.branch.tip`,
  `pi.lane.*`, `pi.op.*`, labels.

  > **Three registers are keyed by LANE NAME** (`values.js:62-65`):
  > `pi.branch.tip`, `pi.lane.state`, `pi.lane.config`. They are safe **only**
  > under single-writer lane names — **ADR-0011**. Note `pi.lane.state` carries
  > the steering **inbox**, so a clobber drops queued user messages, not just a
  > pointer. `pi.op.*` is keyed by `operationId` and presumptively uncontended
  > (assumed, not verified).
- **lists** — grow-only list + tombstones. Carries `pi.pending.assistant_frame`.
- **pending assistant text** — durable **`Schema.text()`**, written with
  `insert(at, delta)` and cleared on commit (ADR-0014). Ships only the inserted
  characters. **Do not use `Schema.string()` for anything that accumulates** —
  it is a whole-value LWW register, so appending to it is O(n²) **on every
  substrate**, durable included (measured: 144 582 B vs 18 131 B for the same
  stream).
- **images** — not in the document at all (ADR-0042). Their bytes are rows
  of `pineta_blobs` in the host's SQLite file, keyed by SHA-256; a chat holds
  `ImageRef`s in `details.images`, and the model is given the bytes when its
  context is built. A tool's image is stored by `read` before pi writes the
  result, whose entry holds a reference that `KynetaStorage` rejoins with the
  bytes for pi (ADR-0051). So compaction never rewrites an image, and a late
  joiner loads one only when it is drawn.
- **presence** — ephemeral: per-peer selection, scroll, live typing.
  Ephemeral holds **only** scalars/structs/records — no `text`, `list`,
  `counter`, or other ordered/counted container, by design.
  **NOT streaming deltas** (ADR-0014 — ephemeral never notifies on remote
  arrival, and delta-only presence loses text on a fully-connected client).
  **NOT tips either** — ADR-0011 makes tips durable per-lane.

### Anchor stability (references)

References were withdrawn (ADR-0043): nothing read them. What follows is kept
for whatever points into the tree next. It is determined by target mutability:

- **Entries are immutable** → plain offsets are permanently stable. No Loro
  cursor needed. A gift from pi's data model.
- **Files are mutable** → need content addressing (blob hash or jj change ID),
  or pointers rot silently. A pasted image is content-addressed by
  construction: `/blob/<sha256>` names bytes that never change (ADR-0042).
- **Composer text is mutable and multi-writer** → the one place that genuinely
  needs `Schema.text()` + Loro cursors.

### Dissolving `seq`

`seq` is the single centralized sequencer, and it is what enforces single-writer
behaviour. It cannot be made convergent — a CRDT counter is a *sum*, not a
*sequencer*; allocating unique increasing integers across replicas is consensus.
(Note: Loro's internal op ID `{peer, counter}` is the true analogue — a per-peer
sequence — **not** the `LoroCounter` CRDT type.)

**RESOLVED by S1 → ADR-0013.** The split below was the plan; **S1 refuted two
thirds of it.** Kept here because the refutation is the useful part.

| Role | ~~Planned~~ | **Actual (ADR-0013)** |
|---|---|---|
| Replay order | ~~Lamport + peer tiebreak, free from Loro~~ | **REFUTED.** Replica-local **arrival** order. Semantic order comes from the `parentId` walk |
| LWW recency | `LoroMap` register semantics | ✅ holds — stored `seq` disappears |
| List cursor | ~~Loro stable `Cursor`, API-visible break~~ | **NOT NEEDED.** `ListReadOptions` is unchanged |
| Entries need no stored `seq` | — | ✅ holds — but a seq is still *attached on read*, since `Entry` carries it |

> **Why the plan was wrong.** pi turns cursors into arithmetic on an integer line
> (`cursor.seq + 1` = "next possible position"). **A convergent order and stable
> integer cursors are mutually exclusive.** Any convergent key — Lamport, HLC,
> `(uuidv7, peer)`, packed peer-ranges — is one a late arrival sorts into the
> *middle* of: unique-but-convergent keys leave the arrival *below* a live cursor
> (**skipped, never returned**); a derived dense convergent index shifts later
> positions (**returned twice**). **Uniqueness is not sufficient.** Only an order
> where new observations always land *at the end* preserves the arithmetic.

**Density was never required** — pi's own conformance suite ships a fixture named
`"sequence gap"` (`conformance/storage.js:522`).

## Fold (context merge)

Destination-aware and lazy. pi summarizes on *leaving* a branch, with no
knowledge of where the summary will land. We summarize on *landing*, knowing the
destination — strictly more information, and it preserves optionality (an eager
summary can never be re-folded differently).

Given tree `A → {B, C}`, `C → {D, E}`, at `E`, "fold in B":

```
base   = path(root → A)      ← LCA. Sent ONCE.
theirs = path(A → B)         ← the branch being folded
ours   = path(A → C → E)     ← the destination
task   = "summarize `theirs` so it is useful at E"
```

This is git's three-way merge structure. Sending `A` once (not twice) both saves
tokens and tells the model what is common ground versus what diverged — the
distinction it needs to judge relevance.

**Output is a merge node**: a new entry on E's branch with `fromId: B` alongside
`parentId: E`. This buys provenance, re-foldability, double-fold detection, and
a "landed" signal for the tree UI.

**Consequences:**

- Fold is an **LLM call** — it has cost and is nondeterministic. Two peers
  folding B concurrently produce two different merge nodes. Both are valid and
  immutable; the UI must expect this rather than assume idempotence.
- **Two peers folding into the same trunk tip additionally contend for trunk
  *succession*, which a linear path cannot grant to both** (S12). This is a
  semantic conflict in *any* representation, not an artefact of our data model.
  ADR-0012 makes it fail **loudly**: `leaves.length > 1` on the promotion DAG is
  a queryable "unresolved trunk fork", and the repair is a re-fold at the new
  tip — which ADR-0010 already prescribes. The UI must render the fork state.
- Budget ladder when raw context does not fit: raw → per-leg compaction → pi's
  existing branch summary. Degrade knowingly.
- Undecided: fold a *path* or a *subtree*? Default to the subtree's active path,
  let the user pick a different tip.
- This generalizes across sessions — "fold in a teammate's branch" is the same
  operation across a Kyneta doc boundary. Multiplayer nearly free.

## Risks

| Risk | Mitigation |
|---|---|
| pi 0.85 experimental APIs churn | Pin exact versions; vendor types; keep `Storage` the *only* deep coupling; periodic upstream diff chore |
| ~~`seq` collides across replicas~~ | **RESOLVED (S1 → ADR-0013).** `seq` is now a derived replica-local **arrival** index; the shared counter is gone. All three defects cleared (0 collisions, no regression, 0 skipped), conformance 21/21, property 1000/1000 vs control 0/300. Cold index rebuild 57 ms @ n=10 000; incremental reconcile O(δ), 0 ms. **New constraint:** `seq` must never cross a replica boundary or survive a restart — see ADR-0013 and ADR-0007 |
| ~~Harness assumes a private world~~ | **Resolved by S3 + ADR-0011.** The harness caches (`Lane`, not `StorageBackedSession`) and assumes monotonic local growth, but does not crash or corrupt — and lane-per-writer avoids every tip-level failure. **T5 answered: the admission mutex CAN be per-replica.** Multi-writer stays a *storage* project. Caveat: the drive/inference loop was stubbed, not exercised |
| ~~Fold output is mush~~ | **Retired.** S5 — not observed across four scenarios plus ablation |
| ~~`@kyneta/schema` writes are O(n²)~~ | **RESOLVED (S14).** Fixed upstream in `da978ec` (2026-09-19): `step` = copy ∘ core, `stepInPlace` = core, `applyChange` uses the dual. **Requires `loro-crdt >= 1.13.4`.** Pineta shape n=10 000: entries **38 444 → 93 ms**, lists **12 731 → 92 ms**; linear to **n=50 000** (626 ms / 739 ms). **Residual: none — S13 closed.** Remaining exposure is *distribution*, not design: published 3.0.0 is stale **and** declares `loro-crdt >= 1.8.0`, so a consumer can install a supported-looking combination that is 17× slow |
| Loro `fork_at` immaturity | Not on the critical path; we do not build the tree on version history |
| ~~List cursors `{seq}` break under CRDT semantics~~ | **Retired.** S2/T7's prediction did not hold — S1 keeps `ListReadOptions` unchanged with no Loro `Cursor` |
