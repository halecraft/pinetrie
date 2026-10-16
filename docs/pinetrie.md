# pine·trie — project handoff

**Read this first.** It is the orientation document for anyone (human or agent)
picking the project up cold. The detailed record lives in `docs/`; this
file exists to tell you what matters, what is decided, and what to do next.

> The architectural record lives alongside this file in `docs/` and is
> **tracked**: the living docs say what is true now, the ADRs why, and the
> spikes in `findings/` the evidence (`docs/README.md`). This file is the
> orientation layer over the top.
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

### Two kinds of thread

A **chat** is people talking in the tree, with no tools and no
lane. An **agent thread** has a lane of its own (ADR-0032, ADR-0034): a
Linux container on its own disk, with its own copy of your repo, and a
branch clones its parent's disk. Whether a thread is one or the other is
whether the agent has been asked there (ADR-0021, ADR-0158).

### Merge is three problems

Conflating these wasted time early, so keep them separate:

1. **Structural** — two peers append under different parents; the tree
   converges. *Free from CRDTs. Not where the work is.*
2. **Context** — what text enters the model's window when a branch lands.
   *The actual product problem.* Solved by a destination-aware three-way fold.
3. **Effect** — filesystem side effects of a branch that ran tools. Each
   agent's thread works in its own lane (ADR-0034), a revision per turn
   (ADR-0032), and its work reaches your repo as proposed changes you
   accept; a catch-up that conflicts is resolved by the agent, and the
   repository decides the outcome (ADR-0033). Built, but for coupling a
   file merge to a fold, which waits for fold.

---

## 2. Where we are

pine·trie runs, and builds itself: its own threads' agents work on it in
lanes, and their proposed changes, once accepted, are its accepted work.

```
browser page ── Kyneta Line (websocket) ── Node host ── pi-agent-core, one harness a root
                                              │                 │
          documents, replicated back ──────────┤        KynetaStorage (ADR-0003)
                                              │
                                              └── lanes: a container, disk and copy of your repo each
```

### The gates

Each is in `AGENTS.md`, Gates, with what it needs to run. Their counts are
what they print.

| gate | command | what it covers |
|---|---|---|
| lint + format | `pnpm run lint` | Biome, Kyneta's settings |
| types | `pnpm run typecheck` | strict; the interface and the shell package checked again without the DOM |
| unit | `pnpm test` | Vitest, beside the code; `workspace.test.ts` holds the package boundaries, and `scripts/*.test.ts` the record, the budget and the mutation lists |
| mutations | `pnpm mutate scripts/mutations/<list>.ts` | a deliberate bug for each check; `pnpm run proofs:unit` holds every unit mutation's `expect` to a test that runs |
| pi's own Storage suite | `pnpm run conformance` | against `KynetaStorage`, with pi's `MemoryStorage` as the control |
| end-to-end | `pnpm run e2e`, `pnpm run e2e:lanes` | the host's scenarios, and the lanes' under Docker, on the scripted model (S94); one scenario per file (`apps/pinetrie/e2e/TECHNICAL.md`) |
| with a real model | `pnpm run e2e:live` | the `live` scenario |
| **real browser** | `pnpm run e2e:browser` | the page in Chromium's headless shell |
| the observer | `pnpm run e2e:observer` | the eBPF observer in a QEMU guest on the lane VM's kernel |
| test budget | `scripts/budget.test.ts` (in `pnpm test`) | host and lanes scenarios ≤ √ of the unit tests, the browser's ≤ √ of those |
| the cascade | `pnpm run verify` | lint, types, unit, `proofs:unit`, conformance, `e2e` and `e2e:lanes` |

The stack is `docs/05-stack.md`: a pnpm workspace, TypeScript (strict, **no
build step**: Node 24 strips types natively), Vite, React, Vitest, Biome and
Playwright.

### Layout

