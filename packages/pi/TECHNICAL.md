# `@pinetrie/pi` — technical notes

**The pi boundary.** This is the only package that may resolve
`@earendil-works/*`. That is enforced by module resolution, not by a scanner:
pi is declared here and in `@pinetrie/conformance` (`apps/conformance`) and nowhere else, so from the
app every spelling fails with `ERR_MODULE_NOT_FOUND`. See
`docs/01-architecture.md`.

`index.ts` re-exports our shapes only. No pi type crosses the boundary
(ADR-0003).

## Where the facades live (ADR-0092)

The host holds three facades, made in this order, each from what exists by
then:

| facade | made by | what it is | it needs |
|---|---|---|---|
| `Scribe` | `createScribe` (`scribe.ts`) | a thread's appends into its root: `appendToTree`; and every session's end: `release`, `close`. The host writes its own records (ADR-0095) | a root's document, a replica id, the image store |
| `PiSetup` | `loadPiSetup` (`pi-setup.ts`) | the model setup from pine·trie's config, loaded: `complete`, `skill`, `commands`, `refusedCommands`, `expand`, `canDrawBanners`, `drawBanner`, the model or why there is none, the credentials' sources, the refused packages, the context files | the model choice, pine·trie's places and the agent-directory binding, the listed packages, skills and prompts, the project's root; no document |
| `Agent` | `createAgent` (`agent.ts`) | the agent at work in threads' lanes: `createThreadLane`, `lane`, `interrupted`, `close` | the scribe, the setup, lane work's `access` and `hooks`, `set_banner`'s asks |

Only the agent needs the host, since pi's tools call lane work, so the host
makes it last and every other module it makes takes values
(`apps/pinetrie/host/TECHNICAL.md`, Startup). No facade's type names a pi
type. `createAgent` reaches what is behind the other two (the scribe's
sessions, the setup's `ModelSetup`) through `sealed` (`inside.ts`): a
module-private map from each facade to its inside, which throws for an
object its factory did not make. `index.ts` exports neither the maps nor
`inside.ts`.

### One pi session per root (ADR-0063, ADR-0095, S113)

The host gives the scribe and the agent its `AgentDocuments`: a root's
document by its `RootId`, and the root a lane works in (its `LANE` record).
The session's document has no pi session: the host writes its records
itself (ADR-0095).

- **The scribe holds each root's one `KynetaStorage` and
  `StorageBackedSession`**, made the first time an append or the agent asks,
  the promise held so two callers share one. Nothing else opens a session:
  two over one document drift apart, since `KynetaStorage` indexes its own
  commits and reconciles only `replay` changes, so after its first read
  neither sees the other's (S113 case A).
- **The agent builds a root's harness through the scribe**
  (`scribeInside.over(root, build)`): over that root's session, once, and
  the scribe holds it beside the session. The agent keeps no map of its own.
  A root's harness is made at the first lane call there, not at its first
  write; making one writes nothing (S113 case B). One setup, tool list,
  system prompt and hook set serve every harness.
- **The scribe ends every session.** A harness closes the session it was
  given, and both closes are idempotent. `release(root)`, before the host
  lets the document go, forgets the root's entry, closes its harness, then
  the session, which also ends a root written to and never run; the next
  call opens the document again (S113 case G). `close()` closes every
  harness, then every session, and refuses every later append, in a root it
  never opened too. `Agent.close()` closes the harnesses alone
  (`closeBuilt`), which ends running runs; the host's shutdown closes the
  scribe after it.
- **Routing.** `createThreadLane(spot, lane)` acts in `spot.root`'s
  harness. `lane(name)` returns a handle whose every call finds the lane's
  root when it is made: a lane is created, then its record written, then it
  runs. `interrupted(roots)` asks the roots the host opened. `recordTurn`
  reads the tip from the lane's root.
- **The scribe's writes.** `appendToTree` writes an entry with no lane into
  its root's session.
- **Roots never wait on one another**: pi serializes commits per session.
- `one-root.ts` is the documents of a session with one root, for tests;
  `start-pi.ts`'s `startPi` makes the three facades over them in the host's
  order.

| module | its one job |
|---|---|
| `thread-lanes.ts` | each thread's pi lane, held, and its handle (`ThreadLanes`) |
| `tools.ts` | the tools registered, and whether a stored lane's list differs from `TOOL_IDS` (`toolsChanged`) |
| `search.ts` | the `grep` and `find` tools: rg and fd through the lane's `env` (ADR-0064) |
| `lanes.ts` | where a lane's tools work (`toolContextOf`), and what it is told (`systemPromptFor`, `laneGuidelines`) |
| `stream.ts` | pi's events as `StreamEvent`s (`streamEventOf`) |
| `commands.ts` | the commands pi loaded, and a command's file as the model reads it (`CommandFiles`) |
| `banner.ts` | `set_banner`, and drawing a banner (`Banners`) |
| `config.ts` | the model, its setup (`loadModelSetup`), and `complete` |
| `pi-setup.ts` | the model setup, loaded (`PiSetup`) |
| `agent-dir.ts` | pi's agent directory bound to pine·trie's config directory, once per process (`bindAgentDir`) |
| `auth.ts` | signing in and out (`providerAuth`), the sign-in argument's plan (`planSignIn`), and a notice's terminal words |
| `scribe.ts` | a thread's appends and every session's life (`Scribe`) |
| `inside.ts` | a facade's inside, reachable only in this package (`sealed`) |

The decisions in them are pure and tested without a harness:
`toolsChanged`, `toolContextOf`, `streamEventOf`,
`expandCommand`, `skillOf`, and the search tools' `grepArgs`, `findArgs`,
`searchOutcome` and `searchText`.

## `storage.ts` — our implementation of pi's `Storage` port

`storage.ts` is the shell: it reads the document, calls pure planners, writes
their plans, and keeps the commit queue and close state. The rules are in
pure modules, each with its own test:

| module | holds |
|---|---|
| `stored-row.ts` | `toStoredRow` / `fromStoredRow`, `rowCustomType` |
| `stored-values.ts` | `encodeValue` / `decodeValue` by namespace: checkpoints, pending entries, the rest as they are |
| `dirty.ts` | `dirtyFrom`, and `Scope`: what a replay leaves to re-index |
| `arrivals.ts` | `ArrivalLine`, `ArrivalIndex`, `planArrivals`: the local `seq` |
| `commit.ts` | `planCommit`: a commit's writes as document operations and arrivals; `threadOfEntries`: the thread its entries are in |
| `thread-context.ts` | `threadContext`, `threadOfContext`: the thread a pi call is made in, carried in its `Context` |
| `queries.ts` | pi's read rules over rows: branch walk, stop-at, cursor, key order |

### The split and the rejoin (ADR-0015)

pi hands us an `Entry`. The document stores a typed row. Two pure functions in
`stored-row.ts` do the conversion:

```
toStoredRow(entry, refOf, thread)  Entry minus seq  ->  StoredEntryRow
fromStoredRow(row, seq, blobOf)    StoredEntryRow   ->  Entry
```

Five rules hold them together:

1. **`payload` carries variant data and only that.** `NEVER_IN_PAYLOAD` lists
   the hoisted columns, `thread`, plus `seq`. Duplicating a column into `payload` would
   give `parentId` two homes with nothing keeping them equal — `planArrivals`
   orders arrivals from the column while a renderer might read the blob. A
   round-trip test **cannot** see this, because rejoining from either copy
   yields the same entry. The disjointness test in `stored-row.test.ts` is the
   only guard.
2. **`seq` is passed to `fromStoredRow`, never read from the row.** It is a
   replica-local arrival index (ADR-0013) and never lives in the document.
   Passing it keeps the pairing visible in the type. The columns need no
   check on the way back: a row from a peer on another build reads a missing
   field as its schema default (S17). `payload` is unchecked, since pi ships
   no schema for `Entry`.
3. **Absent and null are different facts.** `fromId` exists only on
   `branch_summary`, so the column holds `null` for every other type and the
   rejoin restores *absence*. Every message entry hits this path.
4. **An image's bytes are in the blob store, not `payload`** (ADR-0051).
   `splitImages` (`stored-images.ts`) stores each image part of a message
   whose blob the store has as `{type, mimeType, sha256, width, height}`, and
   `rejoinImages` restores `{type, data, mimeType}`, so pi reads what it
   wrote. The same pair runs on `pi.pending.entry` values, pi's copy of a
   message before its entry, since a deleted value stays in the history until
   compaction (S93); `stored-values.ts` decides which namespaces. Before its
   batch, `#applyCommit` gathers the lookups for the images `imagesOf` finds:
   the SHA-256 of each part's bytes, and `blobs.ref`. A part the store lacks stays
   inline, which is every part without `KynetaStorageOptions.blobs`, as
   conformance runs. A blob gone from the store rejoins as "[image <sha256>
   is no longer stored]". There is no cache: pi rejoins each entry on a
   branch about twice a model request, at 0.65 ms for a 2 MB image (S93).
