# `@pineta/pi` — technical notes

**The pi boundary.** This is the only package that may resolve
`@earendil-works/*`. That is enforced by module resolution, not by a scanner:
pi is declared here and in `@pineta/conformance` (`apps/conformance`) and nowhere else, so from the
app every spelling fails with `ERR_MODULE_NOT_FOUND`. See
`docs/01-architecture.md`.

`index.ts` re-exports our shapes only. No pi type crosses the boundary
(ADR-0003).

## `storage.ts` — our implementation of pi's `Storage` port

### The split and the rejoin (ADR-0015)

pi hands us an `Entry`. The document stores a typed row. Two pure functions do
the conversion, and they are the functional core of this module:

```
toStoredRow(entry)        Entry minus seq  ->  StoredEntryRow
fromStoredRow(row, seq)   StoredEntryRow   ->  Entry
```

Three rules hold them together:

1. **`payload` carries variant data and only that.** `NEVER_IN_PAYLOAD` lists
   the hoisted columns plus `seq`. Duplicating a column into `payload` would
   give `parentId` two homes with nothing keeping them equal — `#reconcile`
   orders arrivals from the column while a renderer might read the blob. A
   round-trip test **cannot** see this, because rejoining from either copy
   yields the same entry. The disjointness test in `storage.test.ts` is the
   only guard.
2. **`seq` is passed to `fromStoredRow`, never read from the row.** It is a
   replica-local arrival index (ADR-0013) and never lives in the document.
   Passing it keeps the pairing visible in the type.
3. **Absent and null are different facts.** `fromId` exists only on
   `branch_summary`, so the column holds `null` for every other type and the
   rejoin restores *absence*. Every message entry hits this path.

`storage.test.ts` is co-located here on purpose: `toStoredRow` takes pi's
`Entry`, so a test under `test/` would import a pi type across the boundary
ADR-0003 exists to hold. `vitest.config.mjs` includes `packages/*/*.test.ts`
for this reason.

### Lanes belong to threads, and never move (ADR-0020)

The host owns one harness. A lane is a thread's line of work: created by
`Agent.createThreadLane(at)` where agent work is first wanted in a thread, named
`laneNameForThread(uuidv7)` (`t-…`), and never navigated. People own no lanes;
a message records its writer (`details.author`, from the transport). A lane's
tip is therefore always its thread's end, and `threadOf` finds a thread's
lane from its end with no stored mapping.

The facade has no way to move a lane: `ThreadLaneHandle` offers only `append`
and `run`. Nor is there a way to READ a tip through the agent: readers use the
document, so observing a lane can never create one.

Three facts from pi's source and the probes shape it:

- **`harness.lane(name, { createAt })` THROWS `UnknownTarget`** for an entry pi
  does not hold, where most of pi's API returns a `Result`. `createThreadLane`
  catches it. The host also refuses a chat at an unknown entry before writing
  anything, because a lane-less append there would reach storage with a parent
  that does not resolve.
- **`harness.lane(name)` creates a missing lane.** So restoring a lane after a
  restart checks `hasLaneRecord` first: pi records a lane's `pi.branch.tip` key
  when it creates it, with a null value until the first entry.
- **A foreign-written entry is not navigable** (`unknown_target`): pi's session
  never saw it created. The Node e2e keeps a `writeEntry` fixture for that S3
  case.

### Conversation threads have no lane (S21)

