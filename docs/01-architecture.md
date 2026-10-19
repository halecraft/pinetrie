# Architecture

## Evidence base

Everything below rests on reverse-engineering `@earendil-works/pi-coding-agent`
**0.85.0**, since bumped to **0.87.1** and **0.99.2** (conformance re-verified), and reading the Kyneta source at `~/halecraft/kyneta`. Findings that
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

Paths here are in Kyneta's repository.

- **`Line`** (`packages/exchange/src/line.ts`) — reliable bidirectional message
  stream: two `json.bind()` authoritative docs (one per direction), seq
  numbering, ack-based pruning, policy routing. `Line.protocol()` reifies
  schema+topic; `open()` = client, `listen()` = server.
- **Substrate-agnostic** `@kyneta/schema`: plain JS, Loro, Yjs. pine·trie
  uses `json.bind` for its documents and Yjs for what people edit together
  and for the places (ADR-0023, ADR-0048, ADR-0066), and no Loro.
- Transports available: websocket, SSE, WebRTC, unix socket, in-process bridge.
  **They live at `packages/exchange/transports/*`, not `packages/*`** (stores
  likewise at `packages/exchange/stores/*`) — `ls packages/` makes them look
  absent. Declared via `pnpm-workspace.yaml`. (S4 correction.)
- **Wired with pnpm's `link:`** to the local checkout (`docs/05-stack.md`):
  npm rejects the protocol.
- **`exchange.get()` compares what a schema can *read***, not object
  identity: the `Line.protocol` schemaHash collision we reported is fixed
  upstream.
- **Line API renamed** (same window): `open()` → `sender()`, `listen()` →
  `claimReceiver()`, plus a new `manager()`.

## Layer cake

```
┌──────────────────────────────────────────────┐
│ Browser page — rail, columns, cards, board   │
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

Kyneta is the storage of record: pi's sessions are written there alone, and
pi's JSONL file is not kept beside it, so terminal `pi` cannot resume them
(ADR-0002).

## The thin waist

Five contracts. Fix these and everything else proceeds in parallel.

| # | Contract | Status |
|---|---|---|
| 1 | pi `Storage` (10 methods + conformance suite) | **Given.** Adopt, don't design |
| 2 | Kyneta session document schema | Design — the core one |
| 3 | Reference union | Withdrawn (ADR-0043): nothing read references |
| 4 | Merge node shape (`parentId` + `fromId`) | Decided; one field |
| 5 | Host↔client boundary | **Given.** Commands over a Kyneta Line, state in replicated documents, no bespoke protocol (ADR-0007) |

## Module layout (as built)

```
apps/         things you RUN; nothing imports them
  pinetrie/      @pinetrie/app          the host (server) and its e2e suites
  conformance/   @pinetrie/conformance  pi's own Storage suite vs our adapter