```
apps/pinetrie/         @pinetrie/app          host and e2e suites (run, never imported)
apps/conformance/      @pinetrie/conformance  pi's Storage suite vs our adapter
packages/core/         @pinetrie/core         declares NOTHING
packages/schema/       @pinetrie/schema       core and Kyneta only; the document shape
packages/pi/           @pinetrie/pi           THE pi boundary
packages/protocol/     @pinetrie/protocol     the wire contract and its codec
packages/rules/        @pinetrie/rules        each stored shape and the pure rules about it
packages/reads/        @pinetrie/reads        document reads shared by host and client
packages/lanes/        @pinetrie/lanes        what a lane is and runs; the LaneRuntime and LaneHistory ports, no runtime (ADR-0032–0034, ADR-0130)
packages/lanehost/     @pinetrie/lanehost     core and channel only; the lanes' machine, outside any lane, by role (ADR-0129)
packages/channel/      @pinetrie/channel      declares NOTHING; a held JSON-lines channel to a server process
packages/ssh/          @pinetrie/ssh          declares NOTHING; a lane's ssh through its host (ADR-0140)
packages/docker/       @pinetrie/docker       lanes on Docker, on btrfs subvolumes (ADR-0130)
packages/vm/           @pinetrie/vm           the Mac's lane VM: image, launcher, a host's lease on a slot (ADR-0130)
packages/folder/       @pinetrie/folder       core only; a folder project's history as values (ADR-0142)
packages/keeper/       @pinetrie/keeper       declares NOTHING; one step at a time on a resource
packages/config/       @pinetrie/config       core only; settings declared with their rules, layers decoded, one settle (ADR-0146)
packages/jj/           @pinetrie/jj           your repo: reads, steps, the owner (ADR-0065, ADR-0104, ADR-0105); each lane's jj history
packages/session/      @pinetrie/session      one client's connection to a host; no React
packages/shell/        @pinetrie/shell        unbash only; shell source as structure (ADR-0114)
packages/interface/    @pinetrie/interface    what a person sees and does, for any client; no React, no DOM (ADR-0093)
packages/web/          @pinetrie/web          the browser page: React and the DOM; owns its Vite build
(root)                                        development tooling only
```

Dependency direction is physical: **core → schema, protocol, rules → reads →
session → interface → web → app**, with `shell` under the interface. `pi`,
`config` and the lanes' packages (`lanes`, `lanehost`, `channel`, `docker`,
`vm`, `jj`, `folder`, `keeper`, `ssh`) sit beside that line: the app and
each other declare them, and no client package does. The root declares only tooling, so a package can import only what it declares
(`workspace.test.ts` holds each package's manifest, `ARCHITECTURE.md` says
what each is).

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
| One owner writes your repo, and the host never touches the working copy or `@` except in a publish with `publish.catchUp` on, as you. An acceptance is a forward bookmark move. | ADR-0065, ADR-0104 | `docs/the-jujutsu-repo.md`, `packages/jj/TECHNICAL.md` |
| What the host cannot tell, it does not act on: an unknown answer never builds proposed changes. | ADR-0067 | `packages/jj/TECHNICAL.md` |
| Every thread's agent works in a lane of its own; nothing works directly in a directory. | ADR-0102, ADR-0130 | `ARCHITECTURE.md`, `packages/lanes/TECHNICAL.md` |
| What a person sees and does is decided in `@pinetrie/interface`, with no DOM and no React. | ADR-0093 | `packages/interface/TECHNICAL.md` |
| One word per concept: accepted work, accept, proposed changes, WIP, publish, catch up. | ADR-0100 | `docs/glossary.md` |

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
Every new check comes with one: a deliberate bug in `scripts/mutations/`
that it catches (`AGENTS.md`, Gates). The suite checks still without one
are listed in `scripts/unproven.ts`, a list that only shrinks. The spikes' property tests for convergence,
`seq` and trunk semantics, with their controls, stayed in `sandbox/`: none
is a gate.
*A check without a proof that it can fail is not yet a check.*

### Kyneta

The local checkout, at `~/halecraft/kyneta`, wired by `link:` deps to its
`pineta` workspace. **Published `@kyneta/*` is unusable**: it predates the
O(δ) write fix and what the host imports. A stale build is refused at
load: Node refuses a module whose named import is missing before any of
it runs (S47), and the host imports what v4 added (`whenPeer`,
`yjsClientId`). pine·trie tracks the local checkout's `needed-by-pineta`
bookmark.

