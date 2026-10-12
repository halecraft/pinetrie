# pine·trie — project handoff

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
| unit (pure core) | `pnpm test` | 1875/1875 (Vitest) |
| mutations | `pnpm mutate scripts/mutations/<list>.ts` | 1172 listed; anchors checked in `pnpm test` |
| pi's own Storage suite | `pnpm run conformance` | 21/21 + 21/21 control |
| end-to-end | `pnpm run e2e` | 13 scenarios, 46 checks, on the scripted model (S94) |
| with a real model | `pnpm run e2e:live` | the `live` scenario: 3 checks |
| **real browser** | `pnpm run e2e:browser` | 4 scenarios, 167 checks; in a lane with no containers, the 6 that need one report SKIP |
| test budget | `scripts/budget.test.ts` (in `pnpm test`) | 18 host and lanes scenarios ≤ ⌊√1875⌋; 4 browser ≤ ⌊√18⌋ |
| types | `pnpm run typecheck` | clean (strict) |
| all-but-browser cascade | `pnpm run verify` | green |

41 TypeScript files, ~8 500 lines. Stack: pnpm workspace · TypeScript (strict,
**no build step** — Node 24 strips types natively) · Vite · Vitest · Biome ·
Playwright.

### Layout

```
apps/pinetrie/           @pinetrie/app          host and e2e suites (run, never imported)
apps/conformance/      @pinetrie/conformance  pi's Storage suite vs our adapter
packages/core/         @pinetrie/core         declares NOTHING
packages/schema/       @pinetrie/schema       Kyneta only; the document shape
packages/pi/           @pinetrie/pi           THE pi boundary
packages/protocol/     @pinetrie/protocol     the wire contract and its codec
packages/rules/        @pinetrie/rules        each stored shape and the pure rules about it
packages/reads/        @pinetrie/reads        document reads shared by host and client
packages/lanes/        @pinetrie/lanes        what a lane is and runs; the LaneRuntime port, no runtime (ADR-0032–0034, 0103)
packages/docker/       @pinetrie/docker       lanes on Docker, on btrfs subvolumes (ADR-0130)
packages/vm/           @pinetrie/vm           the Mac's lane VM: image, launcher, a host's lease on a slot (ADR-0130)
packages/keeper/       @pinetrie/keeper       declares NOTHING; one step at a time on a resource
packages/repo/         @pinetrie/repo         your repo: reads, steps, the owner (ADR-0038, 0060, 0065)
packages/session/      @pinetrie/session      one client's connection to a host; no React
packages/shell/        @pinetrie/shell        unbash only; shell source as structure (ADR-0114)
packages/interface/    @pinetrie/interface    what a person sees and does, for any client; no React, no DOM (ADR-0093)
packages/web/          @pinetrie/web          the browser page: React and the DOM; owns its Vite build
(root)                                      development tooling only
```

Dependency direction is physical: **core → schema, protocol → pi, session, shell → interface → web → app**.
The root declares only tooling, so a package can import only what it declares.

---

## 3. Invariants you must not violate by accident

Each is one line here. The living doc beside it says how the code keeps
it, and the ADR says why. Every decision in force is in `docs/adrs/`, and
`pnpm run record` writes `docs/record.md`, an index of them by living doc.

