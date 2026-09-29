# Pineta — project handoff

**Read this first.** It is the orientation document for anyone (human or agent)
picking the project up cold. The detailed record lives in `docs/`; this
file exists to tell you what matters, what is decided, and what to do next.

> The architectural record lives alongside this file in `docs/` and is
> **tracked**. `00`–`05` are the standing documents; `findings/` holds the 21
> spike reports that are the evidence behind them. This file is the orientation
> layer over the top.
>
> **Implementation plans are not here.** They live in `.plans/`, one per
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
*Since ADR-0032 and ADR-0034, every agent lane is a Worktree: a Linux
container on its own disk, with its own jj repo, and a branch clones its
parent's disk. An Aside is a conversation thread. ADR-0033 resolves the
effect merge.*

### Merge is three problems

Conflating these wasted time early, so keep them separate:

1. **Structural** — two peers append under different parents; the tree
   converges. *Free from CRDTs. Not where the work is.*
2. **Context** — what text enters the model's window when a branch lands.
   *The actual product problem.* Solved by a destination-aware three-way fold.
3. **Effect** — filesystem side effects of a branch that ran tools. *Unsolved,
   out of v1,* needs isolated workspaces + a real jj merge, committed atomically
   with the conversation merge. *Decided in ADR-0032 (a revision per turn,
   landing as a jj merge), ADR-0033 (the agent resolves conflicts, and the
   repository decides the outcome) and ADR-0034 (a container and disk per
   lane). Landing is built; folds' file merges are not.*

---

## 2. Where we are

**The walking skeleton walks all five layers**, with automated coverage at each:

```
browser page ─┐
              ├─ Kyneta Line (websocket) ─ Node host ─ pi-agent-core AgentHarness
Node client ──┘                                              │
                                                     KynetaStorage (ADR-0013)
                                                             │
                    json.bind doc ── replicated back ── ┘
```

Twelve spikes resolved, fourteen ADRs, **no open blockers**. The gate was fully
discharged before any non-disposable code was written.

### Current state

| gate | command | status |
|---|---|---|
| lint + format | `pnpm run lint` | clean (Biome, Kyneta's settings) |
| module boundaries | `workspace.test.ts` (in `pnpm test`) | ok |
| unit (pure core) | `pnpm test` | 240/240 (Vitest) |
| mutations | `pnpm mutate scripts/mutations/<list>.ts` | 116 listed; anchors checked in `pnpm test` |
| pi's own Storage suite | `pnpm run conformance` | 21/21 + 21/21 control |
| end-to-end | `pnpm run e2e` | 140/140, on the scripted model |
| with a real model | `pnpm run e2e:live` | 121/121 |
| **real browser** | `pnpm run e2e:browser` | 71/71 |
| types | `pnpm run typecheck` | clean (strict) |
| all-but-browser cascade | `pnpm run verify` | green |

41 TypeScript files, ~8 500 lines. Stack: pnpm workspace · TypeScript (strict,
**no build step** — Node 24 strips types natively) · Vite · Vitest · Biome ·
Playwright.

### Layout

```
apps/pineta/           @pineta/app          host and e2e suites (run, never imported)
apps/conformance/      @pineta/conformance  pi's Storage suite vs our adapter
packages/core/         @pineta/core         declares NOTHING
packages/schema/       @pineta/schema       Kyneta only; the document shape
packages/pi/           @pineta/pi           THE pi boundary
packages/protocol/     @pineta/protocol     the wire contract and its codec
packages/marginalia/   @pineta/marginalia   Pineta's shapes in pi: references, chat, notes, outbox
packages/reads/        @pineta/reads        document reads shared by host and client
packages/lanes/        @pineta/lanes        lane containers, disks, and jj/git (ADR-0032–0034, 0038)
packages/client/       @pineta/client       browser UI; owns its Vite build
(root)                                      development tooling only
```

Dependency direction is physical: **core → schema, protocol → pi, client → app**.
The root declares only tooling, so a package can import only what it declares.

---

## 3. Decisions that constrain everything (ADR-0001..0031)

Full text with rationale and rejected alternatives: `docs/02-decisions.md`.
The ones you must not violate by accident:

**ADR-0009 — entry ids must be unique and coordination-free.** Entries live in a
keyed record, a per-key register (a Loro map when this was decided; `json.bind`
with one writer since ADR-0023, where the hazard cannot arise but the rule
stays). Grow-only-set semantics hold *only*
because each key is written exactly once. A same-key concurrent write **silently
discards one entry — no error, no conflict**. Never derive an id from content,
index, or position. Use pi's default `IdGenerator` (verified safe in S9: a
41-bit monotonic counter, intra-process collision probability exactly 0).