packages/     libraries; their boundaries are enforced by resolution
  core/          @pinetrie/core         declares NOTHING; pure decisions and types
  schema/        @pinetrie/schema       Kyneta only; the document shape (TECHNICAL.md)
  pi/            @pinetrie/pi           THE pi boundary (TECHNICAL.md)
  protocol/      @pinetrie/protocol     the wire contract and its codec (TECHNICAL.md)
  rules/         @pinetrie/rules        each stored shape and the pure rules about it (TECHNICAL.md)
  reads/         @pinetrie/reads        document reads shared by the host and the client
  channel/       @pinetrie/channel      declares NOTHING; a held JSON-lines channel to a server process (TECHNICAL.md)
  ssh/           @pinetrie/ssh          declares NOTHING; a lane's ssh through its host, the only code that knows ssh (TECHNICAL.md)
  install/       @pinetrie/install      declares NOTHING; pine·trie's own install: its root, its form, the scripts it runs by path (TECHNICAL.md)
  lanes/         @pinetrie/lanes        core and install; what a lane is and runs: the LaneRuntime and LaneHistory ports, no runtime, no jj (TECHNICAL.md)
  lanehost/      @pinetrie/lanehost     the lanes' machine: disks, diffs, merges, grants, by role (TECHNICAL.md)
  docker/        @pinetrie/docker       lanes on Docker, on btrfs subvolumes (TECHNICAL.md)
  vm/            @pinetrie/vm           core only; the Mac's lane VM: image, launcher, a host's lease on a slot (TECHNICAL.md)
  folder/        @pinetrie/folder       core only; a folder project's history as values: states, merge bases, the path merge (TECHNICAL.md)
  keeper/        @pinetrie/keeper       declares NOTHING; one step at a time on a resource (TECHNICAL.md)
  jj/            @pinetrie/jj           your repo: reads, steps, the owner; proposed changes, accepted work, lanes' refs; each lane's jj history (TECHNICAL.md)
  config/        @pinetrie/config       core only; settings declared with their rules, layers decoded, one settle (TECHNICAL.md)
  session/       @pinetrie/session      one client's connection to a host; no React (TECHNICAL.md)
  shell/         @pinetrie/shell        unbash only; shell source as structure (TECHNICAL.md)
  interface/     @pinetrie/interface    what a person sees and does, for any client; no React, no DOM (ADR-0093)
  web/           @pinetrie/web          the browser page: React and the DOM; owns its Vite build