A thread where the agent has not been asked has no lane. `appendToTree` inserts
its messages with `session.mutate` + `insertEntry`, parented at exactly the
entry the plan chose; the entry is a full member of the tree (navigable, and a
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
  while a queued question is never answered (S21 Q3). The host holds such
  messages in `pineta.outbox` (`Agent.hold`/`release`) and drains them when the
  lane is idle; see `packages/marginalia/TECHNICAL.md`.
- **A pi run can only start with `prompt`**, so a compelled chat is passed to
  `ThreadLaneHandle.run` as the prompt itself: a pi `CustomMessage`, which pi's
  default `convertToLlm` sends as a `user` message with its `content`.
- The harness is created with `followUpMode: "one-at-a-time"`, so that pi's own
  queue, if ever reached, answers one message at a time rather than batching
  (S20). Pineta's outbox means the host does not use it.

`laneErrCode(tag)` maps pi's refusal tags for runs and lane creation, so none of
pi's vocabulary passes the boundary (ADR-0003): `UnknownTarget` and `LaneBusy`
have codes of their own; anything else is `refused`. The host never writes to
a running lane, but after a crash pi holds the interrupted operation open, and
the lane is `LaneBusy` until resumed (below).

### Streaming, in Pineta's words (ADR-0022)

`createAgent` takes one `onStream(event: StreamEvent)`. `StreamEvent` is
declared in `@pineta/core`, so pi's events never leave this package. Every pi
`HarnessEvent` carries `lane`, so concurrent threads stay apart.

| pi's event | `StreamEvent` |
|---|---|
| `message_update` (a `text_delta`) | `text` |
| `tool_start` | `toolStart`, labelled `toolLabel(name, args)` here |
| `tool_update` (the first text part of `partialResult`) | `toolOutput`, a whole snapshot |

`message_end` and `tool_end` are not mapped. The entry pi commits after each
is what ends its stream on screen (ADR-0044), and an end event comes before
it (S35).

The harness's tool events are `tool_start`, `tool_update` and `tool_end`. The
`tool_execution_*` events in pi's types belong to its older agent loop, and the
harness never emits them (S22). What each event does to the document is
`planStream`'s decision, in `@pineta/schema`.

### What the model reads: a chat's images (ADR-0042)

`createAgent` passes pi's `toProviderMessages` our own: it gathers the bytes
of every chat's `details.images` from `CreateAgentOptions.blobs`, encodes
them, and runs `withChatImages` (`@pineta/marginalia`) before pi's own
`convertToLlm`, which it must still call so every other role converts as pi
does. It runs once per request, and reads the store each time: no cache
(S53 item 7). pi's compaction and branch summaries call `convertToLlm`
directly, so a summary reads a chat's text and never its images. For a model
whose `input` lacks `"image"`, pi-ai replaces each image with a line of text.

`prepareImage` (`images.ts`) fits an upload for the store: the type from the
bytes (`detectSupportedImageMimeType`), then `resizeImage`, in a worker
thread, to 2000×2000 and 4.5 MB of base64. A type no provider takes inline
(BMP) is "not an image"; a resize that returns null is "unreadable", since
pi's null means either undecodable or impossible to fit.

The scripted model's `reply` shows an image part as
`[image <mimeType> <sha256 of its bytes>]`, so a suite can check which image
the model was given.

### Models, tools and the prompt (`config.ts`, S23)

`ModelChoice` is one of three:
- **`configured`:** the person's pi setup. `SettingsManager` and
  `DefaultResourceLoader` load it as pi does, and only the extensions'
  provider registrations are applied to `ModelRuntime`. Commands, tools,
  handlers and UI hooks are pi's coding agent's, and Pineta emits none of its
  events. A Claude subscription token works only through `pi-anthropic-auth`'s
  provider: without it, Anthropic refuses (S23).
- **`named`:** `models.json` and `auth.json` only, for `e2e:live`'s one real
  run (ADR-0041).
- **`scripted`:** pi-ai's faux provider (`scripted.ts`), for repeatable suites.
  - A reply is the next step `use` queued, else the standing `answer`, else
    an error reply. A request takes its step when it arrives.
  - `pause(prompt)` holds the reply to the next request whose last user
    message includes `prompt`, until `resume()` or the run's abort. Its
    `reached` resolves when that request arrives, so a check sees the run in
    progress for as long as it needs.
  - A second faux provider answers commit-message requests (`describe`, by
    default `SCRIPTED_DESCRIPTION`), so a describe request never takes a
    reply from the run's script (S48 item 22). `ModelSetup.describeModel` is
    that model when scripted, and the run's model otherwise.
  - **Each request queues its own response** (`perRequest`): both providers
    are wrapped so that `stream` and `streamSimple` append one dispatcher,
    then delegate. Faux takes a response off its queue when a request
    arrives, but runs a response factory a microtask later, so a factory
    that queued itself again left the queue empty for a second request in
    the same tick (S52 item 6).
  - Its handles never leave this package.

Loading runs every package's factory, so side effects happen (`pi-subagents`
logs a warning). `pickModel` is the pure choice: an override's fields win over
the settings' defaults. With tools (`CreateAgentOptions.tools`), pi-agent-core's
`read`, `write`, `edit` and `bash` run in each lane's own directory (below).
Settings, context files and skills load from `tools.project`. The system prompt
is pi's `buildSystemPrompt`, with the loader's context files (the repo's
`AGENTS.md`) and skills: the section layout `pi-anthropic-auth` shapes. Its
`cwd` is the lane's directory.

`ThreadLaneHandle.abort()` is pi's `lane.abort`: a running tool is aborted and
its result recorded as aborted, and the lane takes its next message (S22).

### Where each lane works (`lanes.ts`, `lane-env.ts`, ADR-0032, ADR-0034)