5. **Every entry is in the thread its commit names** (ADR-0125). pi's
   `Entry` has no thread, so the row's comes from the commit:
   `threadOfEntries` takes the one its `Context` names (`threadOfContext`).
   Every call through a lane's handle carries `threadContext(name, …)`,
   and pi keeps a call's context in every commit of its run (S143); the
   scribe passes the same for a thread with no lane. A commit that writes
   entries and names no thread throws, and so does one that names a thread
   and moves another lane's tip, since a lane is named by its thread.
   `fromStoredRow` ignores the column.

**Gotcha: pi's conformance suite commits entries outside any thread.** Its
commits carry its own context, and one moves a tip named `main` with an
entry. So `KynetaStorageOptions.fallbackThread` gives a thread to an entry
whose commit names none, and only `apps/conformance/run-conformance.ts`
sets it; a fallback is no claim about lanes, so it is not checked against
tips. The host's storage, the scribe's, gives none. Tests that commit
directly pass `threadContext` as their context.

These tests are co-located here on purpose: `toStoredRow` takes pi's
`Entry`, so a test under `test/` would import a pi type across the boundary
ADR-0003 exists to hold. `vitest.config.mjs` includes `packages/*/*.test.ts`
for this reason.

### Lanes belong to threads, and never move (ADR-0120)

The host owns one harness. A lane is a thread's line of work: created by
`Agent.createThreadLane(at, lane)` where agent work is first wanted in a
thread, under its thread's id (`t-…`, minted by the column that opened the
thread, ADR-0057, ADR-0117), and never navigated. People own no lanes; a
message records its writer (`details.author`, from the transport). A lane's
tip is therefore always its thread's end, and a thread's lane is the one its
id names (`laneOf`), with no stored mapping.

The facade has no way to move a lane: `ThreadLaneHandle` offers `append`,
`run`, `resume` and `abort`, none of which navigates. Nor is
there a way to READ a tip through the agent: readers use the document, so
observing a lane can never create one. A missing lane refuses every write
`unknown_target` (`onLane`, `thread-lanes.ts`).

Four facts from pi's source and the probes shape it:

- **`harness.lane(name, { createAt })` THROWS `UnknownTarget`** for an entry pi
  does not hold, where most of pi's API returns a `Result`. `createThreadLane`
  catches it. The host also refuses a chat at an unknown entry before writing
  anything, because a lane-less append there would reach storage with a parent
  that does not resolve.
- **`harness.lane(name)` creates a missing lane.** So restoring a lane after a
  restart checks `hasLaneRecord` first: pi records a lane's `pi.branch.tip` key
  when it creates it, with a null value until the first entry.
- **`harness.lane(name, { createAt })` returns a lane it holds**, and ignores
  `createAt` (`dist/harness/runtime/harness.js`, `lane()`, in
  `@earendil-works/pi-agent-core` 0.87.1). So `createThreadLane` refuses an
  id pi holds, in memory or in the document, with `lane_id_in_use`, before it
  asks: otherwise a chosen id could write into another thread.
- **A foreign-written entry is not navigable** (`unknown_target`): pi's session
  never saw it created. The Node e2e keeps a `writeEntry` fixture for that S3
  case.

### Conversation threads have no lane (S21)

A thread where the agent has not been asked has no lane. `Scribe.appendToTree` inserts
its messages with `session.mutate` + `insertEntry`, parented at exactly the
entry the plan chose, under `threadContext` of the thread the plan names
(ADR-0125); the entry is a full member of the tree (navigable, and a
lane can later be created at it, whose agent reads it). The host's serial
executor makes the plan's parent still right when it is written. S21 Q2 showed
the alternative a second host would need: read the thread's end inside
`session.mutate`, an exclusive barrier for the whole session.

### A running lane is never written (S19, S21)

- **Every write that moves a lane's tip goes through that lane.** A `Lane` plans
  from its in-memory state, so a write through `session.mutate` would be stored
  but dropped from its next turn (S19).
- **Not while it runs.** A message appended to a running lane lands by timing:
  inside the agent's turn, as a prompt the agent answers, or after the reply
  while a queued question is never answered (S21 Q3). A message for a busy
  lane is a queued card instead (ADR-0048), which the host pops when the
  lane is idle; see `apps/pinetrie/host/TECHNICAL.md`.