(root)        a bare workspace: development tooling only, no dependencies
```

Unit tests sit beside the code they test. `workspace.test.ts` at the root is
the one exception: it checks the manifests.

The host's shell, `apps/pinetrie/host/`, is split by responsibility: runs, the
popping queued cards, settling, startup, each command, HTTP. Each module takes its
dependencies as a parameter, and `index.ts` alone wires them. Its order rules
(a run's end, startup) are in `apps/pinetrie/host/TECHNICAL.md`.

### The pi rule is correct-by-construction, not checked

`@earendil-works/*` is declared **only** by `packages/pi` and
`apps/conformance`. pnpm's `node_modules` is strict, so from the app every
spelling fails at resolution:

| from the app | result |
|---|---|
| `import("@earendil-works/pi-agent-core")` | `ERR_MODULE_NOT_FOUND` |
| `` import(`@earendil-works/pi-agent-core`) `` | `ERR_MODULE_NOT_FOUND` |
| `createRequire(...)("@earendil-works/pi-agent-core")` | `MODULE_NOT_FOUND` |
| `import("@pinetrie/pi")` | ✅ resolves |

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
pi, what each package may declare (`core`, `keeper`, `channel`, `ssh` and
`install` nothing, and only `lanes`, `docker` and the app `install`; `protocol` only Kyneta and core; `session` no React; `interface`
no React and no DOM), that the page declares no server package, that only
the app declares a runtime, config or ssh, and that nothing depends on an
app. It also re-measures the resolution claim itself in a child process.

Node builtins always resolve, so resolution cannot keep them out of the
page, and Vite's build only warns, stubbing one with code that throws when
called. Biome's `noNodejsModules` does it instead: an error, tests aside,
in `web` and every `@pinetrie/*` package it reaches. `workspace.test.ts`
holds that list to the manifests' closure, so a package the page comes to
depend on fails until the rule covers it. The page's build-time files,
`vite.config.ts` and `stamp.ts`, are exempt.

**Residue, stated rather than hidden.** None of these is structural:

- Every package can reach the root's development tooling (Biome, TypeScript,
  Vitest, Playwright). The test holds that list to an exact allowlist.
- `web` can reach `vite`, its own devDependency for the build.
- **Under Vitest, anything resolves.** It runs under a pnpm shim that sets
  `NODE_PATH` to pnpm's hidden hoist, so a unit test could import an
  undeclared package and still run. `typecheck`, which is in `verify`, still
  reports it.
- Per-file rules are gone. `messages.ts` "imports nothing" became "the protocol
  package declares only Kyneta and core".

Dependency direction is physical: `core → schema → pi → app`, and
`session → interface → web → app`. A package cannot reach up into the app,
which is what forced `core` and `schema` to become packages — pi depends on
them.

### Writers, lanes and the host

The host owns one pi harness and is **not a writer**. Each connected client is
a writer, identified by the transport's `LineSender.peer` and recorded in every
message it sends; writers own no lanes. A lane belongs to a thread: created
where the agent is first asked there, never moved, never written while it
runs (ADR-0120). A lane is a line of agent work, with its own state on disk,
not a way to answer two people at once (ADR-0019). Threads run concurrently. Decisions are pure (`planMessage`,
`planArchive` and the rest in `@pinetrie/rules`, over facts read by `@pinetrie/reads`);
the host gathers, plans and executes each command in one serial step. A
decision that acts on your repo (proposed changes, accepted work) is a value typed in
`@pinetrie/core`, decided by `@pinetrie/rules` from facts `@pinetrie/jj`
reads, and carried out by `@pinetrie/jj`'s steps: the two packages never
import each other, and the host only connects them.

ADR-0119, accepted and not yet built, keeps a thread, its lane and the host the lane runs
on apart, so a lane at rest could later be rebuilt on another machine:
one host holds a lane at a time, and the model is each run's choice.
ADR-0168, proposed, would shelve what of it is unbuilt.

ADR-0135 has pine·trie learn a lane's disk by watching it rather than from
what a project declares. Every tool call's command is a run, and one
observer per machine, an eBPF program lanehost's machine role loads outside
every lane, reports each file its processes name, daemons included, and
stops none of their calls. A lane is its first process's PID namespace;
a host inside a lane is served the observer through that lane's helper,
relayed by the host outside, and registers only lanes below its own.
From those runs and `.gitignore`, each path is source, derived or local. A
recipe is a recorded run, and a disk made for a new state (an update's
merge, a container on another image) loses the outputs whose recipe no
longer holds there, caches kept; getting the latest tells the agent what
went, why, and the last command seen writing there, as a hint
(ADR-0184). pine·trie runs no project command itself:
nothing installs for a lane, and the base is the base before it, checked
out at accepted work. A lane's grants and shared directories are accepted
work's `pinetrie.json`, less what the lane's own copy gives up: only an
acceptance widens them. A shared file has a lineage of versions, each a stamp of its
size and ctime, which the host and a lane read alike: every write, a
lane's or yours (seen by the host's watcher), is one, and a write based on
a version another replaced is flagged concurrent. A folder with no jj
repo is served as a folder project (ADR-0142):
the folder is its accepted work, a thread starts from it as it is, an
accept writes into it without replacing a file it has not checked, and
merge bases come from a graph of states pine·trie keeps. Its first step is
built: lane work reaches a lane's history and accepted work only through
two ports (`LaneHistory`, reached on the lane's queue alone, and
`Destination`), whose one adapter is jj's (`@pinetrie/jj`, wired in
`apps/pinetrie/host/jj/`), chosen once by the project's kind
(`host/project.ts`); `@pinetrie/lanes` runs no jj. ADR-0150's first step
is built too: a lane's history has one kind, on its record, a new lane's
the kind of the disk it clones; lane work names states by points
(`PointId`), opaque ids that only a lane proven jj reads as commits; and
no run starts on a lane of another kind than the project's (`Runs.start`
takes a proof), each path that would start one refused with words.
Every session keeps pine·trie's own files in its data directory (ADR-0150),
whatever the project's kind: pine·trie writes nothing in your project, and
no exclude line for itself. A turn's classes read `.gitignore` with a pure
matcher (`@pinetrie/rules/ignores`), and the search tools read it with no
repo too. The folder's adapter is built (`apps/pinetrie/host/folder/`, the
only code that touches the project's folder; `@pinetrie/folder` decides for
it): the project's folder is read into states of accepted work's line, by the host's scan and the
disks role's checked copy; a lane's turns and times it got the latest are states of the
graph, getting the latest the path merge on its base, a conflict a record whose
three versions the lane reads under `/pinetrie-states`, closed by
`resolve_conflict`; proposed changes are the shown merge, a lane's newest
state merged onto accepted work's newest, reviewed as files. An accept
writes the shown merge into the project's folder (ADR-0159): only if the
folder's own read at the press finds it as shown, each file checked, moved
aside and linked in, journalled so a stopped host finishes or puts it back,
and a write through a file held across it kept as a concurrent save. The
folder's page is built (ADR-0165): a history of accepted work's kept
states, any of which a restore writes back by the accept's own steps and
journal (`writeStateNow`); reviews that show images as images and other
files by their sizes, in either kind of project, and a moved file as one
row; and a lane's conflicts chosen on the page, each choice a `resolve`
state of the lane's, as the agent's tool is. What is kept is said once,
in accepted work's record (`planKeep`). At start the host deletes the
proposed changes, accepted-work and base records of the other kind, and
keeps every state.

pine·trie reads only its own config (ADR-0146): five layers (system, user,
project, local, env), each a `pinetrie.json` but the last, and every setting
declared once, in the host's table (`apps/pinetrie/host/settings.ts`), with
the layers that may set it and how they combine. `@pinetrie/config` decodes
each layer's file against those declarations and settles them, purely: a
limit can only narrow, a key a layer may not set is refused, and every
refusal reaches both the startup lines and the setup page. Nothing of
`~/.pi` or a project's `.pi/` is read: pi's own code loads the model setup
from pine·trie's config, with pi's agent directory bound to pine·trie's.
Credentials are state, in `$XDG_DATA_HOME/pinetrie/auth.json`, written only
by `pnpm sign-in`. The local layer is the served session's
(ADR-0149): a session is found by its folder's real path in one registry,
`$XDG_DATA_HOME/pinetrie/sessions.json`, and named for people, and its
local file and data directory are named by that name.

Wire sentinels live only in `packages/protocol/codec.ts`. The wire is total, so `""`
stands for "absent"; the codec decodes commands into an `Intent` union and
replies into an `Outcome` union, and nothing past it sees `""`. Likewise pi's
`string | null` for a tree position becomes a `Position` inside
`packages/pi` only.

### Branching

A branch is a new thread whose first entry's parent is an earlier entry
(ADR-0125). Its pi lane is created at that entry
(`harness.lane(id, { createAt })`, `createThreadLane`) and never moves
(ADR-0120): no lane is navigated, and nothing calls pi's `navigateTree`.
pi owns the tree operation; we do not reimplement it. See
`packages/pi/TECHNICAL.md` for the limits, including that a foreign-written
entry is refused (`unknown-target`).

### Two projections over the same `parentId` edges

`projectTranscript(entries, tipId)` returns the **tip path**: exactly what the
model sees on the next turn. `projectSpine(entries, tipId)` returns the same
path, each node also carrying the children that are *not* on it.

They answer different questions, so both exist:

| | answers |
|---|---|
| `projectTranscript` | what will the model see? (the context window) |
| `projectSpine` | what exists around that path? (the shared reality) |

The difference between those two sets is the product. A side conversation is
an entry that exists without being in context. Both share `renderableMessage`,
so they cannot disagree about which entries are messages.

`projectSpine` is deliberately not a generic tree. Almost every node has one
child, so an n-ary tree would be an intermediate structure the page discards:
a column draws one path, its forks marked, and the rail draws the tree.

## Data model

### Two orthogonal axes — do not conflate

| Axis | Owner | Answers |
|---|---|---|
| the substrate's op log | substrate | "which edits reached which replica"; compacted away (ADR-0023) |
| `parentId` tree | us | "what follows what, conversationally" |

Precedent: **jj has both** — an operation log (undo, cross-machine concurrency)
*and* a commit DAG with explicit parents. It deliberately does not derive
branches from the op log. Our mapping is exact. (ADR-0008)

### Documents (ADR-0063)

```
pinetrie:session   SessionDoc               session-wide host records:
                                          the directory of roots (pinetrie.root),
                                          every lane's record (pinetrie.lane),
                                          the board, names, proposed changes, banners
root:<RootId>    RootDoc, one a root      that root's pi storage (entries,
                                          values, lists) and the records keyed
                                          by its entries (revision, digest)
scratch:<RootId> ScratchDoc, one a root   pi's pending state while a run in
                 while a run needs it     that root needs it (a reply's frames,
                                          a tool's checkpoints): the host's
                                          only, shared with no client,
                                          destroyed between runs (ADR-0188)
pinetrie:live      LiveDoc                  streams and active runs: compacted
                                          at every run's end, needed by no
                                          restarted host
pinetrie:card-places
                 PlacesDoc, Yjs           where every card is (ADR-0059),
                                          a canvas's on the board among them
                                          (ADR-0126); Yjs so the host undoes
                                          moves (ADR-0066)
moves:<writer>:<CanvasId>
                 UndoDoc, one a person    a person's history of moves in
                 and canvas               that canvas (ADR-0066, ADR-0116):
                                          the host's only, shared with no
                                          client; moves:<writer>, theirs
                                          outside any canvas (ADR-0126)
presence         ephemeral                who reads which thread, in which root
```

The host holds the session, `live` and the places, and a root only while a
step of its documents' keeper or a lease (a run's, say) holds it: one
upkeep lets go of every other, once no tab holds it (ADR-0162).
A client holds the session, `live`, the places and only the roots of the
canvases it shows; it reads every other root through its directory record. pi runs one
session and one harness per root (ADR-0092, ADR-0095).

### Document shape (entries: settled by S7; rest sketch)

The shape of a `RootDoc`: pi's storage and the host's `records`. A
`SessionDoc` holds `records` alone (ADR-0095).

- **entries** — `Schema.record(Schema.struct.json({...}))`: a dynamic-key map
  keyed by UUIDv7, values opaque immutable blobs. **Not** `Schema.list` (not
  idempotent — the same entry appended on two peers yields two copies, so any
  retry or at-least-once delivery silently duplicates conversation entries).
  **Not** `Schema.set` (rejected at runtime by the Loro backend this ran on
  then: `'set-op' is not yet supported`). `record` also gives O(1)
  `getEntries(ids)`, which is exactly pi's `Storage` access pattern.
  Since ADR-0023 each document is authoritative JSON (`json.bind`), written by
  the host alone and compacted between runs: since ADR-0063, only the
  documents a run touched.

  > **Load-bearing invariant (ADR-0009): entry ids must be unique.** A CRDT map
  > is a per-key LWW register; grow-only-set semantics emerge *only* because
  > every key is written exactly once and therefore never contended. S7 §3.4
  > confirms a same-key concurrent write **silently discards one entry with no
  > error**.

  Fields: `{id, parentId, fromId?, seq?, timestamp, type, thread, …}`: `thread`
  is the thread whose commit wrote it (ADR-0125).
- **values** — LWW map over `(namespace, key)`: pi's own. Carries
  `pi.branch.tip`, `pi.lane.*`, `pi.op.*`.
- **records** — the host's records (`pinetrie.*`, ADR-0062, ADR-0095: the
  directory, lanes, proposed changes, marks, digests, run-end reports, seats…), a record per
  namespace then key, written by the host directly. The session's document
  holds only these.

  > **Three registers are keyed by LANE NAME** (`values.js:62-65`):
  > `pi.branch.tip`, `pi.lane.state`, `pi.lane.config`. They are safe **only**
  > under single-writer lane names — **ADR-0011**. Note `pi.lane.state` carries
  > the steering **inbox**, so a clobber drops queued user messages, not just a
  > pointer. `pi.op.*` is keyed by `operationId` and presumptively uncontended
  > (assumed, not verified).
- **lists** — grow-only list + tombstones. Carries `pi.pending.assistant_frame`.
- **pending assistant text** — in `pinetrie:live` since ADR-0063; durable **`Schema.text()`**, written with
  `insert(at, delta)` and cleared on commit (ADR-0014). Ships only the inserted
  characters. **Do not use `Schema.string()` for anything that accumulates** —
  it is a whole-value LWW register, so appending to it is O(n²) **on every
  substrate**, durable included (measured: 144 582 B vs 18 131 B for the same
  stream).
- **images** — not in the document at all (ADR-0042). Their bytes are rows
  of `pinetrie_blobs` in the host's SQLite file, keyed by SHA-256; a chat holds
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

- **Entries are immutable** → plain offsets are permanently stable. No CRDT
  cursor needed. A gift from pi's data model.
- **Files are mutable** → need content addressing (blob hash or jj change ID),
  or pointers rot silently. A pasted image is content-addressed by
  construction: `/blob/<sha256>` names bytes that never change (ADR-0042).
- **A card's text is mutable and multi-writer** → the one place that genuinely
  needs a text CRDT's own positions: it is a Yjs `Schema.text()` per card
  (ADR-0048).

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

Decided, and not built yet; ADR-0168, proposed, would shelve it. Destination-aware and lazy (ADR-0005). pi summarizes on *leaving* a branch, with no
knowledge of where the summary will land. We summarize on *landing*, knowing the
destination — strictly more information, and it preserves optionality (an eager
summary can never be re-folded differently).

Given tree `A → {B, C}`, `C → {D, E}`, at `E`, "fold in B":

```
base   = path(root → A)      ← LCA. Sent ONCE.
theirs = path(A → B)         ← the branch being folded
ours   = path(A → C → E)     ← the destination
canvas   = "summarize `theirs` so it is useful at E"
```

This is git's three-way merge structure. Sending `A` once (not twice) both saves
tokens and tells the model what is common ground versus what diverged — the
distinction it needs to judge relevance.

The `ours` leg is mandatory (ADR-0010): in S5's ablation, a fold without it
had the model confidently recommend a design the destination had already
rejected. Dropping it is a correctness regression, not a quality one.

**Output is a merge node**: a new entry on E's branch with `fromId: B` alongside
`parentId: E`. This buys provenance, re-foldability, double-fold detection, and
a "landed" signal for the tree UI.

**Consequences:**

- Fold is an **LLM call** — it has cost and is nondeterministic. Two peers
  folding B concurrently produce two different merge nodes. Both are valid and
  immutable; the UI must expect this rather than assume idempotence.
- **Two folds into one thread's end contend for what comes after it, and a
  linear path cannot give it to both** (S12). This is a semantic conflict in
  *any* representation, not an artefact of our data model. No trunk is
  stored (ADR-0163): the host is the only writer of each thread's end
  (ADR-0120), so the second fold is a race like any other. Nothing is
  written, and it is folded again at the new end, as ADR-0010 prescribes, or
  it lands on a branch.
- Budget ladder when raw context does not fit: raw → per-leg compaction → pi's
  existing branch summary. Degrade knowingly.
- Undecided: fold a *path* or a *subtree*? Default to the subtree's active path,
  let the user pick a different tip.
- This generalizes across sessions — "fold in a teammate's branch" is the same
  operation across a Kyneta doc boundary. Multiplayer nearly free.

## Risks

| Risk | Mitigation |
|---|---|
| pi's experimental APIs churn (pinned at 0.99.2) | Pin exact versions; keep `Storage` the *only* deep coupling; diff upstream periodically, with `pnpm run conformance` as the gate. pi 1.x removed the harness and `Storage` from pi-agent-core (S219): moving past 0.99.2 is a decision |
| Kyneta is consumed from a local checkout | Published `@kyneta/*` predates what pine·trie imports, and a stale build is refused at load (S47): a missing named import stops the module before it runs |
| `seq` escapes its replica | `seq` is a derived replica-local **arrival** index (S1, ADR-0013): it must never cross a replica boundary or survive a restart |

The early risks the spikes retired (fold output (S5), a harness that
assumes a private world (S3), quadratic `@kyneta/schema` writes (S14),
list cursors under CRDT semantics (S1)) are in their findings.