**ADR-0011 — never share a lane (superseded by ADR-0020).** pi keys three
registers by lane name (`pi.branch.tip`, `pi.lane.state`, `pi.lane.config`).
Two writers on one lane silently orphan a whole turn, drop queued steering
messages, and lose an in-flight operation record. That danger still holds; the
answer changed: lanes now belong to threads, the host is their only writer, and
`LaneName` is mintable only by `laneNameForThread()`.

**ADR-0020 — lanes belong to threads and never move; people own none.** A lane
is created where agent work is first wanted in a thread, and its tip is always
the thread's end. Conversation threads have no lane. A running lane is never
written: messages wait in `pineta.outbox`. A compelled reply another writer
raced is a `conflict`; the sender chooses to queue or branch. Supersedes
ADR-0011.

**ADR-0024 — presence is ephemeral, per open column, written by each client.**
Who is here decays rather than leaving; every column of the tab you are on
reports its thread (ADR-0029).
Rings on the rail, avatars in column headers, typing in the composer; never
yourself. The host refuses client writes to the session.

**ADR-0025 — notes: a message opened for everyone's editing, or a draft of the
next one.** The text is a Yjs document per note; the record is a host-written
`pineta.note` value; entries stay as sent, and the model reads them so. One
draft per thread end, sent through the one send path. Contributors come from
each edit's Yjs `clientID`. The host refuses writes to a done note.

**ADR-0026 — everything queued is a note; the queue waits at a
note someone has open.** A message waiting for a busy lane becomes a `queued`
note that anyone can edit, cancel, or release from someone's hold. The host
takes notes in order and stops at one someone is editing. It refuses no write
to a note that has a record, because a refused write cannot be recovered from
(S28). Replaces `pineta.outbox`.