Three issues were filed to the Kyneta team (`docs/findings/archive/kyneta-issues-verification.md`):
`compact()` throws on live Loro docs (**moot for pine·trie**, which uses no
Loro: the session is `json.bind`, compacted live, ADR-0023); the `Line`
schemaHash collision (**fixed**); and the ephemeral wire cost (**withdrawn —
our error**, we used `Schema.string()` where `Schema.text()` was the right
primitive).

### pi

Pinned exactly at **0.87.1**: pi's three packages, declared by `packages/pi`,
and `pi-agent-core` by `apps/conformance` too. pi is mid-rewrite into a
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

**ADRs are encoded as types where possible.** Entry ids, run ids and thread
ids, which name lanes, are branded (`EntryId`, `RunId`, `ThreadId`), so a
swapped argument is a compile error. They are minted where they enter: the protocol codec, the
reads (`renderableEntry`), the schema's readers, `@pinetrie/rules`' decoders, a
commit's trailer (`packages/core/trailers.ts`), the pi adapter, the page's
stored forms, and the host's id generator. Biome's `noRestrictedImports`
(`biome.json`) refuses `entryId` and `threadIdFor` in core, the interface,
the page and the host, and `runId` in all of them but the host (S95): a new
thread's id is minted by `newThreadId`, in `@pinetrie/session`, alone. A `LocalSeq` brand was deleted (ADR-0013
above); `projectTranscript(entries, tipId)` cannot even accept a seq.

**FC/IS — gather → plan → execute. Decisions are values.** `packages/core` is
pure and imports nothing, and `@pinetrie/rules` decides from what
`@pinetrie/reads` and the adapters gather; the shell in `apps/pinetrie/host/`
performs the decision. This mirrors pi's own lane loop.

**No build step.** Node 24 strips types natively, so imports name the real file
(`./index.ts`). Native stripping does **not** support enums, namespaces,
parameter properties, or decorators.

---

## 6. What is built, and what is next

**The interface is the sidebar of canvases down the left, and the canvas you
are on, drawn as a rail beside columns** (`docs/06-interface.md`,
`packages/interface/TECHNICAL.md`, ADR-0116, ADR-0122), over a footer showing
who is here, what needs you and the board, which slides up over the columns
with every canvas in its workflow state: each
column is a card on the canvas, a thread's one path on its own
scroll; a branch opens beside its parent in its rail track's colour, and
the rail draws the tree of each root the canvas's threads are in, with each
uneventful stretch drawn as one capsule (ADR-0031), a long ask's work a
capsule of its own (ADR-0106).
Views are pure functions over one `indexTree` (`packages/core/tree.ts`,
`roots.ts`); which canvas you are on and your view of each canvas are
a reducer in `packages/interface/layout.ts`, the sidebar is your `open:`
document (`packages/session/open-threads.ts`), and the inbox is
`packages/interface/inbox.ts`.

The composer is your message (ADR-0048, ADR-0113), which only you see;
what people edit together is a note, in a note column (ADR-0116). The
composer is one uncontrolled textarea, bound with Kyneta's `attach` to the
card's text from the keystroke that creates it (`packages/web/card-box.ts`).

**A file dropped, pasted or chosen in a card box is shared in the
conversation** (ADR-0042, ADR-0151): uploaded to `POST /blob`, kept by
SHA-256 in `pinetrie_blobs` beside the session in the host's SQLite file,
and linked from the message's markdown. The message's `details.shared`
names its shares, and `details.images` the images among them, each at its
fitted size, which pi's `toProviderMessages` hands to the model as image
parts. An agent saves a share into its own lane with `save_blob`. A tool's
images are blobs too: what pi stores holds their reference, and the
rejoin restores their bytes (ADR-0051). Admission refuses another origin,
and on loopback a rebound name. An image a message names by URL, or by a
path in a lane, is not handed to the model.

**Live work hands over to its entry in one render** (ADR-0044). A reply is
its lane's current reply while the lane's tip is where it opened, and its
entry moves the tip. A tool's output streams in its own row. The layout is
drawn from the render's own facts. A column at its end does not get shorter
while the agent works: a floor takes up a shrink. The browser suite checks
this frame by frame at 20× CPU throttle.

**A canvas can be renamed** (ADR-0045, ADR-0116): its title is a
host-written `pinetrie.mark` value, set from its item's `⋯` in the sidebar
or its canvas column, the last write winning, and deleted when cleared. It is
the canvas's label everywhere it is named, the board's search included.