One harness serves every lane, but pi resolves the tools' context from the
run's `Context` alone: `toolContext` is a function of it
(`harness/runtime/drive/tools.js`). So every call that drives a lane carries
its name in the `Context` (`laneContext`): `run`, `resume`, `append` and
`abort`. Everything else comes from the host's `access(lane)`, one source for
where a lane works. pi's hooks see the lane's name directly. Measured in S36
item 18, and in `lanes.test.ts` against the harness.

- **`LaneAccess`** is Pineta's type, so no pi type crosses the boundary. It
  is either `direct` (a directory on the host, and a promise its tools wait
  for) or `lane` (a lane of its own: its directory, `/workspace`, its shared
  directories relative to it (ADR-0035), and a `gate()` that settles with its
  channel).
- **A lane working directly** gets pi's `NodeExecutionEnv` in its directory
  (`directEnv`). Every method first awaits `ready`, and `shellEnv` sets
  `JJ_EDITOR`, `VISUAL` and `EDITOR` to `false`.
- **A lane of its own** gets `laneEnv(dir, gate)`: a proxy whose every method
  first awaits the gate, then forwards the call over the lane's channel.
  - The helper (`lane-helper.ts`) serves pi's own `NodeExecutionEnv` in the
    container, so pi's tools run there unchanged. They use 8 of its methods:
    `absolutePath`, `canonicalPath`, `exists`, `fileInfo`, `readTextFile`,
    `readBinaryFile`, `writeFile`, `exec` (S43 item 1).
  - The context's abort sends `{ abort }`.
  - `exec`'s `onUpdate` receives each update.
  - Methods whose results are not data are refused with `not_supported`, not
    forwarded: `openTextLineReader` returns an object with methods.
  - The gate is the lane's queue in the host, so the model can think while a
    turn's disk is cloned, and no tool touches the disk until the clone is
    done.
- **The channel** (`openChannel`) is one long-lived process: the helper,
  started by `container exec -i`, speaking `lane-protocol.ts`, one JSON line
  per message.
  - Requests are answered concurrently: pi runs a turn's calls in parallel.
  - The host closes the channel by ending the helper's input. Killing
    `container exec` does not reach the guest (S43 item 2).
  - A helper that exits fails every waiting call with its stderr.
  - `laneRunner(channel)` gives the host's own jj and git a `run` request:
    exit status, stdout and stderr apart, and bytes for a bundle. pi's `exec`
    gives only an exit code and capped, mixed text.
- **The protocol** (`lane-protocol.ts`) imports nothing, since the helper
  runs it from Pineta's install, mounted read-only at `/pineta`.
  - Bytes cross as base64, read from `this[key]` in the replacer: `Buffer`'s
    own `toJSON` runs first and would hand over `{ type, data }`.
  - Errors cross as `{ name, code, message, path }` at any depth, since
    `NodeExecutionEnv` never throws: its errors are values inside results
    (S44 item 5).
- **The helper runs on the lane runtime's Node through its own loader**, so
  `process.execPath` is the loader: nothing in it may re-execute that
  (S44 item 2).
- **The system prompt** names the lane's directory. For a lane of its own it
  adds guidelines: `/mnt/host-working-copy` is your working copy, read-only;
  and each shared directory is shared with the person and every other
  thread, live, and never part of a branch. The model is sent the
  conversation as stored: nothing is rewritten.
- **`before_request`** calls `hooks.turnDone(lane, tip)`, and pi awaits it:
  every tool of the turn before has finished, so the commit never races a
  write. The turn's snapshot is queued on the lane: the next tool call waits
  for it, the next request does not.
  - It reads the tip from the document, not from the lane: asking the lane
    from inside its own drive could wait on itself.
  - It acts on `assistant` requests only; compaction and summaries request
    too.
  - `run` and `resume` call it once more after the run, for the last turn.
  - A hook that throws is reported by pi, and the run goes on.
- **Resume after a crash.** `Agent.interrupted()` lists lanes whose
  `inspectExecution` shows an open operation; `ThreadLaneHandle.resume()`
  resumes one in its `Context`. pi records the interrupted tool call as
  interrupted, never running it again, and the rest of the run uses the
  directory in `resume`'s `Context`. `lanes.test.ts` reproduces the crash with
  two agents over one document.
- **`ask_for_guidance`** is registered for every lane but inactive:
  `ThreadLaneHandle.withGuidance(on)` adds or removes it with pi's
  `lane.setActiveTools`, which pi stores in the lane's configuration. The host
  turns it on exactly while the run's prompt is a land message, and off at
  every run's end, so a crash cannot leave it on for a later run.