**ADR-0029 — a tab per root, an archive shared by everyone.** A column's
context is its path to its root, so the screen splits there: a root tab has
its own rail and columns (the tab bar, at first everyone's, is now each
person's, ADR-0030). Archiving is a host-written `pineta.archive` record; it hides a root
and makes it read-only for everyone, deletes nothing, and is refused while the
agent works there. The Archive tab finds and restores any root; the add tab
starts one. Which tab you are on, and each root's columns, are kept per
browser tab (amends ADR-0027).

**ADR-0030 — your tabs are yours; the header shows who is here, and your
inbox of mentions.** Your tabs are the roots you opened; × closes one for you
and writes nothing, and a root someone else starts opens none. The header
shows, from live data, an avatar per person here and the agent while it works,
each with a menu of their threads. `@` lists the messages that mention you;
which you have seen is kept per device (`localStorage`), never in the
document. Nothing opens a tab by itself.

**ADR-0021 — a thread's mode is its lane; a mention picks the addressee.** A
thread with a lane is agent work, one without is a conversation; nothing is
stored. Mentions pick who a message is for (naming only people leaves the
agent out); with none, the mode fills in. Branches start as conversations; one
from agent work starts with `@agent ` typed, and deleting it at an agent
thread's end steps back down to a conversation; the add tab offers
agent work, or a conversation (ADR-0029). A session is its participants; threads
are topics inside it. Amends ADR-0018 and ADR-0020.

**ADR-0022 — the agent works in its own repo, visibly, with the person's
models.** The development host's agent reads, writes, edits and runs commands
in the repo, with hot reload off (`PINETA_TOOLS=0` turns tools off). The host binds to loopback; anywhere else it
admits only the invite key. Models come from the person's pi setup (only the
extensions' providers are applied). Replies and tool output are one kind of
stream, written as text edits; pi's checkpoints are stored the same way. Stop
ends a thread's turn. The session persists in `.pineta/pineta.db`.

**ADR-0019 — a lane is a line of work, not a unit of parallelism.** A person's
lane is a *conversation lane* and never touches disk. A *work lane* carries
agent work and will own a jj workspace, so creating one is deliberate, and fold
merges both the tree and the workspace. A busy agent queues; it never grows
more lanes. Moving the agent's lane across branches is valid only while its
runs do not touch disk.

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

**ADR-0016 — never race a child container.** A child container created
lazily under a record key loses one writer's contents when two replicas create
it concurrently (S18: 0/40 trials). Lazily created containers must be keyed by
globally unique ids; where writers can share an address, store one leaf
register per address. That is why pi's `values` stay flat under an opaque
`physicalKey`.

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

### Kyneta

Local workspace at `~/halecraft/kyneta`, wired by `link:` deps. **Published
`@kyneta/*` 3.0.0 is unusable** — it predates the O(δ) write fix and declares a
`loro-crdt` floor of `>=1.8.0` where the real floor is `>=1.13.4`. A stale
build is refused at load: Node refuses a module whose named import is missing
before any of it runs (S47), and the host imports what v4 added (`whenPeer`,
`yjsClientId`). Pineta tracks the local checkout's `needed-by-pineta`
bookmark, Kyneta v4 as of `PLAN-2026-09-28-kyneta-v4`.

Three issues were filed to the Kyneta team (`docs/findings/kyneta-issues-verification.md`):
`compact()` throws on live Loro docs (**moot for Pineta** since ADR-0023: the
session is `json.bind`, compacted live, and ADR-0014's ~5.6 KB residue per
message is gone); the `Line` schemaHash collision (**fixed**); and
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
is declared *only* by `packages/pi` and `apps/conformance`. pnpm's
`node_modules` is strict, so from the app every spelling fails at resolution —
`import()`, a template literal, `createRequire`. This replaced a syntax scan
that **all three evaded**. Every other package boundary now works the same way:
the root declares only tooling, so a package can import only what it declares.
`workspace.test.ts` checks the manifests. See `docs/01-architecture.md`.

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

**The stack is complete.** `packages/client/app.tsx` is React, rendering from the same
Exchange `connectSession` already owns (handed to `ExchangeProvider`), so Node
and browser still share one connection story and `e2e` drives the real thing.
Hook names, verified against source: **`useTracked(thunk)`** for a derived
read — *not* `useValue`, which takes a `CallableRef`; `useDocStatus` returns the
string union `"pending" | "empty" | "populated"`, not an object.

**The interface is your tabs, one per root, each a rail beside columns**
(`docs/06-interface.md`, `packages/client/TECHNICAL.md`, ADR-0029, ADR-0030),
under a header showing who is here and your inbox of mentions: each
column is one path on its own scroll, a branch opens beside its parent in its
rail track's colour, and the rail draws the tab's root, with each uneventful
stretch drawn as one capsule (ADR-0031). The Archive tab lists every root.
Views are pure functions over one `indexTree` (`packages/core/tree.ts`,
`roots.ts`); which tab you are on, your open roots and each root's columns are
a reducer in `packages/client/layout.ts`, never written, and the inbox is
`packages/client/inbox.ts`.

`useText` binds each note's textarea to its Yjs text (ADR-0025): the first
genuinely collaborative edit. Each person's composer stays local `useState`.

**An image pasted into a composer reaches the agent** (ADR-0042): uploaded
to `POST /blob`, kept by SHA-256 in `pineta_blobs` beside the session in
the host's SQLite file, referred to by the message's markdown and its
`details.images`, and handed to the model as image parts by pi's
`toProviderMessages`. Admission now also refuses another origin, and on
loopback a rebound name. Images in tool results, workspace paths, remote
images, and pasting into notes are still to do.

**Steps 1–5 are done** (ADR-0018). Now continue thickening (`docs/04-roadmap.md`), each step
independently shippable:

1. ~~tree read~~ — done: `projectSpine`, spine + branch markers, navigation is client-local state
2. branch write — create a branch from any entry; Aside first
3. ~~concurrent lanes~~ — done; since ADR-0020, a lane per thread, not per writer
4. ~~references~~ — done: pi values in `pineta.reference`, derived backlinks (ADR-0017)
5. ~~humans in the tree~~ (ADR-0018) — done: chat and compelled responders, presence (ADR-0024), notes and drafts (ADR-0025)
6. Scout — read-only tools
7. fold — three-way merge producing a `fromId` node

**v1 demo:** two browser windows, one host, one tree. A runs a long task on
trunk; B branches an Aside three turns back, asks, gets an answer, attaches a
reference — and it appears live in A's tree **with zero tokens entering A's
context.**

### Open, non-blocking

- **A refused write to a note splits that client's replica.** Its later edits
  build on the refused one and never reach the host, even after the note is
  reopened (S26 addendum 2). The host keeps those later edits as pending
  structs. Before Kyneta v4, a fresh replica under the same peer id collided
  with them and corrupted the text (S28); a reload is now a new seat, with a
  `clientID` of its own (ADR-0037). Someone marking a note done while another
  person types gets there. ADR-0026 stops refusing writes to notes that have a
  record.

- **Kyneta ephemeral: a write and a deletion in the same millisecond diverge.**
  A peer that sets a key and deletes it within one millisecond applies both in
  order, so the key is gone there; on other peers the equal timestamps tie and
  the write wins, so the key stays. Measured through Pineta's host: 14 of 20
  such deletions lost; 3 ms apart, 0 of 20. One peer's later operation should
  beat its own earlier one. In Pineta it needs a column refreshed and closed in
  the same millisecond, and leaves only an empty key readers skip. To file
  upstream.

- ~~**Kyneta's store repeats bytes when commits overlap**~~ — fixed in Kyneta
  (locally, unreleased), verified from Pineta: 0 overlapping records, where one
  tool run had 133 KB of 345 KB (S22 addendum). Pineta needs the Kyneta release
  that carries it.
- ~~**`compact()` on a live Loro substrate throws**~~ — moot: the session is
  `json.bind`, which compacts live (S24, ADR-0023). It still throws on Loro and
  Yjs; **live Yjs compaction** is what collaborative documents wait for.
- **A client's command Line is stored and never compacted.** Each Line document
  grows about 1 KB per command, and the host cannot compact the half a client
  writes. Line's pruning should compact it: to file upstream.
- **While a tool runs, its output is in the session document twice:** the live
  stream, and pi's checkpoint (its crash recovery). So clients receive it twice.
  Compaction clears both when the run ends, so it costs bandwidth during a run,
  not storage. One text would do if pi's `tool_update` carried the checkpoint's
  key (`operationId`/`invocationId`): an upstream request to pi, low priority.
- **Identity is not authenticated.** The invite key decides who gets in; a
  person is the email their client names, unverified, so a collaborator can
  pose as another (ADR-0022, ADR-0037). Next: an email with a generated token.

- **S15** — the trunk winner rule uses wall-clock `ts`; clock skew is
  adversarial. Needs a Lamport clock (S1 deliberately built none).
- ~~**S16**~~ — moot: compaction removes ADR-0014's residue (ADR-0023).
- **S10 remainder** — snapshot/sync-payload size at scale.
- **S6** — file-range reference anchoring (only matters for Worktree branches).
- ~~`scripts/check-boundaries.ts` has no tests~~ — deleted. Boundaries are
  now enforced by resolution; see `docs/01-architecture.md`.
  It has now failed the same way twice (`.mjs`-blind, then `.tsx`-blind) while
  reporting "all boundary rules hold".
- ~~Multi-writer is proven only at the *storage* layer.~~ Since ADR-0020, two
  threads' lanes run at once in e2e, and one thread's writers queue.
- **A run's refusal cannot reach its author.** The host replies `started`
  before pi admits the run, so a refusal is only logged; the message is kept
  in the tree (`settleRun`), with no reply. A second reply, sent once the run
  is admitted, would fix it; it changes the protocol.

### Standing chores

- Republish `@kyneta/*` **and raise the declared loro floor** — shipping the code
  fix with `>=1.8.0` lets consumers install a 17×-slow combination silently.
  (Pineta no longer uses Loro, but other Kyneta users do.)
- Exercise `@kyneta/react` + `@kyneta/devtools` against Kyneta's in-place
  mutation change (they are the likeliest holders of an object-identity
  assumption).
- Periodically diff pi upstream; `pnpm run conformance` is the gate.

---

### Running Pineta on itself

- `pnpm run host` starts the development host: loopback, your pi settings'
  model, the session in `.pineta/pineta.db`. The agent has its tools, and each
  thread's agent works in its own Linux container (ADR-0034), on a disk
  cloned from the turn it branched at: a root thread's starts from your
  committed work (`@-`), with dependencies installed, so commit what it should
  see. It sees its own directory at `/workspace` and your working copy at
  `/mnt/host-working-copy`, read-only, and nothing else of your machine unless `pineta.json`
  grants it. Your working copy is yours, so hot reload stays on. It needs
  Apple's `container` running (`docs/05-stack.md` D10); without it, threads
  work directly. Restart the host to pick up changes to host code.
- **Who you are** (ADR-0037): the page asks for your email and name once per
  browser. The email is who you are, in every tab and on every device; the
  name is how you are shown, renamed in your profile: the avatar at the
  header's right. **Not you?** there forgets the email on that browser.
- **Your pi skills and prompts are commands** (ADR-0036):
  `/<package>:skill:<name>` for a skill, `/<package>:<name>` for a prompt
  template. For example `/duane:skill:plan` or `/duane:comments`. Typing `/`
  and part of a name offers them. The package's name is its
  `.claude-plugin/plugin.json` name, else its package name without the
  scope. `commands.names` in `~/.config/pineta/config.json` renames one, keyed
  by the path or source in pi's `packages` setting. Their files are readable
  in every thread's lane, read-only.
- **Sharing a directory with every thread** (ADR-0035), e.g. your plans:
  list it in `~/.config/pineta/config.json` as
  `{ "lanes": { "shared": [".plans"] } }`, and ignore it in
  `~/.config/git/ignore`. Every thread's agent then reads and writes
  `/workspace/.plans`, which is your `.plans`, live, and never part of a
  branch. A project can share a directory for everyone in `pineta.json`'s
  `lanes.shared`. A changed config reaches existing threads at their next
  run, after a host restart.
- **Bringing a thread's work back** (ADR-0038, ADR-0039, ADR-0040): each
  thread has a two-word name, shown in its column's header, and keeps an
  offer in your repo, one commit on your `@-` under the bookmark
  `pineta-offer/<name>`. While the thread works, the offer reads
  `WIP (<name>): <its first message>` and grows in place; when a run ends,
  an agent writes its commit message. See it in jj or jjui before you take
  it: it shows its conflicts with your committed work. **take**, in the work
  strip at its column's foot, puts it under your uncommitted edits. Reword,
  squash or split it like any commit of yours; the host then leaves it
  alone. **split into a stack** has the agent rewrite it as reviewable
  revisions. Set the bookmark `pineta-onto` to have offers land on another
  commit instead, such as a branch you are not on; each take moves it up.
  `jj git push --all` would push it: push by name.
- **Sending your work to a thread:** the work strip's `⋯` offers **update
  from my work**: your `@`, uncommitted edits included, merged into the
  thread's own copy. The thread gets a note of what changed, and your
  composer a line you may send. When it conflicts, the agent resolves it, or
  asks you (ADR-0033). A new root thread starts from your `@` as it is,
  uncommitted edits included. A thread's own history is in your repo out of
  sight:
  `jj log -r '::remote_bookmarks(remote=glob:"pineta-*") ~ ::@'`.
- **Working directly:** the send button's `▾` sets a new thread to work in
  your working copy, or any directory, with no container, as you. A branch
  inherits its thread's setting. `PINETA_LANES=0` makes it the default. Such
  a thread shares its directory, and hot reload waits while one runs in yours.
- `PINETA_TOOLS=0` removes the tools. A thread's agent that starts the
  development host itself needs `PINETA_PORT=0`, or it collides on 7391.
- **Inviting a collaborator:** `PINETA_BIND=0.0.0.0` (or an address). The host
  prints an invite link per network address, with its key; `PINETA_KEY` fixes
  the key. Everyone with the link gets in, and with tools on, can run commands
  on this machine as you. Use a trusted network or a tunnel.
- `PINETA_PROVIDER` / `PINETA_MODEL` override the model. A root schema change
  cannot open an existing store: move `.pineta/pineta.db` aside.

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
- **A check without a proof it can fail is not yet a check.** Prove it with a
  mutation, listed as data in `scripts/mutations/*.ts` and run by
  `pnpm mutate scripts/mutations/<list>.ts [name]`. The harness
  (`scripts/mutate.ts`) holds the rules: an anchor must occur exactly once, the
  file is always restored, a mutant that does not load is BROKEN, and with
  `expect` the intended check must be the one that fails (else ELSEWHERE). A
  mutant must be valid code, so it fails on behaviour, not on a typo. A fast
  test (`scripts/mutations.test.ts`) keeps every list's anchors from drifting.

### Map of the record

| file | what |
|---|---|
| `docs/00-vision.md` | product thesis, branch kinds, v1 scope |
| `docs/01-architecture.md` | evidence base, layer cake, data model, module layout |
| `docs/02-decisions.md` | **ADR-0001..0025** with rationale |
| `docs/03-spikes.md` | S1–S16, each with question + kill criterion |
| `docs/04-roadmap.md` | sequencing, invariants, action items |
| `docs/05-stack.md` | stack decisions, sandbox constraints |
| `docs/findings/` | 21 spike reports — the evidence |
| `sandbox/` | disposable spike code (gitignored), kept for reproduction |