**Your config** (ADR-0146). pine·trie reads only its own files, each a
`pinetrie.json`, from the broadest to the most specific:
- the machine's, the first `pinetrie/pinetrie.json` under `$XDG_CONFIG_DIRS`
  (by default `/etc/xdg`);
- yours, `$XDG_CONFIG_HOME/pinetrie/pinetrie.json` (`~/.config/pinetrie/`);
- the project's `pinetrie.json`, as accepted work holds it (your repo's
  names are read from the working copy, since they find accepted work);
- yours for one project, `$XDG_CONFIG_HOME/pinetrie/sessions/<session>/pinetrie.json`,
  by the session's name (ADR-0149);
- the environment: `PINETRIE_MODEL`.

Each setting says which of them may set it and how they combine: most
take the most specific, a list adds every one's, and a machine's file can
narrow some for everyone. A project may never list packages or providers,
which run code or send keys. A key no setting has, one a file may not set,
or a value that is not taken is refused, named in the host's startup lines
and on the setup page (your avatar's menu, **Setup**). Nothing of `~/.pi`,
nor a project's `.pi/`, is read; an `AGENTS.md` above the project is not a
context file.

```json
{
  "model": "anthropic/claude-opus-5-5",
  "packages": ["/Users/you/.local/share/ai/duane", "/Users/you/.local/share/ai/npm/node_modules/@gotgenes/pi-anthropic-auth"],
  "skills": ["/Users/you/skills"]
}
```

- **Sign in** on the host's machine: `pnpm sign-in anthropic` (a
  subscription, in a browser: paste the code, or the URL you land on, when
  the redirect cannot reach this machine), `pnpm sign-in openai` (an API
  key, hidden as you type), `pnpm sign-in` to list providers, `pnpm
  sign-out <provider>`. Credentials go in
  `$XDG_DATA_HOME/pinetrie/auth.json`, written only by sign-in. A key in a
  provider's environment variable works too.
- **`packages`** lists pi packages by folder: their skills and prompts are
  commands, and their extensions' providers apply (a Claude subscription
  needs `pi-anthropic-auth`'s). Nothing is installed: a package that is not
  a folder is refused. **`skills`** and **`prompts`** list folders of
  loose ones; `skills/` and `prompts/` beside your `pinetrie.json` load
  too, as does `AGENTS.md` there.
- **Custom providers** are pi's `models.json`, beside your `pinetrie.json`.
- **With no model**, the host starts, says why, and a send to the agent is
  refused in the composer, pointing at the setup page.

Coming from pi, one line of `~/.pi/agent/settings.json` at a time:
- rename `~/.config/pinetrie/config.json` to `pinetrie.json`;
- `defaultProvider` and `defaultModel` become `"model": "provider/id"`;
- a local path in pi's `packages` is listed as it is in `packages`;
- an `npm:` package is installed into a folder of yours (`npm install
  --prefix ~/.local/share/ai/npm --legacy-peer-deps <name>`; pi's loader
  resolves its pi imports to pine·trie's own) and listed by path. One that
  only adds tools (`pi-mcp-adapter`) gives pine·trie nothing;
- `enabledModels`, `retry`, `theme` and `tuiMode` are pi's alone;
- copy `~/.pi/agent/models.json` beside `pinetrie.json` for custom
  providers;
- skills or prompts in `~/.pi/agent/skills`, `~/.pi/agent/prompts` or
  `~/.agents/skills`: list the folder, or move them beside `pinetrie.json`;
- `pnpm sign-in <provider>` for each provider you use.

**A lane can ssh where its host can** (ADR-0140). Your own identity is
your agent's keys; lanes use it once you approve each lane, in its
column's header. Turn it on for every project, and say who approves, in
your `pinetrie.json`:

```json
{ "owner": "you@example.com", "lanes": { "ssh": { "personal": true, "hosts": ["pop", "*.lan"], "approvalSeconds": 120 } } }
```

`hosts` and `approvalSeconds` are optional; a project grants it with
`lanes.ssh.personal: true`, `false` in yours declines it, and `false` in the
machine's forbids it. Service identities
are key pairs in `~/.config/pinetrie/ssh/`, with an optional ssh `config`
beside them naming their hosts (a relative `IdentityFile` means that
folder); every lane uses them unasked. The host reads your `~/.ssh/config`
for names, so `ssh pop` works in a lane.

**Every thread has an icon** (ADR-0143), in place of the ✦ before its
name: in its header, its details, its folded strip, its card and the folded
list. Where it comes from is `icons.source` in your `pinetrie.json`:

```json
{ "icons": { "source": "built-in" } }
{ "icons": { "source": "drawn", "model": "openrouter/recraft/recraft-v4.1-flash" } }
{ "icons": { "source": "none" } }
```

- **`built-in`**, the default, also with no `icons` at all: the 32×32 pixel
  sprite of the thread's name's noun, one of 256 shipped with the page
  (`packages/web/public/noun-icons/`, made in S188 and S190). No key, no
  request.
- **`drawn`** (ADR-0050, ADR-0053): your OpenRouter key (`pnpm sign-in
  openrouter`, or `OPENROUTER_API_KEY`) draws one from the
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

**A column folds each ask's work** (ADR-0106). An ask is a message that
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
lane); a failed or stopped run's verdict is its facts. A canvas's item in
the sidebar says what its threads need of you: a still ring while the agent works, an amber
dot that pulses as it arrives when something needs you (a question, an
error, work ready to add), a dim one when something is worth a read, a ✓
that fades when a run ends with nothing to do. What you have dealt with is
yours on every device, in your attention document (`attention:<writer>`,
beside your inventory): how far you read each thread, what you marked "not
needed", and the mentions you have seen.