- **Pineta's own skills** are in `skills/`, loaded after yours and the repo's
  (`additionalSkillPaths`; pi's loader keeps the first of a name):
  `resolve-conflicts` (ADR-0033), `commit-message` and `offer-stack`
  (ADR-0038). So one of yours or the repo's of the same name replaces
  Pineta's. All three are `disable-model-invocation: true`: only the host
  asks for them.
  `Agent.skill(name)` reads the file at call time, without its frontmatter,
  and hashes it. The scripted and named model choices load no resources, so
  it falls back to the file in `skills/`.

### Commands: your skills and prompts (`commands.ts`, ADR-0036)

- **Every skill and prompt template pi loaded** comes back from
  `setUpModel` as a command to be labelled, those pi's collision handling
  dropped included:
  - pi keeps one of each name and records the loser's file in a `collision`
    diagnostic;
  - `gatherCommands` loads each loser again, with `loadSkillsFromDir` or
    `loadPromptTemplates`, and finds its package root above it.
  - A label's sources, `.claude-plugin/plugin.json` and `package.json`, are
    read from the package root pi records (`sourceInfo.baseDir`).
  - A skill under Pineta's own skills directory is `pineta`.
  - The model's own skill list keeps pi's precedence: one per name.
- **`createAgent` labels them** with the user config's renames
  (`commandRenames`) through marginalia's `labelCommands`. `commands()` is
  the list, `refusedCommands()` what clashed, and `skill(name)` takes a
  qualified name: a conflicted update asks for
  `pineta:skill:resolve-conflicts`.
- **`expand(command, args, inLane)`** reads the file now and hashes it:
  - a skill becomes pi's block through marginalia's `expandSkill`, which
    copies the format of `_expandSkillCommand` in pi-coding-agent's
    `dist/core/agent-session.js`. That method is private to pi's session, so
    the format is copied, and pinned by a golden test. Diff it on every pi
    upgrade. A bundle chunk has another variant, built from
    `dirnameEnvPath`; it is not the one;
  - a template becomes its text with pi's `substituteArgs` and
    `parseCommandArgs`;
  - with `inLane`, a skill's file and directory are written at `/mnt/host`
    and their host path.
- **A lane of its own's system prompt** lists only the skills under a host
  path it has mounted, at `/mnt/host` and their path (`skillsInLane`).
  `LaneAccess` carries those host paths.
- **Suites never read your pi configuration.** A scripted or named model
  loads skills and prompts only when `agentDir` is given. Suites give
  `fixtures/pi-agent`, whose settings list two fixture packages, each with a
  skill `hello`.

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

### Values

`setNote`, `setArchive` and `setWorkRecord` write `pineta.note`,
`pineta.archive` and the four work records through `Session.setValue`
(ADR-0025, ADR-0029, ADR-0032): every setter's body is one `put`. They use the
generic value path, so conformance covers the storage shape. `setWorkRecord` takes its namespace and key from
`encodeWorkRecord`, in marginalia.

### `seq` is derived, not stored

`#reconcile` assigns arrival order. The ordering itself is
`orderNewEntries` in `@pineta/core` — pure, and property-tested there for
permutation invariance. This shell only assigns the seqs it returns.

### Deferred: a pure `planCommit`

`#applyCommit` is already close to gather → plan → execute. `#reconcile`
gathers, pi's `prepareStorageCommit` plans, `validateCommittedWrites` checks,
and staged index arrays are applied only after the substrate batch succeeds —
that staging pattern is good and worth keeping.

What remains interleaved is the `switch` inside `batch`, which decides *what to
stage* while performing *the write*. A pure
`planCommit(writes) -> { docOps, indexOps }` would separate them. Deliberately
not done as part of ADR-0015: the row shaping was the right-sized extraction
and holds the subtle logic.

### `deep.ts`

Reaches pi entry points that are absent from its `exports` map, by relative path
into `node_modules`: `createAgentHarness`, `addUsage`/`emptyUsage`,
`ModelRuntime`, and, for the person's pi setup, `SettingsManager`,
`DefaultResourceLoader` and `buildSystemPrompt`. For commands:
`loadSkillsFromDir`, `loadPromptTemplates`, `substituteArgs`,
`parseCommandArgs` and `stripFrontmatter`. For images (ADR-0042):
`detectSupportedImageMimeType` and `resizeImage`. Those paths are depth-sensitive: they broke when this
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

### Commit messages (`Agent.describe`, ADR-0038)

`describe({ system, user })` is one `completeSimple` request on
`describeModel`, with no tools and no session: nothing enters the tree or a
lane's context. The host builds the request (`describeRequest`, in
marginalia) and adds the trailers; this package only carries it out. A failed
request returns null, and the offer keeps its placeholder.