- **A host's fact enters a running lane two ways only** (ADR-0080): as a
  tool's result (`catch_up`'s update), which pi writes in the turn; or by a
  steer (`ThreadLaneHandle.steer`, pi's `Lane.steer`), which pi places after
  the tool results of the turn in flight, at its next boundary, appended, so
  the prompt cache holds (S103 item 4). A steer that arrives after the
  run's last tool call makes one more request; one still queued when a run
  ends is accepted before the next run's prompt (S71 item 4); pi's abort
  drops it. `before_request` then sees the steer as the lane's tip, and
  `turnEntry` climbs past it.
- **A pi run can only start with `prompt`**, so a compelled chat is passed to
  `ThreadLaneHandle.run` as the prompt itself: a pi `CustomMessage`, which pi's
  default `convertToLlm` sends as a `user` message with its `content`.
- The harness is created with `followUpMode: "one-at-a-time"`, so that pi's own
  queue, if ever reached, answers one message at a time rather than batching
  (S20). pine·trie's queued cards mean the host does not use it.

`laneErrCode(tag)` maps pi's refusal tags for runs and lane creation, so none of
pi's vocabulary passes the boundary (ADR-0003): `UnknownTarget` and `LaneBusy`
have codes of their own; anything else is `refused`. The host never writes to
a running lane, but after a crash pi holds the interrupted operation open, and
the lane is `LaneBusy` until resumed (below).

### Streaming, in pine·trie's words (ADR-0107)

`createAgent` takes one `onStream(event: StreamEvent)`. `StreamEvent` is
declared in `@pinetrie/core`, so pi's events never leave this package. Every pi
`HarnessEvent` carries `lane`, so concurrent threads stay apart. The mapping
is `streamEventOf` (`stream.ts`), which drops an event on a lane that is
not a thread's.

| pi's event | `StreamEvent` |
|---|---|
| `message_update` (a `text_delta`) | `text` |
| `tool_start` | `toolStart`: its lane and call, no label (its row takes the committed call's) |
| `tool_update` (the first text part of `partialResult`) | `toolOutput`, a whole snapshot |

`message_end` and `tool_end` are not mapped. The entry pi commits after each
is what ends its stream on screen (ADR-0044), and an end event comes before
it (S35).

The harness's tool events are `tool_start`, `tool_update` and `tool_end`. The
`tool_execution_*` events in pi's types belong to its older agent loop, and the
harness never emits them (S22). What each event does to the document is
`planStream`'s decision, in `@pinetrie/rules`.

### What the model reads: a chat's images (ADR-0042)

`createAgent` passes pi's `toProviderMessages` our own: it gathers the bytes
of every chat's `details.images` from `CreateAgentOptions.blobs`, encodes
them, and runs `withChatImages` (`@pinetrie/rules`) before pi's own
`convertToLlm`, which it must still call so every other role converts as pi
does. It runs once per request, and reads the store each time: no cache
(S53 item 7). pi's compaction and branch summaries call `convertToLlm`
directly, so a summary reads a chat's text and never its images. For a model
whose `input` lacks `"image"`, pi-ai replaces each image with a line of text.

`prepareImage` (`images.ts`) fits an upload for the store: the type from the
bytes (`detectSupportedImageMimeType`), then `resizeImage`, in a worker
thread, to 2000×2000 and 4.5 MB of base64. A type no provider takes inline
(BMP) is "not an image"; a resize that returns null is "unreadable", since
pi's null means either undecodable or impossible to fit. After a resize,
`resized` is pi's note of the original size (`formatDimensionNote`), and
`original` is the image as it came, with its own size: the host keeps it,
and the fitted `image` beside it when they differ (ADR-0151). A
person's picture is given a smaller box, 512 on its longer side (`ImageFit`,
ADR-0098).

### Pinned cards: what the model reads (ADR-0048, S92)

- **A run's prompt can come with entries before it.** `ThreadLaneHandle.run(message,
  before)` passes `lane.prompt([...before, message])`: a base's news
  (`BehindMessage`, ADR-0080) and a cards entry (`PinnedMessage`,
  `@pinetrie/rules`), in that order, so the cards entry stays the prompt's
  parent. pi writes them all in the commit that admits the run, or none, so
  a refused run writes no cards entry. Only this keeps the prompt cache when a card changes: cards in the
  system prompt, or in pi's mid-conversation system messages (which pi-ai
  folds into the system prompt on most Anthropic models), lose the whole
  conversation's cache; cards moved to the end of each request lose it on
  every request (S92).
- **Every thread's `<rules>` holds the context rules first**
  (`CONTEXT_RULES`, `systemPromptFor`), for a direct thread too:
  `PINNED_RULE` (a thread's and a task's pinned cards) and `CANVAS_RULE`
  (the canvas list, ADR-0116), from the rules' context table. They are
  constant, so a lane's prompt stays the same between runs; each lane's
  prompt changed once when each was added. pi drops a guideline equal to
  another, so the lane's own lines stay distinct.
- **pi's compaction carries the context entries** (`before_compaction`,
  `agent.ts`; `pinned.ts`). pi compacts in the middle of a run, and a
  context entry summarised away (a thread's cards, a task's cards, the
  canvas list) would leave the model without it. `carryContext` decides,
  pure, for every kind in the rules' context table (`CONTEXT_KINDS`): the
  newest of each kind among the summarised messages, when the retained tail
  has none of it. The hook then runs pi's own `compact()` and returns
  `withCarried(result, carried)`, those at the head of the retained tail, so
  the stored compaction entry holds them (read back as the entry's
  `carried`, a `ContextInView`). pi's preparation is stored before the hook
  runs, so changing it in place would not stick: the hook returns a result
  instead.
- **A failed hook costs only the context.** It throws nothing on purpose:
  when `compact()` fails it returns nothing, and pi compacts on its own.
  The next run's entries restate what is not in view (`pinnedInView`,
  `taskPinnedInView`, `canvasInView`, `@pinetrie/core`).
- **The faux provider caches per lane** (`withUsageEstimate`), and pi stores
  each reply's `usage`, so `agent.test.ts` checks that an edited card keeps
  the cache with no model key. Each part is estimated rounding up, so a
  request can read one token less than the one before it sent.
  `scriptedModel({ contextWindow })` makes pi compact within a test.

### A tool's images (ADR-0051)

`read` is built with `readImageProcessor`, which runs `prepareImage` on an
image file, puts it in `CreateAgentOptions.blobs`, and returns its base64 and
the resize note as pi's `hints`, which pi appends to the caption. It runs
before pi writes the result (S93), so both of pi's writes find the image in
the store and keep a reference (rule 4 above). Without a store, `read` gets
no processor and behaves as pi's own.

The scripted model's `reply` shows an image part as
`[image <mimeType> <sha256 of its bytes>]`, so a suite can check which image
the model was given.

### Compaction, and the land message's budget (`compaction.ts`, ADR-0084)

`createAgent` gives every harness `PINETRIE_COMPACTION`, and `LAND_BUDGET`,
the resolution prompt's limit (`@pinetrie/rules`' `PromptBudget`), is derived
from it: its `keepRecentTokens`, measured with pi's `estimateTokens` of a
custom message. pi keeps the newest messages back to `keepRecentTokens` and
never cuts the newest, so a prompt within it is kept whole (S106).

- **Change the setting, and the budget moves with it.** Nothing else states
  20 000 or a ratio of characters to tokens.
- **The `compaction` option equals pi's default today**, so removing it
  would change nothing yet. It is passed so that the setting is pine·trie's.
- **pi-agent-core's harness compaction is not pi-coding-agent's.** The
  harness reads `options.compaction ?? DEFAULT_COMPACTION_SETTINGS`, never a
  person's `settings.json`.

### Models, tools and the prompt (`config.ts`, ADR-0146, S193, S194)

pine·trie reads nothing of pi's directories. What the host's config settled
is given to pi's code, kept out of `~/.pi` and a project's `.pi/`:
- **`planModelSetup` is the plan, pure:** `auth.json` and `models.json` from
  pine·trie's places; the loader's agent directory is pine·trie's config
  directory; its extension paths are the listed packages, its skill paths
  the listed skill folders, then `skills/` in the config directory, then
  pine·trie's own; its prompt paths the listed prompt folders, then
  `prompts/`. A listed folder that does not exist is left out, and a
  package that is not a folder is refused (`refusedPackages`), so pi never
  installs anything. Context files are filtered by `isOwnContextFile`:
  pine·trie's own `AGENTS.md` and those inside the project. pi walks up to
  `/`, and an `AGENTS.md` in the home directory would otherwise reach the
  model.
- **`deep.ts` exports `openLoader` and `openRuntime`, not pi's classes,**
  so no module builds a loader with other options. `openLoader` makes
  settings in memory, marks the project untrusted (so pi neither lists a
  project's `.pi/` and `.agents/` nor reads its `SYSTEM.md`), turns pi's
  own discovery off (`noExtensions`, `noSkills`, `noPromptTemplates`,
  `noThemes`), and gives only the plan's paths. A listed package's skills
  and prompts load through its extension path, under `noSkills` too.
- **`bindAgentDir` binds pi's agent directory** (`PI_CODING_AGENT_DIR`)
  to pine·trie's config directory, once per process; binding another
  throws. pi's `getAgentDir()` reads the variable at each call and ignores
  the loader's directory, and an extension finds its own config through it:
  `pi-anthropic-auth` reads `~/.pi` unbound. `loadModelSetup` and
  `providerAuth` take the binding, so neither runs unbound. Gotcha: an
  extension's own config is one per process, so a suite process binds its
  one config directory, and a unit test file binds one folder.
- **Only provider registrations are applied,** as before: an extension's
  tools, commands, handlers and UI hooks are pi's coding agent's, and
  pine·trie emits none of its events. A Claude subscription works only
  through `pi-anthropic-auth`'s provider (S23); listed by path, it carries
  the token from pine·trie's `auth.json` with its billing header (S194). A
  package installed anywhere loads against pine·trie's own pi: pi's
  extension loader aliases `@earendil-works/*` to the host's copy.

`ModelChoice` is one of three:
- **`configured`:** the model the host's config settled, or null.
  `modelState` decides from the facts the executor gathers: none named
  (`unset`), not among pi's models nor `models.json`'s (`not-found`), or
  no credential for its provider (`no-credential`, from
  `getProviderAuthStatus`, which reads pi's snapshot and runs no key
  command). `ModelSetup.model` is that `ModelState`, never a null: every
  consumer asks. With none, `createAgent` builds the harness on
  `NO_MODEL_STAND_IN`, never asked, and refuses every run with
  `ERR.NO_MODEL`; titles, digests, verdicts and commit messages skip their
  request (`complete` with no model answers as a failed one).
- **`named`:** `models.json` and `auth.json` only, for `e2e:live`'s one real
  run (ADR-0041).
- **`scripted`:** pi-ai's faux provider (`scripted.ts`), for repeatable suites.
  - A reply is the next step `use` queued, else the standing `answer`, else
    an error reply. A request takes its step when it arrives.
  - `hold(prompt)` holds the reply to the next request whose last user
    message includes `prompt`, from its first event (`start` included), so
    its run is in progress with nothing streamed (ADR-0139). `next()`
    releases its events up to and including its next text delta, and says
    whether there was one; `finish()` releases the rest. Its `reached` turns
    true when the request arrives.
  - A held reply is a second stream around faux's (`holdStream`). Faux may
    have made the whole reply before the run aborts, so an abort ends the
    held stream itself, as faux ends one it sees aborted: an `error` of
    reason `aborted`, at the last partial forwarded.
  - A second faux provider answers commit-message requests (`describe`, by
    default `SCRIPTED_DESCRIPTION`), so a describe request never takes a
    reply from the run's script (S48 item 22). `ModelSetup.describeModel` is
    that model when scripted, and the run's model otherwise. A run's end
    asks for a verdict (ADR-0077), and the scripted model answers
    `SCRIPTED_VERDICT` first, so a suite's threads are done.
  - **Each request queues its own response** (`perRequest`): both providers
    are wrapped so that `stream` and `streamSimple` append one dispatcher,
    then delegate. Faux takes a response off its queue when a request
    arrives, but runs a response factory a microtask later, so a factory
    that queued itself again left the queue empty for a second request in
    the same tick (S52 item 6).
  - Its handles never leave this package.

Loading runs every listed package's factory, so its side effects happen
(`pi-subagents` logs a warning). Every choice loads the listed packages,
skills and prompts; with none listed, a scripted or named model loads
nothing of pi's, and only pine·trie's own skills are commands. With tools
(`CreateAgentOptions.tools`), pi-agent-core's `read`, `write`, `edit` and
`bash`, and pine·trie's `grep` and `find`, run in each lane's own directory
(below). Context files load from `PiSetupOptions.project`, with tools on or
off (ADR-0086); with none, from the process's working directory. The system
prompt is pi's `buildSystemPrompt`, with the loader's context files and
skills: the section layout `pi-anthropic-auth` shapes. Its `cwd` is the
lane's directory.

`ThreadLaneHandle.abort()` is pi's `lane.abort`: a running tool is aborted and
its result recorded as aborted, and the lane takes its next message (S22).

### Where each lane works (`lanes.ts`, `lane-env.ts`, ADR-0032, ADR-0034)

One harness serves every lane, but pi resolves the tools' context from the
run's `Context` alone: `toolContext` is a function of it
(`harness/runtime/drive/tools.js`). So every call that drives a lane carries
its name in the `Context` (`threadContext`): `run`, `resume`, `append` and
`abort`. Everything else comes from the host's `access(lane)`, one source for
where a lane works. pi's hooks see the lane's name directly. Measured in S36
item 18, and in `lanes.test.ts` against the harness.

- **`LaneAccess`** is pine·trie's type, so no pi type crosses the boundary. It
  is either `direct` (a directory on the host, and a promise its tools wait
  for) or `lane` (a lane of its own: its `LaneFacts`, the host paths of the
  skills it can read, where the runtime's programs are, and a `gate()` that
  settles with its channel).
  `LaneFacts` is everything the lane's prompt says about it: its directory,
  `/workspace`, its shared directories relative to it (ADR-0035), its offer's
  bookmark, its grants, whether it runs the default image (`defaultImage`:
  a browser and python3), pine·trie's mount and the note's path. The host builds every name in it: the rules for them are
  in `@pinetrie/lanes`, which this package does not declare.
- **The tool context** is one type, `ToolContext` in `lanes.ts`: `env`,
  `programs`, `dir`, and `lane`, which is null for a lane that works
  directly. pi builds both the tools and the system prompt from it.
  `programs` says where the search tools find rg and fd, in `env`'s file
  system: the runtime's `bin/` for a lane of its own (`LaneAccess.programs`,
  from the host's `RUNTIME_BIN`). A tool never runs a bare program name, so no lane runs whatever
  its `PATH` happens to hold.
- **An agent without tools, or a lane with no copy of its own,** gets no
  access (`toolContextOf(null, project)`): `refusingEnv`, whose every method
  answers `not_supported`, and a prompt naming the project's root, every
  skill at its own path, and `PINNED_RULE` alone. A call with no lane named
  is the same.
- **A lane of its own** gets `laneEnv(dir, gate)`: a proxy whose every method
  first awaits the gate, then forwards the call over the lane's channel.
  - The helper (`lane-helper.ts`) serves pi's own `NodeExecutionEnv` in the
    container, so pi's tools run there unchanged. They use 8 of its methods:
    `absolutePath`, `canonicalPath`, `exists`, `fileInfo`, `readTextFile`,
    `readBinaryFile`, `writeFile`, `exec` (S43 item 1). The search tools use
    `exec` alone.
  - The context's abort sends `{ abort }`.
  - `exec`'s `onUpdate` receives each update.
  - Methods whose results are not data are refused with `not_supported`, not
    forwarded: `openTextLineReader` returns an object with methods.
  - The gate is the lane's queue in the host, so the model can think while a
    turn's disk is cloned, and no tool touches the disk until the clone is
    done.
- **The channel** (`openChannel`) is one long-lived process: the helper,
  started by the lane runtime's `execArgv` (`helperCommand`: `docker exec
  -i`), serving `lane-protocol.ts`'s calls over `@pinetrie/channel`
  (`packages/channel/TECHNICAL.md`), one JSON line per message. Its input's
  end must reach the helper: through the lane VM's launcher it does, as a
  half-close (S128).
  - Calls are answered concurrently: pi runs a turn's calls in parallel.
  - The host closes the channel by ending the helper's input. Killing the
    `exec` process does not reach the guest (S43 item 2).
  - A helper that exits fails every waiting call with its stderr.
  - `laneRunner(channel)` gives the host's own jj and git a `run` call
    (`runCommand`): exit status, stdout and stderr apart, and bytes for a
    bundle. pi's `exec` gives only an exit code and capped, mixed text.
- **The protocol** (`lane-protocol.ts`) is the calls alone: an environment
  method and its arguments, a `run` (with its input, for the host's own
  commands that take more than a command line holds), a drain of the
  lane's `runs`, or `hashes`, `present` or `ignoreFacts` of paths. Bytes and errors cross as the
  channel's wire carries them, at any depth, since `NodeExecutionEnv` never
  throws: its errors are values inside results (S44 item 5).
- **A lane's runs** (ADR-0135): each `exec` is a run, launched with its
  number in `PINETRIE_RUN` (`observer.ts`, `launchOptions`): pi spawns the
  shell with `options.env` last, so the variable is the run's whatever the
  caller gave. The machine's observer sees it begin there and sends its
  events to the host, never through the helper; the host folds them as
  they arrive (`laneFold`, `@pinetrie/rules`, ADR-0145), by the lane's
  directory and the shared directories under it, which the helper's hello
  names (`sharedInside`). A drain (`drainLaneRuns` in `lane-runs.ts`) takes
  those traces. The helper's `runs` says only what it launched and its
  tools' part (`LaneDrain`), and `present` which changed paths exist
  now. A drain is a `RunRecord` per run
  with news since the last: its reads, writes (created or not), deletions,
  failed lookups and shared accesses, with the write tools' paths beside
  them (`ToolWrites`). Its rules:
  - **Tool writes are the agent's alone.** Every environment method says
    in one table keyed by `EnvMethod` whether it reads, writes or appends
    to a file, and which (`FILE_ACCESS`), so a method added must say; a
    rename writes its destination. Those calls
    go under a key private to `lane-env.ts`, which only `laneEnv` uses: the
    host's own writes go on a `run`'s input and can never count.
  - **A write of `pinetrie.json` is answered with what it changes.** The
    write and edit tools are wrapped (`noteConfigWrites`): after a write
    of the lane's `pinetrie.json`, the host's note (`configWritten`) is
    added to the reply. Wrapped, not replaced, so the tool list and the
    prompt stay pi's.
  - **One stamp, in the observer's form:** size and ctime, the inode left
    out, since on the Mac a lane and the host see different inodes (S169).
    Core makes it from a stat in one place (`statStamp`), for the helper
    and the host's watcher; the observer suite checks the loader's equals a
    `stat`.
  - **The read and write tools' shared accesses** (`toolShared`): a read
    tool's read of a shared file is an open for reading with its stamp,
    what the agent then knows of it; a write tool's write, its
    stamps before and after, an append marked so.
  - **The observer sees a call as it is made,** not whether it
    succeeded. So whether a written path is there is read at the drain, not
    inferred: a temporary file renamed away reports nothing.
  - **A path's first event decides whether it was there before the run,**
    so a write is created or not, and a read counts only of what was there
    before the run wrote it: a run's own output is never its input.
  - **A drain flushes first:** it runs inside its `RunSource`'s `drain`,
    which calls it once every event of a call that already returned has
    arrived and been folded, so the exit of a command whose `exec`
    returned is in it.
  - **A drain that throws leaves its runs to the next.** The traces stay
    with the source. The helper's launched commands it had already taken
    are lost, so those runs record none.
  - **A daemon's run stays open** (`alive`) and reports again at later
    drains, until its last task has exited and its last written file has
    been let go of.
  - **A run's number is the helper's count from `Date.now() × 1024`**, so a
    daemon of an earlier helper's run never shares a later run's.
  - **`hashes`** are sha256, cached by each file's stamp (inode, size,
    ctime), which every change of content changes (S162).
  - **`checkRecipes`** answers, per recipe, the first fact of its key that
    changed (`checkRecipe`): an input's hash, a failed lookup now found, a
    shared file's stamp. Its image is the host's to compare.
  - **`ignoreFacts`** answers what the host's `.gitignore` matcher
    (`@pinetrie/rules`' `ignoredPaths`) needs of the disk, in one round
    trip: for each path that runs through a symlink, the first symlink on
    its way (a path that is itself a symlink is left out, a missing
    directory ends the search, each directory `lstat`ed once per call);
    which of the paths asked about (`ignoreQuery`) are directories; and
    each `.gitignore` above them that is a regular file, as git 2.32 and
    later read no symlinked one.
  - Outside a lane, as in tests on the host, nothing observes: the drain's
    source gives no traces, and no run reports a path.
- **The observer, relayed to a host inside the lane** (`observer.ts`):
  while the host holds an `observerRelay` call open, the helper serves
  core's `OBSERVER_SOCKET` (`serveRelay`). Each connection of it is a
  channel of the observer's own calls, which the helper neither reads nor
  checks: it asks the host for each (the call's updates, `RelayRequest`)
  and returns the host's answers (`observerReply`, `RelayReply`). The
  host's side (`relayObserver`) makes each connection a relay of the
  lane's observation, which decides what its calls may do.
  - **The socket exists only while a host relays,** so a host inside the
    lane plans its observer from whether it is there.
  - **The host's answers to one call arrive in order:** the helper takes
    an `observerReply` before its handler's first `await`, and a channel's
    calls are read in the order they were sent.
  - **The helper is in the lane,** so nothing it sends is trusted: the
    outer host, not the helper, says which lane a registration is forwarded
    within.
- **The helper runs on the lane runtime's Node through its own loader**, so
  `process.execPath` is the loader: nothing in it may re-execute that
  (S44 item 2).
- **The system prompt** names the lane's directory. For a lane of its own it
  adds a block of guidelines, `laneGuidelines(facts)` in `lanes.ts`
  (ADR-0121): what holds in every lane, filled in with the lane's own
  values, in about 300 tokens, among them that nothing installs for it, and
  that a catch up removes what was made from files that changed (ADR-0135).
  The model is sent the conversation as stored: nothing is rewritten.
  - **Guidelines, not a section of its own.** pi joins its sections into one
    string, and a provider may rebuild that string by its tags:
    `pi-anthropic-auth` keeps `<rules>` and drops `<docs>` (S23, addendum).
    Guidelines are rendered in `<rules>`.
  - pi drops a guideline equal to an earlier one, so no two lines of the
    block may be equal. A unit test checks it.
  - **The note** the block points at is the lane's history's kind's, in
    this package: `lane.md` for jj, `lane-folder.md` for a folder (no jj;
    `/pinetrie-states/start`, `diff -r`; search skipping `.ignore` too),
    read in the lane through pine·trie's own mount (`laneNote` in
    `@pinetrie/lanes`). Each fact in either names its source, which a unit
    test checks still exists.
    Each fact in it names its source as `<!-- <path> <symbol> -->`, and
    `lanes.test.ts` fails when a named file or symbol is gone. A change that
    makes a line of the block or the note false must change it.
- **`before_request`** calls `hooks.turnDone(lane, tip)`, and pi awaits it:
  every tool of the turn before has finished, so the commit never races a
  write. The turn's snapshot is queued on the lane: the next tool call waits
  for it, the next request does not.
  - It reads the tip from the document, not from the lane: asking the lane
    from inside its own drive could wait on itself.
  - It acts on `assistant` requests only; compaction and summaries request
    too.
  - `run` and `resume` call it once more after the run, for the last turn,
    however the run ends: a Stop, or a model that fails (S104).
  - A hook that throws is reported by pi, and the run goes on.
- **Resume after a crash.** `Agent.interrupted()` lists lanes whose
  `inspectExecution` shows an open operation; `ThreadLaneHandle.resume()`
  resumes one in its `Context`. pi records the interrupted tool call as
  interrupted, never running it again, and the rest of the run uses the
  directory in `resume`'s `Context`. `lanes.test.ts` reproduces the crash with
  two agents over one document.
- **A lane's tool list and system prompt never change between its runs**
  (S85). Anthropic drops an earlier thinking block when anything before it
  in the request changed since it was written, and pi asks it to
  (`drop_block`): a changed tool list or prompt costs the lane its earlier
  reasoning, and its cache from the top.
  - **Tools register from one table keyed by `ToolId`** (`TOOLS`,
    `tools.ts`, ADR-0114), in `TOOL_IDS`' order (core), which is the order
    of every request's list: a reordered `TOOL_IDS` changes every lane's
    prefix once. A tool with no factory fails to compile, and
    `tools.test.ts` checks each is named its id, so a pi upgrade that
    renames one of its own fails there. The id is what the model calls; it
    never changes for people's words ("shell" for `bash` is interface's).
    The constants (`BASH_TOOL`, `GREP_TOOL`, `BANNER_TOOL`…) are core's.
  - **The host's tools are active in every lane** (`TOOL_IDS`, core):
    `ask_about_conflict`, `catch_up` and `split_offer` (ADR-0080), and
    `set_banner` (ADR-0143). A call that does not apply answers why: the tool list never
    names who may call it.
  - **`ask_about_conflict`** (`conflictTool`, `lanes.ts`; renamed from
    `ask_for_guidance` by ADR-0080) is taken while jj finds a conflict in the
    lane's copy, in any run (`LaneHooks.askedAboutConflict`, async). Taken,
    its result's `details` are `{ asked: true }`, which the page reads
    (`renderableMessage`, `conflictAskedAt`), never its text. Refused, it
    answers `NO_CONFLICTS`.
  - **The list is `TOOL_IDS`, the same in every run** (`agent.ts`), and set
    once where a lane is held (`existing()` in `thread-lanes.ts`). A new
    lane takes the harness's seed. A restored lane stored with another list
    (by an agent with no tools, or under an older `TOOL_IDS`) is given the current one with
    pi's `lane.setActiveTools`, which pi stores in the lane's configuration.
  - **The guidelines name nothing that changes**, the offer's bookmark among
    them: it changes when a thread is named. `lane.md` says how it is named.
  - **A change is logged.** A `before_payload` hook hashes each request
    without its messages (`prefixOf`, `prefix.ts`), and calls
    `onPrefixChange(lane)` when it differs from the lane's last request
    (`prefixChange`). The host logs it.
- **`catch_up` and `split_offer`** (`thread-tools.ts`, ADR-0080) read their
  arguments (`parseCatchUpArgs`) and hand the call to the host
  (`LaneHooks.catchUp`, `LaneHooks.askSplit`), whose `ToolAnswer`
  (`@pinetrie/rules`) becomes the result: its text, and as `details` the
  commits a `catch_up` merged, which `parentNow` and the turn's record read.
  The host's answer to `catch_up` arrives while the run waits on it: the
  merge runs on the lane's queue, which no tool call holds (S103 item 1).
  pi's harness reads only the run's `toolExecution`, never a tool's
  `executionMode`, so `catch_up` cannot ask to run alone; the host refuses a
  call with a sibling instead.
- **`resolve_conflict`** (`thread-tools.ts`) is in every lane's list, so a
  run's tools never change (S85): `{ path, choose }`, `choose` read by
  `parseResolveChoice` (`ours`, `theirs` or `base`), handed to the host
  (`LaneHooks.resolveConflict`), which closes a folder lane's conflict on
  its queue and refuses in a jj lane, whose conflicts are markers in the
  file. The `resolve-conflicts` skill says the folder's way: the three
  versions under `/pinetrie-states/conflicts/`, `diff`, then the tool.
- **`set_banner`** (`banner.ts`, ADR-0050, ADR-0143) is registered and
  active whenever the host has tools: `bannerAsks` is part of
  `CreateAgentOptions.tools`, so an agent with tools always has it. The host
  answers each ask under the config's icon source: a pasted image is
  set under any, and a new drawing refused (`off`) unless the source is
  `drawn`, which the tool's answer names. The tool reads its arguments
  (`parseBannerArgs`: an image that names no pasted image is refused, not
  ignored) and hands the ask to the host.
- **`save_blob`** (`save-blob.ts`, ADR-0151) saves a file shared in the
  thread into the agent's lane. The host answers which bytes
  (`LaneHooks.readBlob`: a blob some message on the lane's path showed its
  model, or why not); the tool writes them itself with its tool context's
  `env.writeFile`, the path resolved against `toolContext.dir` as `write`'s
  is. The host must not write instead: its own writes go on a run's input,
  which the helper never counts as the agent's, so the disk model and a
  shared directory's lineage would miss the file. `writeFile` carries raw
  bytes through the channel as base64, 64 MiB in a quarter second (S206).
- **pine·trie's own skills** are in `skills/`, loaded after yours and the repo's
  (`additionalSkillPaths`; pi's loader keeps the first of a name):
  `resolve-conflicts` (ADR-0033), `commit-message` and `offer-stack`
  (ADR-0105), `column-banner` (ADR-0053), whose whole body is the image
  model's prompt, and `ask-digest` (ADR-0106), whose reply has a shape the
  host reads (`digestOf`, ADR-0075): a replacement must ask for it too. So
  one of yours or the repo's of the same name replaces pine·trie's. All five are
  `disable-model-invocation: true`: only the host asks for them.
  `PiSetup.skill(name)` reads the file at call time, without its frontmatter,
  and hashes it. The scripted and named model choices load no resources, so
  it falls back to the file in `skills/`.

### The search tools (`search.ts`, ADR-0064, S88)

- **Why not pi's.** pi-coding-agent's `grep` and `find` spawn rg and fd on
  the host (`child_process`) and read files back with `node:fs`, so in a lane
  of its own they would search the Mac. Ours run one `env.exec`, which goes
  through the lane's channel like `bash`.
- **pi's rule goes with them.** pi adds "Use bash for file operations like
  ls, rg, find" when `selectedTools` names `bash` and none of `grep`, `find`,
  `ls`. Both tools are in `assembleTools`'s `files`, which is
  `selectedTools`, so the rule is gone for every lane.
- **One call:** look up the program (`ToolContext.programs`), plan the
  arguments (`grepArgs`, `findArgs`) and one command (`shellCommand`, from
  core's `shellWord`), run it, read the run (`searchOutcome`), word it
  (`searchText`). No pipe: it would hide rg's exit status, and `pipefail` is
  not in every image's `sh`.
- **Exit codes differ.** rg exits 1 when nothing matches; fd exits 0 with no
  output. Anything else is a failure, thrown with what the program printed,
  which is stdout and stderr mixed, as `exec` gives them.
- **`limit` counts lines**, through the capture: `retain: "head"` keeps the
  first `limit` lines and rg runs to its end. grep's `limit` includes context
  lines, unlike pi's, which counts matches. find asks fd for `limit + 1`
  results, so a cut capture means there were more.
- **Gitignored paths are skipped**, a shared `.plans` included, unless named
  as `path`. With no `path`, neither program is given one, so paths print
  without a leading `./`.
- **`.gitignore` is read with or without a repo** (S180): both get
  `--no-require-git`, so a folder project's lane, which has none, skips
  what git would; and `--no-ignore-parent`, so no file above the directory
  searched counts. rg reads no global excludes file (`--no-ignore-global`)
  and fd not its own (`--no-global-ignore-file`); fd has no flag for git's,
  which in a lane only the lane's home can hold. `.ignore` still counts: it
  only hides more from search, never less.
- **The tests** cover the plans and words purely (`search.test.ts`), and a
  stand-in rg run through the real helper (`lanes.test.ts`), which shows the
  head capture and the absolute path crossing the channel. The real programs
  run in `e2e:lanes`' `images` scenario, on Alpine.

### Commands: your skills and prompts (`commands.ts`, ADR-0036)

- **Every skill and prompt template pi loaded** comes back from
  `loadModelSetup` as a command to be labelled, those pi's collision handling
  dropped included:
  - pi keeps one of each name and records the loser's file in a `collision`
    diagnostic;
  - `gatherCommands` loads each loser again, with `loadSkillsFromDir` or
    `loadPromptTemplates`.
  - **A command is labelled by what pine·trie listed** (`commandOrigin`),
    never by pi's record of it: pi records a listed package's skills as
    `cli`/`temporary` with no root (S193). A file under a listed package is
    that package's: its path is the command's source, and its
    `.claude-plugin/plugin.json`, else `package.json`, gives the label. A
    file in a listed folder of skills or prompts is labelled by the layer
    that listed it (`user`, `project`, …). A skill under pine·trie's own
    skills directory is `pinetrie`.
  - The model's own skill list keeps pi's precedence: one per name.
- **`loadPiSetup` labels them** with `commands.names` (`commandRenames`,
  keyed by a listed package's path) through `labelCommands`
  (`@pinetrie/rules`). `commands()` is
  the list, `refusedCommands()` what clashed, and `skill(name)` takes a
  qualified name: a conflicted update asks for
  `pinetrie:skill:resolve-conflicts`.
- **`expand(command, args, inLane)`** reads the file now, then runs the pure
  `expandCommand`, which hashes it. `skill(name)` reads, then runs `skillOf`.
  Both strip frontmatter with `withoutFrontmatter`, which never parses it: a
  file whose YAML broke after pi loaded it still expands.
  - a skill becomes pi's block through `expandSkill` (`@pinetrie/rules`), which
    copies the format of `_expandSkillCommand` in pi-coding-agent's
    `dist/core/agent-session.js`. That method is private to pi's session, so
    the format is copied, and pinned by a golden test. Diff it on every pi
    upgrade. A bundle chunk has another variant, built from
    `dirnameEnvPath`; it is not the one;
  - a template becomes its text with pi's `substituteArgs` and
    `parseCommandArgs`;
  - with `inLane`, a skill's file and directory are written where the lane
    reads them (`laneSkillPath`, core): in its own copy for a project's
    skill, else at `/mnt/host` and their host path.
- **A lane of its own's system prompt** lists only the skills it can read
  (`skillsInLane`): a project's, at `/workspace` and their path in the
  project, and those under a host path it has mounted, at `/mnt/host` and
  their path. `LaneAccess` carries those host paths. A project's skills are
  never mounted from the host: the lane has them already.
- **Suites never read your config.** They list `fixtures/fixture-pkg` and
  `fixtures/other-pkg`, each with a skill `hello`, in their own user
  `pinetrie.json`'s `packages`.

### Sign-in (`auth.ts`)

`providerAuth` opens pi's runtime over pine·trie's `auth.json`, with the
providers the listed packages register, and makes the credentials' folder
private (0700); pi writes `auth.json` itself, 0600. `providers()` lists
each provider's methods and where its credential is, never the credential.
`signIn` runs pi's `login` with pine·trie's own interaction shape, so no pi
type crosses: a prompt asks for text, a secret, a pasted code or a choice;
a notice gives a sign-in URL, a device code, information or progress.
`planSignIn` reads `pnpm sign-in`'s arguments, pure; the script
(`apps/pinetrie/scripts/sign-in.ts`) is only the terminal.

### pi's checkpoints, stored as text (`checkpoint.ts`)

While a tool runs, pi writes its whole output view to `pi.pending.tool_output`
every 2 s. `KynetaStorage` stores a checkpoint with one text part in two pieces:
the value record keeps a shell (`sealed: true`), and the text goes to
`checkpointText` under the same physical key, written with `tailEdit`. Reads
rejoin them; a delete removes both. Any other shape is stored whole.
`sealCheckpoint`/`unsealCheckpoint` are the pure rule. Conformance stays 21/21.

`KynetaStorage` re-indexes only for **replayed** changes (hydration, or edits
synced from another replica): its own commits index themselves. Which indexes a
replayed change touches is `dirtyFrom`, a pure function: only pi's four fields
(`entries`, `usageRows`, `values`, `lists`), by key; a change with no field, the
whole document; any other root field, nothing. It replaced a list of fields to
ignore, which had to name every non-pi field: one it missed (after `activeRunId`
became `activeRuns`) made a replayed change to it re-index everything. That cost
only work, never correctness, and never touched the host's own stream writes.

`scopeOf` folds a changeset's changes into one `Scope`. Kyneta's `merge` names
the keys it sets and deletes (`["usageRows"] {type:"map", set:{u1:…}}`,
`["lists","l"] {type:"sequence"}`), so a merged usage row is re-indexed alone,
as an entry is. The replay test in `storage.test.ts` relies on this.

### Values

`values` holds pi's own values (a lane's tip, its config, a checkpoint).
The host's records are in the document's `records` field, which the host
writes itself (ADR-0095); `KynetaStorage` never reads it, and `dirtyFrom`
ignores its changes. This package imports no record namespace or encoder:
what a record is lives in `@pinetrie/rules`.

### `seq` is derived, not stored

Nothing about `seq` is replicated: an entry is named by its uuidv7 id,
written once (ADR-0009), and entries and usage rows are only ever added
(ADR-0004), so `dirtyFrom` re-indexes the whole field for a change to
either that sets no key. `planArrivals` (`arrivals.ts`) assigns arrival order. Entries are ordered by
`orderNewEntries` in `@pinetrie/core`, which is pure and property-tested there for
permutation invariance. Its `unresolved` ids are a parent cycle and the entries
below one: a parent outside the batch never blocks a child, whether or not it
exists. `#reconcile` sequences the rest and throws once, naming the cycle.

Entries, usage rows and each list are an `ArrivalLine`: ids in ascending seq.
Seqs only ever append above the last, so a `fromSeq`/`toSeq` range or pi's
exclusive cursor (`boundsAfter`) is a contiguous slice, found by binary search,
and `readList` does not sort.

Two assumptions to know:

- **Parents before children rests on causal delivery.** A child whose parent
  has not arrived is sequenced anyway, and the parent later gets a higher seq.
  Kyneta delivers causally, so this does not happen; a check would make a
  document with partial history fail on every read.
- **A value record may have no `wid`.** `writeLaneTip` (fixtures, tests) writes
  `{ namespace, key, value }`. Present and holding a token are separate facts:
  such a record is indexed once and keeps its seq.

### Commit and reconcile: plan, then apply

Both paths end in `ArrivalIndex.apply(batch)`, the only code that changes the
index, its counts and its last seq. `#reconcile` gathers (`#observe`, the
document for the scope's keys), plans (`planArrivals`) and applies.
`#applyCommit` gathers the image lookups, plans with `planCommit`, writes the
operations in one `batch` (`writeOp`), and applies after the batch, so a write
that throws leaves the index as it was.

`Batch.through` is the last seq the batch used. pi gives a delete a seq, and a
delete records nothing, so a commit ending in a delete would otherwise leave
the next commit reusing that seq.

The execute step reads in two places on purpose: `tailEdit(text(), …)` diffs
against the live checkpoint text inside the batch, and `token()` makes each
`wid` and `eid`. `planCommit` takes `token` as an argument, so a test gives it
a counter.

### `deep.ts`

Reaches pi entry points that are absent from its `exports` map, by relative path
into `node_modules`: `createAgentHarness`, `addUsage`/`emptyUsage`,
`ModelRuntime`, `SettingsManager` and `DefaultResourceLoader` (only
through `openRuntime` and `openLoader`), and `buildSystemPrompt`. For commands:
`loadSkillsFromDir`, `loadPromptTemplates`, `substituteArgs`
and `parseCommandArgs`. For images (ADR-0042):
`detectSupportedImageMimeType`, `resizeImage` and `formatDimensionNote`. Those paths are depth-sensitive: they broke when this
package moved under `packages/`. If they break again, the failure is
`ERR_MODULE_NOT_FOUND` at import time, not a type error.

## The contract test

`pnpm run conformance` runs **pi's own Storage conformance suite** against this
adapter, twice (Kyneta-backed and in-memory control). 21/21 + 21/21.

It is the authority on round-trip fidelity — far more thorough than a
hand-written test — and it is the canary for pi upgrades: if pi's `Entry`
envelope moves, this fails at upgrade time rather than corrupting data silently.
It survived 0.85 → 0.87.1 and the ADR-0015 typed-row change unchanged.

Note what it does **not** do: it detects change, it does not design for it.
Probes P1 and P2 in `sandbox/s17-typed-entries/` could each have failed while
conformance stayed green, which is why they ran first.

### Agents talking: `ask`, `leave`, and the budget's gate (ADR-0128, S144)

- **`ask` and `leave` are the host's tools** (`thread-tools.ts`), as
  `catch_up` is: each reads its call and returns the hook's answer
  (`LaneHooks.ask`, `LaneHooks.leave`). `ask` never waits for the asked
  agent's answer: two agents that waited on each other would never finish
  (S144). Every lane has both, so its tool list stays the same between
  runs (S85); adding them changed every lane's prefix once.
- **`AGENTS_RULE`** (`@pinetrie/rules`) is in every thread's `<rules>`,
  after the context rules.
- **`onUsage`** is pi's `usage` event, per request and per lane, as a
  `RequestTokens`: its context (input, cache reads and cache writes) and
  its output. What a budget spends of it is the host's (`addedTokens`).
- **`mayRequest`** is asked in a `before_request` hook; false aborts the
  run before the request is sent. The hook awaits the held lane, which
  resolves at once, and does not await the abort: the hook runs inside the
  lane's drive, which an awaited abort would wait on (S144).
- **`complete` returns its tokens** (`Completed`): a budget counts a
  relayed run's verdict and digest requests too.
- **Gotcha: compaction keeps only what is stored.** pi summarises stored
  messages with `convertToLlm` and skips custom entries, so what an asked
  agent hears of another thread is copied into its thread as a heard
  entry's `content`, never drawn in from the other root at each request
  (S144). `run` writes it first in `before`, so the cards entry stays the
  prompt's parent.

### Requests outside every thread (`PiSetup.complete`, ADR-0105, ADR-0106, ADR-0074)

`complete({ system, user, purpose })` is one `completeSimple` request, with
no tools and no session: nothing enters the tree or a lane's context. It
writes an offer's commit message (`describeRequest`) and an ask's digest
(`digestRequest`, the `ask-digest` skill) on `describeModel`, and a root's
title (`titleRequest`, the `tab-title` skill, `purpose: "title"`) on the
model `titleModel` chose at load: `PiSetupOptions.titleModel` when pi
has it (`titleModelFound` says whether), else `describeModel`, and always
`describeModel` for a scripted model; the host
builds each request and this package only carries it out. A failed request
returns null: the offer keeps its placeholder, the ask its last digest, and
the root its label. A scripted model answers it from its own provider
(`describe`), so none takes a reply from the run's script.

### Banners' images (`PiSetup.drawBanner`, ADR-0050, ADR-0053)

- **`setup.images`** is pi-ai's image registry (`createImagesModels`):
  `openrouterImagesProvider()` for a named or configured model, and
  `scriptedImages()` for a scripted one, which draws `SCRIPTED_IMAGE_PNG`
  and needs no key. An OpenRouter id pi-ai does not list is described by
  `imageModelFor` (text in, image out), since `generateImages` takes the
  model as given: so a model newer than pi-ai, such as
  `recraft/recraft-v4.1-flash`, can be named.
- **The registry does not read `auth.json`.** `images.apiKey(provider)`
  asks the `ModelRuntime` (`getAuth`), which reads `auth.json` and then
  `OPENROUTER_API_KEY`, and the key is passed as `apiKey`.
- **pi-ai sends no `image_config`.** `drawBanner` adds
  `bannerImageConfig` in `onPayload`: `aspect_ratio` always 1:1, since
  OpenRouter clamps a ratio to what the model has and every model has 1:1.
  A `recraft/` model also gets `background_rgb_color: [0, 0, 0]`, the black
  that the client's `mix-blend-mode: lighten` removes. Only Recraft models
  take that field, so no other model is sent it. Its `[r, g, b]` shape
  comes from OpenRouter's image docs as archived in June 2026; the current
  page no longer documents it, and the model's OpenRouter description
  names it.
- **`drawBanner` never rejects**: `drawn` with an image, or `failed` and
  why. A request may take 120 s; one takes about 9 s (S60). The image is fitted in pi, as `read`'s are (`drawnOf` runs
  `prepareImage`), so the host stores what it is given; bytes that are not an
  image are a failure, and the host tries again. `canDrawBanners` is asked
  first, so a host with no key reads no skill and asks no model.