**The rail outlines what each column shows** (ADR-0058), in the column's
colour, and scrolls to keep the outline of the column you move in view. A
column of a canvas shown again comes back where you left it, by message: the
same measurement (`packages/interface/viewport.ts`). Spots last the page's
life; keeping them for a person across devices is the next step.

### Not built yet

Decided, and waiting for their turn:

- **Fold** (ADR-0005, ADR-0010): the context merge, an LLM's three-way
  fold into a merge entry with a `fromId` (`docs/01-architecture.md`,
  Fold). The tree can already represent the entry.
- **Accepting a folder project's proposed changes** (ADR-0142): reviewed as
  files today; the accept is refused with words.
- **What else a canvas holds** (ADR-0116, ADR-0118, ADR-0119, ADR-0126):
  file cards, media cards, sources a lane mounts, runners, stacks of
  threads (`docs/glossary.md`, "Accepted, not yet built").
- **Narrow screens**, beyond the pane (`docs/06-interface.md`, Deferred).
- **`read_thread`** (ADR-0128, ADR-0160): an agent's tool to read another
  thread in reach. The rest of agents talking is built, or shelved.
- **Authenticated identity**, below.

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

- **Kyneta cannot compact a live Yjs document**, so a card's text and the
  places are never compacted live: their storage is compacted, and nothing
  in memory is trimmed (`apps/pinetrie/host/housekeeping.ts`).
- **A client's command Line is stored and not compacted while the host
  runs.** Each Line document grows about 1 KB per command, and the host
  cannot compact the half a client writes; only a starting host deletes the
  stored Lines. Line's pruning should compact it: to file upstream.
- **While a tool runs, its output is stored twice:** the live stream in
  `pinetrie:live`, and pi's checkpoint (its crash recovery) in its root's
  document. So a client holding that root receives it twice.
  Compaction clears both when the run ends, so it costs bandwidth during a run,
  not storage. One text would do if pi's `tool_update` carried the checkpoint's
  key (`operationId`/`invocationId`): an upstream request to pi, low priority.
- **Identity is not authenticated.** The invite key decides who gets in; a
  person is the email their client names, unverified, so a collaborator can
  pose as another (ADR-0107, ADR-0037). Next: an email with a generated token.

- **The open spikes** (`rg -l '^- \*\*Status:\*\* Open' docs/findings`):
  - **S15**: the trunk winner rule uses wall-clock `ts`; clock skew is
    adversarial. Needs a Lamport clock (S1 deliberately built none).
  - **S10**: snapshot and sync-payload size at scale.
  - **S6**: anchoring a reference to a file range, once something points
    into files (references were withdrawn, ADR-0043).
  - **S100**: one parameterized read for every lane's proposed changes,
    a lane on a WIP's included.
  - **S154**: a touch drag on iOS Safari, deferred until an iPhone is at
    hand.
  - **S197**: building the lane VM's image on Linux, in QEMU.