| invariant | ADR | living doc |
|---|---|---|
| Entry ids are unique and coordination-free: never derived from content, index or position; pi's `IdGenerator` makes them. A same-key concurrent write silently drops an entry. | ADR-0009 | `docs/01-architecture.md` |
| Never race a child container: a lazily created container under a shared key loses a writer's contents (S18). Key it by a unique id, or store one leaf register per address. | ADR-0016 | `packages/schema/TECHNICAL.md` |
| `seq` is a derived, replica-local arrival index. It never crosses the wire and is never stored; nothing renders by it. | ADR-0013 | `packages/pi/TECHNICAL.md` |
| Never `Schema.string()` for anything that accumulates: it is a whole-value register, so appending is O(n²). | ADR-0014 | `docs/01-architecture.md` |
| Entries are immutable; a merge is a new node, never an edit. The tree is explicit (`parentId`), never a CRDT's history. | ADR-0004, ADR-0008 | `docs/01-architecture.md`, `packages/schema/TECHNICAL.md` |
| A fold's `ours` leg is mandatory. | ADR-0010 | `docs/01-architecture.md` |
| Only `packages/pi` imports pi. | ADR-0003 | `AGENTS.md`, `packages/pi/TECHNICAL.md` |
| The host is the only writer of the session's documents; clients send commands. A lane belongs to its thread, and is never moved. | ADR-0120, ADR-0023 | `ARCHITECTURE.md`, `packages/schema/TECHNICAL.md` |
| Everything unsent is a card, and a card's place has one owner at a time: the host, or a person's inventory. | ADR-0048, ADR-0059 | `packages/schema/TECHNICAL.md` |
| One owner writes your repo, and the host never touches the working copy or `@` except in a publish with `publish.catchUp` on, as you. An acceptance is a forward bookmark move. | ADR-0065, ADR-0104 | `docs/the-jujutsu-repo.md`, `packages/repo/TECHNICAL.md` |
| What the host cannot tell, it does not act on: an unknown answer never builds an offer. | ADR-0067 | `packages/repo/TECHNICAL.md` |
| Every thread's agent works in a lane of its own; nothing works directly in a directory. | ADR-0102, ADR-0130 | `ARCHITECTURE.md`, `packages/lanes/TECHNICAL.md` |
| What a person sees and does is decided in `@pinetrie/interface`, with no DOM and no React. | ADR-0093 | `packages/interface/TECHNICAL.md` |
| One word per concept: accepted work, accept, offer, WIP, publish, catch up. | ADR-0100 | `docs/glossary.md` |

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
`yjsClientId`). pine·trie tracks the local checkout's `needed-by-pinetrie`
bookmark, Kyneta v4 as of `PLAN-2026-09-28-kyneta-v4`.