- **Suite checks no mutation proves yet** are listed in
  `scripts/unproven.ts`, by scenario: each waits to be proved by a
  mutation, or deleted once a unit test proves its rule (`AGENTS.md`,
  Gates).
- **A run's refusal cannot reach its author.** The host replies `started`
  before pi admits the run, so a refusal is only logged; the message is kept
  in the tree (`settleRun`), with no reply. A second reply, sent once the run
  is admitted, would fix it; it changes the protocol.

### Standing chores

- Republish `@kyneta/*`, so pine·trie can depend on a release rather than
  a local checkout.
- Periodically diff pi upstream; `pnpm run conformance` is the gate.
- At each milestone, sweep the record: for each living doc, check the ADRs
  whose Area it is against the code, and supersede any whose decision no
  longer holds (`docs/adrs/README.md`, Amendments).

---

### Running pine·trie

- `pnpm dev` starts a host on pine·trie's own repo, its page through
  Vite: loopback, your config's model, the session in
  `pinetrie.db` in its data directory,
  `~/.local/share/pinetrie/sessions/<name>/`. `pnpm build` then `pnpm serve` runs one that
  serves the built page, with no Vite (ADR-0148); `serve` rebuilds a page
  whose code changed since its build, and says so.
  `pnpm tidy [folder]` cuts a jj repo's op log to its last seven days
  (`--days N`, `--dry-run`), while no host serves it (ADR-0155); a starting
  host logs when one is due.
  `pnpm dev <folder>` (or `pnpm serve <folder>`) serves another project instead, at that folder's
  jj or git root (ADR-0086). A relative folder is read from pine·trie's root,
  not the shell's directory. Each folder is a session of its own, found by
  its real path and named for it (ADR-0149); pine·trie keeps the session's
  files in its data directory and writes nothing in the project
  (ADR-0150). A jj repo with no git directory beside it is refused. A
  folder with no jj repo is served as a folder project (ADR-0142): its
  accepted work is the folder, a thread starts from it as it is, and its
  proposed changes are reviewed as files; accepting one is not built yet. The
  agent has its tools, and each
  thread's agent works in its own Linux container (ADR-0034), on a disk
  cloned from the turn it branched at. A root thread's starts from its
  base, accepted work or a copy of a WIP, which the send button's
  "starts from" chooses when you have WIP bookmarks (ADR-0104): your
  working copy reaches a thread only through one of them. Nothing installs its
  dependencies: it does, as you would after a clone. It sees its own directory at `/workspace` and your working copy at
  `/mnt/host-working-copy`, read-only, and nothing else of your machine unless
  accepted work's `pinetrie.json` grants it: a grant you add applies once you
  commit and publish it, and a thread's own copy can only give grants up. Your working copy is yours, so hot reload stays on. It needs
  Docker (ADR-0102, ADR-0130): the lane VM on the Mac, on Linux
  Docker with a btrfs lanes directory; without them the host says what is
  missing and does not start. On the Mac the host builds the lane VM's
  image when it has none, in a VM of its own: about 20 s, and 43 MB
  fetched once (ADR-0147). It needs Xcode's command line tools, and the
  Docker CLI with buildx for lane images, but no Docker engine. `pnpm
  vm:build` builds it ahead (`--force` again); on Linux it says no image
  is needed. Restart the host
  to pick up changes to host code.
- **`pnpm dev` serves React's production build** through Vite's dev
  server (`NODE_ENV=production`): hot reload stays, as a full page reload,
  and a long thread stays quick to type in (S59).
  `pnpm dev:react` serves React's development build: its warnings,
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
- **The skills and prompts your config lists are commands** (ADR-0036,
  ADR-0146): `/<package>:skill:<name>` for a skill, `/<package>:<name>` for
  a prompt template. For example `/duane:skill:plan` or `/duane:comments`.
  Typing `/` and part of a name offers them. A listed package's name is its
  `.claude-plugin/plugin.json` name, else its package name without the
  scope; a loose folder's is the file that listed it (`user`, `project`).
  `commands.names` in your `pinetrie.json` renames one, keyed by the
  package's path as listed. Their files are readable in every thread's
  lane, read-only; a project's own, in the lane's copy of it.
- **Sharing a directory with every thread** (ADR-0035), e.g. your plans:
  list it in your `pinetrie.json` as
  `{ "lanes": { "shared": [".plans"] } }`, and ignore it in
  `~/.config/git/ignore`. Every thread's agent then reads and writes
  `/workspace/.plans`, which is your `.plans`, live, and never part of a
  branch. Each write to a shared file, a thread's or yours, is a version
  of it, and a thread's write over a version it never read is marked on
  its turn (ADR-0135). A project can share a directory for everyone in `pinetrie.json`'s
  `lanes.shared`, once accepted work holds it. A changed config reaches
  existing threads at their next run, after a host restart.
- **Accepting a thread's work** (ADR-0105, ADR-0100;
  the words are `docs/glossary.md`): each thread has a two-word name, shown
  in its column's header from before its first message (ADR-0057), and
  keeps its **proposed changes** in your repo, on the thread's base, under the bookmark
  `pinetrie-proposed/<name>`. While the thread works, the proposed changes read
  `WIP (<name>): <its first message>` and grow in place; when a run ends,
  an agent writes its commit message. Before you accept it, press the
  proposed changes' line in the work strip: the column's pane shows its message, its
  files (flagging those that conflict with your committed work, and those
  you are editing) and every file's diff. Or find its bookmark, which a
  press copies, in jj or jjui. **accept changes** (or **accept changes into wip/…**), in the
  work strip, a row of its column's header, moves **accepted work**
  (`pinetrie-accepted`) or the WIP forward to it, and your `@` stays where
  it is (ADR-0104). Reword, squash or split the proposed changes like any commit of
  yours before then; the host then leaves it alone. **split into a stack**
  has the agent rewrite it as reviewable revisions, in a run of its own:
  while the thread works it waits in the queue, and the agent can ask for
  one too (ADR-0080). The thread is told what you did to its proposed changes, an
  acceptance included, and when accepted work has moved on: the agent can
  catch up itself (`catch_up`). **publish** moves `main` forward to
  accepted work (ADR-0090, ADR-0099). Set `accepted.bookmark` in
  `pinetrie.json` to have proposed changes land on another bookmark instead;
  `jj git push --all` would push it: push by name.
- **Catching a thread up:** the work strip's `⋯` offers **catch up with**
  the thread's base (accepted work, or its WIP), **continue from accepted
  work** once its WIP is gone, and **catch up with** the thread it branched
  from while that thread has new work (ADR-0072). Each queues a card
  holding the command, which the host pops when the lane is free
  (ADR-0108). When it conflicts, the agent resolves it, or asks you
  (ADR-0033). Your own work reaches a thread the same way: publish it into
  accepted work, or put it on a WIP, then catch the thread up. A thread's
  own history is in your repo out of sight:
  `jj log -r '::remote_bookmarks(remote=glob:"pinetrie-*") ~ ::@'`.
- **Summaries of asks** (ADR-0106, on by default since ADR-0071, shaped by
  ADR-0075): a model, the one commit messages use, writes each long ask's
  work a headline and a few points while someone reads the running thread,
  at most once a minute, and once more when its run ends. An ask of one or
  two agent messages gets none. `{ "digests": { "enabled": false } }` in
  your `pinetrie.json` turns them off. Replace the `ask-digest`
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
- `PINETRIE_MODEL` (`provider/id`) overrides the model. A starting host
  checks every stored document's schema before it opens any: it runs the
  migrations registered for a stored schema, and refuses to start, naming
  the document and both schema hashes, when none is (ADR-0096).

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
| `docs/00-vision.md` | product thesis, the two kinds of thread, scope |
| `docs/01-architecture.md` | evidence base, layer cake, data model, module layout |
| `docs/adrs/` | the ADRs in force, one file each, with rationale; superseded ones in `docs/adrs/archive/` |
| `docs/05-stack.md` | the stack, and why |
| `docs/findings/` | the spikes, one file each: briefs, answers, evidence; spent ones in `docs/findings/archive/` |
| `docs/record.md` | not tracked: the index of the record by living doc, written by `pnpm run record` |
| `sandbox/` | disposable spike code (gitignored), kept for reproduction |