Three issues were filed to the Kyneta team (`docs/findings/archive/kyneta-issues-verification.md`):
`compact()` throws on live Loro docs (**moot for pine·trie** since ADR-0023: the
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

**ADRs are encoded as types where possible.** Entry ids, run ids and lane
names are branded (`EntryId`, `RunId`, `ThreadId`), so a swapped argument is
a compile error. They are minted where they enter: the protocol codec, the
reads (`renderableEntry`), the schema's readers, `@pinetrie/rules`' decoders, a
commit's trailer (`packages/lanes`), the pi adapter, the client's stored forms,
and the host's id generator. Biome's `noRestrictedImports` (`biome.json`)
refuses `entryId` in core, the client and the host, and `runId` in core and
the client (S95). A `LocalSeq` brand was deleted (ADR-0013
above); `projectTranscript(entries, tipId)` cannot even accept a seq.

**FC/IS — gather → plan → execute. Decisions are values.** `packages/core` is
pure and imports nothing; the shell in `host/` performs the decision. This
mirrors pi's own lane loop.

**No build step.** Node 24 strips types natively, so imports name the real file
(`./index.ts`). Native stripping does **not** support enums, namespaces,
parameter properties, or decorators.

---

## 6. What to do next

**The stack is complete.** `packages/web/app.tsx` is React, rendering from the same
Exchange `connectSession` (`@pinetrie/session`) already owns (handed to `ExchangeProvider`), so Node
and browser still share one connection story and `e2e` drives the real thing.
Hook names, verified against source: **`useTracked(thunk)`** for a derived
read — *not* `useValue`, which takes a `CallableRef`; `useDocStatus` returns the
string union `"pending" | "empty" | "populated"`, not an object.

**The interface is the sidebar of roots down the left, and the root you are
on, a rail beside columns** (`docs/06-interface.md`,
`packages/interface/TECHNICAL.md`, ADR-0029, ADR-0122), over a footer showing
who is here, what needs you and the board, which slides up over the columns
with every root in its workflow state: each
column is one path on its own scroll, a branch opens beside its parent in its
rail track's colour, and the rail draws the root, with each uneventful
stretch drawn as one capsule (ADR-0031), a long ask's work a capsule of its
own (ADR-0056).
Views are pure functions over one `indexTree` (`packages/core/tree.ts`,
`roots.ts`); which root you are on and each root's columns are a reducer in
`packages/interface/layout.ts`, the sidebar is your `open:` document
(`packages/session/open-threads.ts`), and the inbox is
`packages/interface/inbox.ts`.

The composer is your message (ADR-0048, ADR-0113), which only you see;
what people edit together before it is sent is a note. The composer is one
uncontrolled textarea, bound with Kyneta's `attach` to the card's text
from the keystroke that creates it (`packages/web/card-editor.tsx`).

**An image pasted into a composer reaches the agent** (ADR-0042): uploaded
to `POST /blob`, kept by SHA-256 in `pinetrie_blobs` beside the session in
the host's SQLite file, referred to by the message's markdown and its
`details.images`, and handed to the model as image parts by pi's
`toProviderMessages`. Admission now also refuses another origin, and on
loopback a rebound name. Images in tool results, workspace paths and remote
images are still to do.

**Live work hands over to its entry in one render** (ADR-0044). A reply is
its lane's current reply while the lane's tip is where it opened, and its
entry moves the tip. A tool's output streams in its own row. The layout is
drawn from the render's own facts. A column at its end does not get shorter
while the agent works: a floor takes up a shrink. The browser suite checks
this frame by frame at 20× CPU throttle.

**A root's tab can be renamed** (ADR-0045). A title is a mark on the root:
a host-written `pinetrie.mark` value keyed by the entry, set from the tab's
`⋯`, the last write winning, and deleted when cleared. It is the root's
label everywhere it is named, the Archive search included. ADR-0028's
descriptions, section headers and boundaries are still to do.

**A lane can ssh where its host can** (ADR-0140). Your own identity is
your agent's keys; lanes use it once you approve each lane, in its
column's header. Turn it on for every project, and say who approves, in
`~/.config/pinetrie/config.json`:

```json
{ "owner": "you@example.com", "lanes": { "ssh": { "personal": true, "hosts": ["pop", "*.lan"], "approvalSeconds": 120 } } }
```

`hosts` and `approvalSeconds` are optional; a project grants it with
`lanes.ssh: true`, and `false` in yours declines it. Service identities
are key pairs in `~/.config/pinetrie/ssh/`, with an optional ssh `config`
beside them naming their hosts (a relative `IdentityFile` means that
folder); every lane uses them unasked. The host reads your `~/.ssh/config`
for names, so `ssh pop` works in a lane.

**Every thread has an icon** (ADR-0143), in place of the ✦ before its
name: in its header, its details, its folded strip, its card and the folded
list. Where it comes from is `icons.source` in
`~/.config/pinetrie/config.json`:

```json
{ "icons": { "source": "built-in" } }
{ "icons": { "source": "drawn", "model": "openrouter/recraft/recraft-v4.1-flash" } }
{ "icons": { "source": "none" } }
```

- **`built-in`**, the default, also with no `icons` at all: the 32×32 pixel
  sprite of the thread's name's noun, one of 256 shipped with the page
  (`packages/web/public/noun-icons/`, made in S188 and S190). No key, no
  request.
- **`drawn`** (ADR-0050, ADR-0053): pi's OpenRouter key draws one from the
  name. A thread is named as its column first wants an agent, before its
  first message (ADR-0057), and its name then fills the `column-banner`
  skill, a prompt you can replace with your own; `model` names the image
  model, Recraft V4.1 Flash by default. Only the name is sent. The thread
  shows ✦ until it arrives, and a failed one is tried again at the thread's
  next run's end.
- **`none`**: ✦ alone.

A drawn or pasted image is stored as a pasted image is, under a
`pinetrie.banner` value keyed by the lane, and wins under any source. The
agent's `set_banner` sets a pasted image under any source, and a new one from
your words only under `drawn`.

**A column folds each ask's work** (ADR-0056). An ask is a message that
started a run, with that run, read from the tree (`indexAsks`,
`packages/core/asks.ts`). A column is read in outline, story or raw: story
shows each ask's message, one digest line folding its work, and its last
word. The rail and the column compact the same stretches: one landmark rule
(`railLandmarks`) is drawn apart in both, and a long ask is a dot and a
capsule of its own. A bar names the ask whose work is at the column's top; a
"since you were here" line marks where you last left a thread, on any
device of yours; an
ask's files open a review of its range of revisions, from the paths each
turn's revision records. Stop queues a fact naming who pressed it, which
the run's end appends to the thread for the agent to read. Unless
`{ "digests": { "enabled": false } }` turns it off, a model writes each long
ask a digest (`pinetrie.digest`, the `ask-digest` skill, ADR-0075), which no
agent reads: a headline that leads the ask's fold line, and a few points
under it in story, or nothing when the agent's last message says it all.

**A thread's followers are told how its runs end** (ADR-0077). You follow a
thread once you have written on it (`RootRecord.threads`). At each run's end
the same request asks a model for a verdict, digests on or off: needs you,
worth a read, or done, with a one-line reason (`pinetrie.verdict`, one per
lane); a failed or stopped run's verdict is its facts. A tab's mark says
what its threads need of you: a still ring while the agent works, an amber
dot that pulses as it arrives when something needs you (a question, an
error, work ready to add), a dim one when something is worth a read, a ✓
that fades when a run ends with nothing to do. What you have dealt with is
yours on every device, in your attention document (`attention:<writer>`,
beside your inventory): how far you read each thread, what you marked "not
needed", and the mentions you have seen.

**The rail outlines what each column shows** (ADR-0058), in the column's
colour, and scrolls to keep the outline of the column you move in view. A
column of a tab shown again comes back where you left it, by message: the
same measurement (`packages/interface/viewport.ts`). Spots last the page's
life; keeping them for a person across devices is the next step.

**Steps 1–5 are done** (ADR-0018). Now continue thickening (`docs/04-roadmap.md`), each step
independently shippable:

1. ~~tree read~~ — done: `projectSpine`, spine + branch markers, navigation is client-local state
2. branch write — create a branch from any entry; Aside first
3. ~~concurrent lanes~~ — done; since ADR-0120, a lane per thread, not per writer
4. ~~references~~ — done, then withdrawn (ADR-0043): nothing read them
5. ~~humans in the tree~~ (ADR-0018) — done: chat and compelled responders, presence (ADR-0024), notes (ADR-0025, since removed), and cards (ADR-0048)
6. Scout — read-only tools
7. fold — three-way merge producing a `fromId` node

**v1 demo:** two browser windows, one host, one tree. A runs a long task on
trunk; B branches an Aside three turns back, asks, gets an answer, attaches a
reference — and it appears live in A's tree **with zero tokens entering A's
context.**

### Open, non-blocking

- **Kyneta ephemeral: a write and a deletion in the same millisecond diverge.**
  A peer that sets a key and deletes it within one millisecond applies both in
  order, so the key is gone there; on other peers the equal timestamps tie and
  the write wins, so the key stays. Measured through pine·trie's host: 14 of 20
  such deletions lost; 3 ms apart, 0 of 20. One peer's later operation should
  beat its own earlier one. In pine·trie it needs a column refreshed and closed in
  the same millisecond, and leaves only an empty key readers skip. To file
  upstream. The host suite's `presence` scenario sleeps 20 ms before such a
  deletion; that wait is listed in `FIXED_WAITS` (`scripts/budget.ts`)
  until Kyneta orders a peer's own operations.

- ~~**Kyneta's store repeats bytes when commits overlap**~~ — fixed in Kyneta
  (locally, unreleased), verified from pine·trie: 0 overlapping records, where one
  tool run had 133 KB of 345 KB (S22 addendum). pine·trie needs the Kyneta release
  that carries it.
- ~~**`compact()` on a live Loro substrate throws**~~ — moot: the session is
  `json.bind`, which compacts live (S24, ADR-0023). It still throws on Loro and
  Yjs; **live Yjs compaction** is what collaborative documents wait for.
- **A client's command Line is stored and never compacted.** Each Line document
  grows about 1 KB per command, and the host cannot compact the half a client
  writes. Line's pruning should compact it: to file upstream.
- **While a tool runs, its output is stored twice:** the live stream in
  `pinetrie:live`, and pi's checkpoint (its crash recovery) in its root's
  document. So a client holding that root receives it twice.
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
- ~~Multi-writer is proven only at the *storage* layer.~~ Since ADR-0120, two
  threads' lanes run at once, and one thread's writers queue.
- **The suites and their mutations spend most of their time waiting** (S65).
  What remains after the dead waits were removed, and the suites became
  scenarios (S94): the image clean-up delay and presence expiry as host
  options, short in the suites; mutants run in parallel, each in its own
  copy of the repository; and the suite checks listed in
  `scripts/unproven.ts` proved by a mutation, or deleted (the `lanes/*`
  ones on the Mac).
- **A run's refusal cannot reach its author.** The host replies `started`
  before pi admits the run, so a refusal is only logged; the message is kept
  in the tree (`settleRun`), with no reply. A second reply, sent once the run
  is admitted, would fix it; it changes the protocol.

### Standing chores

- Republish `@kyneta/*` **and raise the declared loro floor** — shipping the code
  fix with `>=1.8.0` lets consumers install a 17×-slow combination silently.
  (pine·trie no longer uses Loro, but other Kyneta users do.)
- Exercise `@kyneta/react` + `@kyneta/devtools` against Kyneta's in-place
  mutation change (they are the likeliest holders of an object-identity
  assumption).
- Periodically diff pi upstream; `pnpm run conformance` is the gate.
- At each milestone, sweep the record: for each living doc, check the ADRs
  whose Area it is against the code, and supersede any whose decision no
  longer holds (`docs/adrs/README.md`, Amendments).

---

### Running pine·trie

- `pnpm run host` starts the development host on pine·trie's own repo:
  loopback, your pi settings' model, the session in `.pinetrie/pinetrie.db`.
  `pnpm run host <folder>` serves another project instead, at that folder's
  jj or git root (ADR-0086). A relative folder is read from pine·trie's root,
  not the shell's directory. Each project keeps its own session in its
  root's `.pinetrie/`, which the host adds to the repo's exclude file before
  writing there; a jj repo with no git directory beside it is refused. The
  agent has its tools, and each
  thread's agent works in its own Linux container (ADR-0034), on a disk
  cloned from the turn it branched at: a root thread's starts from your
  committed work (`@-`), so commit what it should see. Nothing installs its
  dependencies: it does, as you would after a clone. It sees its own directory at `/workspace` and your working copy at
  `/mnt/host-working-copy`, read-only, and nothing else of your machine unless
  accepted work's `pinetrie.json` grants it: a grant you add applies once you
  commit and publish it, and a thread's own copy can only give grants up. Your working copy is yours, so hot reload stays on. It needs a
  jj repo and Docker (ADR-0102, ADR-0130): the lane VM on the Mac (`pnpm
  vm:build` once, in any Docker on the Mac), on Linux Docker with a btrfs lanes directory; without
  them the host says what is missing and does not start. Restart the host
  to pick up changes to host code.
- **`pnpm run host` serves React's production build** through Vite's dev
  server (`NODE_ENV=production`): hot reload stays, as a full page reload,
  and a long thread stays quick to type in (S59).
  `pnpm run host:react-dev` serves React's development build: its warnings,
  its render timeline and Fast Refresh, for work on the client's renders. The
  suites start their own host with development React.
- **A thread's container stops when its run ends**, and starts again at the
  next message. A dev server or watcher the agent started ends with the run.
  The agent is told this, and what else holds in every lane, by a short block
  in its prompt and a note at `/pinetrie/packages/pi/lane.md` (ADR-0121).
- **Who you are** (ADR-0037): the page asks for your email and name once per
  browser. The email is who you are, in every tab and on every device; the
  name is how you are shown, renamed on your profile page, from the menu
  your avatar at the footer's left opens. **Sign in as someone else** there
  forgets the email on that browser.
- **Your pi skills and prompts are commands** (ADR-0036):
  `/<package>:skill:<name>` for a skill, `/<package>:<name>` for a prompt
  template. For example `/duane:skill:plan` or `/duane:comments`. Typing `/`
  and part of a name offers them. The package's name is its
  `.claude-plugin/plugin.json` name, else its package name without the
  scope. `commands.names` in `~/.config/pinetrie/config.json` renames one, keyed
  by the path or source in pi's `packages` setting. Their files are readable
  in every thread's lane, read-only.
- **Sharing a directory with every thread** (ADR-0035), e.g. your plans:
  list it in `~/.config/pinetrie/config.json` as
  `{ "lanes": { "shared": [".plans"] } }`, and ignore it in
  `~/.config/git/ignore`. Every thread's agent then reads and writes
  `/workspace/.plans`, which is your `.plans`, live, and never part of a
  branch. Each write to a shared file, a thread's or yours, is a version
  of it, and a thread's write over a version it never read is marked on
  its turn (ADR-0135). A project can share a directory for everyone in `pinetrie.json`'s
  `lanes.shared`, once accepted work holds it. A changed config reaches
  existing threads at their next run, after a host restart.
- **Accepting a thread's work** (ADR-0038 to ADR-0040, ADR-0047, ADR-0100;
  the words are `docs/glossary.md`): each thread has a two-word name, shown
  in its column's header from before its first message (ADR-0057), and
  keeps an **offer** in your repo, on the thread's base, under the bookmark
  `pinetrie-offer/<name>`. While the thread works, the offer reads
  `WIP (<name>): <its first message>` and grows in place; when a run ends,
  an agent writes its commit message. Before you accept it, press the
  offer's line in the work strip: the column's pane shows its message, its
  files (flagging those that conflict with your committed work, and those
  you are editing) and every file's diff. Or find its bookmark, which a
  press copies, in jj or jjui. **accept** (or **accept into wip/…**), in the
  work strip at its column's foot, moves **accepted work**
  (`pinetrie-accepted`) or the WIP forward to it, and your `@` stays where
  it is (ADR-0060). Reword, squash or split the offer like any commit of
  yours before then; the host then leaves it alone. **split into a stack**
  has the agent rewrite it as reviewable revisions, in a run of its own:
  while the thread works it waits in the queue, and the agent can ask for
  one too (ADR-0080). The thread is told what you did to its offer, an
  acceptance included, and when accepted work has moved on: the agent can
  catch up itself (`catch_up`). **publish** moves `main` forward to
  accepted work (ADR-0090, ADR-0099). Set `accepted.bookmark` in
  `pinetrie.json` to have offers land on another bookmark instead;
  `jj git push --all` would push it: push by name.
- **Sending your work to a thread:** the work strip's `⋯` offers **update
  from my work**: your `@`, uncommitted edits included, merged into the
  thread's own copy. The thread gets a note of what changed, and your
  composer a line you may send. When it conflicts, the agent resolves it, or
  asks you (ADR-0033). A new root thread starts from your `@` as it is,
  uncommitted edits included. A thread's own history is in your repo out of
  sight:
  `jj log -r '::remote_bookmarks(remote=glob:"pinetrie-*") ~ ::@'`.
- **Summaries of asks** (ADR-0056, on by default since ADR-0071, shaped by
  ADR-0075): a model, the one commit messages use, writes each long ask's
  work a headline and a few points while someone reads the running thread,
  at most once a minute, and once more when its run ends. An ask of one or
  two agent messages gets none. `{ "digests": { "enabled": false } }` in
  `~/.config/pinetrie/config.json` turns them off. Replace the `ask-digest`
  skill to change what it asks; yours must still ask for a headline line
  and `- ` points, or `nothing to add`, since a reply in another shape is
  logged and dropped. With digests on or off, each run's end also asks
  for its verdict (ADR-0077), a request of its own for a short ask; a
  replaced skill must answer `needs you: <reason>`, `worth a read:
  <reason>` or `done` first, or the run is unclassified.
- `PINETRIE_TOOLS=0` removes the tools. A thread's agent that starts the
  development host itself needs `PINETRIE_PORT=0`, or it collides on 7391.
- **Inviting a collaborator:** `PINETRIE_BIND=0.0.0.0` (or an address). The host
  prints an invite link per network address, with its key; `PINETRIE_KEY` fixes
  the key. Everyone with the link gets in, and with tools on, can run commands
  on this machine as you. Use a trusted network or a tunnel.
- `PINETRIE_PROVIDER` / `PINETRIE_MODEL` override the model. A root schema change
  cannot open an existing store: move the project's `.pinetrie/pinetrie.db` aside.

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
| `docs/adrs/` | the ADRs in force, one file each, with rationale; superseded ones in `docs/adrs/archive/` |
| `docs/04-roadmap.md` | sequencing, invariants, action items |
| `docs/05-stack.md` | stack decisions, sandbox constraints |
| `docs/findings/` | the spikes, one file each: briefs, answers, evidence; spent ones in `docs/findings/archive/` |
| `docs/record.md` | not tracked: the index of the record by living doc, written by `pnpm run record` |
| `sandbox/` | disposable spike code (gitignored), kept for reproduction |
