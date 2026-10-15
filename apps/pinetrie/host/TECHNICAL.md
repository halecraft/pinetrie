# The host's shell: technical notes

The host gathers facts, calls the pure decisions in the packages
(`@pinetrie/rules`, `@pinetrie/reads`, `@pinetrie/schema`, `@pinetrie/lanes`),
and carries them out. This directory is that imperative shell. Each module
does one thing and takes its dependencies as a parameter; `index.ts` alone
wires them.

## Where things are

| module | owns |
|---|---|
| `dev.ts`, `serve.ts`, `server.ts`, `invocation.ts` | `pnpm dev [folder]` and `pnpm serve [folder]` (ADR-0086, ADR-0148), each a few lines over `runHost` (`server.ts`): `planInvocation` (the folder), `storeChoice` (the session's file, and whether `PINETRIE_STORE` named it; else the session's own, in its data directory for every kind of project, ADR-0150), `refusalText` (a refusal's words, with its command's usage). A relative folder is read from `INIT_CWD`, pinetrie's root, not the shell's directory (S108); `pnpm dev:react` serves React's development build, for its warnings and render timeline (S59) |
| `page.ts` | the page a host serves (ADR-0148): Vite under `pnpm dev`, else the built page in the page's `dist/`, which `pnpm serve` rebuilds first when its stamp no longer matches its inputs (`ensurePage`), and whose files it reads once at start (`readBuiltPage`); where the page's package is (`pageDir`) |
| `sessions.ts`; and `sessionOfFolder`, a read of the registry alone, for `pnpm tidy` | the session a host serves (`openSession`, ADR-0149): the folder's real path looked up in the registry under its lock, the registry written, the session's data directory made and its `host.pid` taken; and `renameSession`, for `pnpm session rename` (`apps/pinetrie/scripts/session.ts`); and `sessionOfFolder`, a read of the registry alone, for `pnpm tidy` |
| `tidy.ts` | `pnpm tidy`'s shell (`apps/pinetrie/scripts/tidy.ts`, ADR-0155): `takeTidyLock`, the session store's own lock taken without waiting, so a host serving the folder refuses the tidy and a host starting during it is refused; the sizes it reports (`sizesOf`); and every line it prints, and the startup line, from values (`tidyWords`). What a tidy does is `@pinetrie/jj`'s `planTidy`. The folder is `invocation.ts`' `planTidyInvocation`, which reads one as `pnpm dev` does (`folderOf`) |
| `startup-lines.ts` | the words of what a starting host logs about its inputs: the project, the session (`sessionLines`), the store, each config file and what it refused (`reportLines`, in the setup page's words), the agent's model and where it came from or why there is none, the URL and invites, and the setup page's URL with no model |
| `settings.ts` | every setting the host reads, declared once (`SETTINGS`, ADR-0146) with the layers that may set it and how they combine; the project's copies as values (`laneAuthority`, `decodeAuthority`, `laneCopy`), `settleHost`, `folderReport` for a host without lane work, and the settled values as the deciding packages take them (`repoNames`, `iconSettings`, `titleSettings`, `sshChoice`, `listedFolders`) |
| `setup-record.ts` | `planSetupRecord`: the `pinetrie.setup` value, from the config's report and what the model setup loaded |
| `index.ts` | `startHost`: the store and the check of its schemas (`migrations/`), the Exchange (with its `resolve` for the documents clients create, `resolveDoc`), the documents and the records, then pi's scribe and setup, lane work and the agent, in that order (§ Startup), then the wiring below |
| `basics.ts` | `Basics` (the session, `pinetrie:live`, the documents, the places, log, ids, clock) and how a failure is logged (`failed`, which words the error with core's `errorText`) |
| `places.ts` | the one writer of the places document (ADR-0059, ADR-0048 step 6): `Places.change(cause, body)`, one change under its cause, whose `OpenChange` writes steps in one batch (`apply`, in an undo step when given one) or carries Kyneta's revert (`revert`), each followed by `rev` in a batch of its own; and the change's close as a value (`planClose`), carried out by `executeClose`: the texts of the text cards it removed, after their records (a client destroys its copy of a text only once it has seen both go, S64), then the cards' history and traces, the listeners, and the runs a take stops |
| `move-history.ts` | each person's history of moves per root (ADR-0066): `MoveHistories`, a shell over Kyneta's undo stacks |
| `provenance.ts` | each card's history and the traces left where someone else moved your card (ADR-0048 step 6): the port (`seen`, `sweep`, `onChanged`, `onTaken`), and the hooks a change's close reads and calls, which only `createPlaces` takes |
| `facts.ts` | `queueFact`: a fact of the host's queued as a card on its lane, in a change of the host's, then the lane's drain; a refused card is logged. The one way every module queues a fact |
| `shutdown.ts` | the order a host stops in (`planShutdown`): the agent, then the scribe, among its steps |
| `runs.ts` | a run from its start to its end (`createRuns`, `planRunEnd`), a Stop before pi starts (`cancel`), and the agent's `onStream` (`streamInto`); a run asks base news what it is told first, and its lane's stop has base news forget what was steered |
| `pinned.ts` | what a run reads of its thread's pinned cards (ADR-0048 step 5, S92): `readPinned` gathers, waits a bounded time for the sender's text (`waitFor`), and plans the cards entry |
| `canvas.ts` | what a run is told of its thread's task (ADR-0116): `readTaskContext`, the canvas list and the cards pinned to the task, each written only when it differs from the newest of its kind on the lane's path, so an unchanged task keeps the prompt's cache (S92); `runs.ts` writes them between base news and the thread's pinned cards |
| `canvas-news.ts` | a card added to a running thread's canvas or taken from it, steered into its lane as a fact line (`planCanvasFacts`), heard from `Provenance.onChanged`; never a queued fact card, which would wait for the run's end |
| `base-news.ts` | what a thread is told of its base's new work (ADR-0080): `atStart`, a chat's run's behind entry; `baseChanged`, a steer into a running lane, at most once per base commit (`told`), heard from lane work's `onBaseChanged`; `runEnded` forgets what was steered. Made after the agent, whose lanes it steers |
| `split-call.ts` | `split_offer` (ADR-0080): a split card queued on the thread, popped when its run ends: pi calls it only during a run, so its step is queued before the run's end queues the drain, which the keeper runs after it |
| `queued-card-pop.ts` | popping a lane's queued cards to send them (ADR-0048, ADR-0083): `popNextQueuedCard`, and `drain`, which carries each out as `planCarry` decides: a fact appended, a catch-up, a split's run, a message sent (ADR-0108, ADR-0080); and `createWaits`, the drain's waits for its top card's text or for someone's typing in it to stop (ADR-0048 step 7) |
| `settle.ts` | what happens between runs: drains, then the compaction and sweep as upkeep (the keeper's `later`) |
| `housekeeping.ts` | which documents a run's end compacts (`planCompaction`: its roots, the session, the places, `pinetrie:live`; § The session's documents), deleting images nothing shows (ADR-0042), retiring histories of moves (`sweepHistories`), and deleting holds on queues nobody can use (`sweepHolds`, ADR-0048 step 7) |
| `docs.ts` | `HostDocuments`: every document the host holds, a root's opened as it is asked for, `onOpened`, which replays the roots already held to a listener that joins late, and `onReleasing`, whose listeners `unload` awaits, in order, before it lets a root go; `planLoads` |
| `records.ts` | the host's writes of its records (ADR-0095): `createRecords`, whose `writeValues` writes each document's in one batch; every module that writes a record takes it |
| `migrations/` | each stored document's schema, checked before anything opens it, and the migrations from a stored hash (§ The stored schemas, ADR-0096) |
| `directory.ts` | each root's directory record, refreshed as its document changes: `startDirectory`, started with the records, and the startup rebuild of records that do not decode (`planRebuild`) |
| `cards.ts` | the card port (ADR-0048), about texts only: who wrote in a card, destroying one, loading and reading texts for the queue's pops and a run's pinned cards, waiting until a text holds a version (`whenHolds`, which an `AbortSignal` gives up), and the texts of given cards gathered for the sweeps; where the shell opens card documents |
| `seats.ts` | each connected seat's person (ADR-0037), written once as a `pinetrie.seat` record (started after `recover`), and unloading the histories of moves of a person with no seat left |
| `startup.ts` | `recover`: what a starting host does before it takes a command |
| `control.ts` | the command Line of each client seat (ADR-0007), and who its writer is: the principal its connection named, an email, so no command field can claim to be someone else (ADR-0037). The host is no writer: writers are the connected clients, and own no lanes, which belong to threads (ADR-0120) |
| `commands/` | one module per command: `chat`, `board` (a move on the board, a change to its states: ADR-0122), `mark` (ADR-0045, ADR-0116), `lane` (stop, carry on, hold or release a queue, offer: each finds its lane through `laneAt`), `cards` (a move, a reorder, unqueue all, an undo of moves, a command, a busy chat's card queued, a sent card spent, a paste, a thread's copy: ADR-0059, ADR-0066, ADR-0132); `index.ts` decodes, decides where it runs (`placeOfCommand`), clears it through the gate, and routes; every send, a `chat` command's, a popped queued card's (`sendPoppedQueuedCard`) or a spin-off's, is cleared too. `gate.ts`: `clear`, the gate's shell over `planGate` (`@pinetrie/rules`) |
| `http.ts` | the HTTP server: admission, the page (Vite or the built one), the websocket, blobs, offer reads, invites |
| `responses.ts` | every answer the host writes itself, as a pure `HttpAnswer` |
| `routes.ts` | what a request or an upgrade gets, pure: admission first (`planRequest`, `planUpgrade`), then which requests are the host's (`route`) |
| `admission.ts`, `policy.ts`, `lines.ts`, `blobs.ts`, `store.ts` | the invite key and links (ADR-0107; a blob, like the page, is admitted only from this host's own page on loopback, ADR-0042), the write policy, departed seats (a seat is fresh per page load, ADR-0037), the blob store (images, ADR-0042, and references' quotes as markdown, ADR-0126), the SQLite store, on `node:sqlite`, so with no native dependency (S22), which owns its file: it takes the file's lock, and a second connection, process or reader is refused (S47) |
| `work/` | lane containers and disks (§ Lane work: ADR-0032, ADR-0033, ADR-0034), through the project's adapter, whose kind it never names (ADR-0142) |
| `project.ts` | the project's adapter, chosen once by its kind (`projectAdapter`: an exhaustive switch, `assertNever` its default): jj's for a jj workspace, the folder's for any other folder; a folder lanes cannot serve (`projectDirWords`) is refused before any runtime is asked |
| `folder/` | a folder project's adapter, as it is built (§ A folder project's adapter): your folder's reads (`scan.ts`, `line.ts`) and watcher (`watch.ts`), the only code that touches your folder (ADR-0142) |
| `watch-dir.ts` | one directory watched with `@parcel/watcher` (FSEvents on the Mac, inotify on Linux), its events handed on after a quiet window (`quietWindow`; 0 for the shared directories, 10 s for your folder), a dropped-events error at once |
| `jj/` | jj's adapter (`startJjProject`, § jj's adapter): each lane's offer in your repo (ADR-0105), on the owner of your repo (§ Offers), and the reviews and diffs a page reads of it (ADR-0047); accepted work's record and commands (`jj/accepted.ts`); each lane's fetch into your repo (`jj/fetch.ts`); splits (`jj/split.ts`) |
| `names.ts` | every thread's name (ADR-0039, ADR-0117): `ensure` for the lanes pi holds and the threads recorded, `reserve` for a thread a column opened before its first message (ADR-0057), on one queue |
| `banners.ts` | each thread's column banner (ADR-0050, ADR-0053): made as the thread is named, at reservation or creation, set by `set_banner`; every step a late one |
| `digests.ts` | each ask's digest (ADR-0106, ADR-0075), unless the config turns them off (ADR-0071); a live digest waits for someone reading the thread (presence, ADR-0024); every step a late one, and `writePendingVerdict`, the verdict a stopping run writes before its end |
| `relays.ts` | another thread's agent asked (ADR-0128): `ask` and `leave` (the tools' hooks), `relayChat` (a person's chat that asks or invites), `relayCard` (an ask card popped), `deliver` (a relay into a thread, for these and the round) |
| `answers.ts` | what a relayed run sends back once it has ended (ADR-0128): its answer, the answers held for a busy asker, and the round, each a late step (`Answers.ended`, from `runs.onEnded`) |
| `threads-now.ts` | a thread as it is now, for the relays, the answers and the late steps: its reach, its tree, end and lane (`thread`, which opens only a live thread's root), and the names a message uses |
| `budgets.ts` | what agents talking spend (ADR-0128): the budget a run spends, read from its prompt (`promptBudget`), counted per request, written when it goes over and at a run's end, and the gate before each request |
| `later.ts` | `Later`: every write the host decides before a gap and makes after it (§ Late writes), its gate (`lateAway`), and a model request outside the keeper (`outside`) |
| `fakes.ts` | test support: `record<T>()`, `fakeLane`, `row`, `putValue` and `applyWrites` (each write to the document its target names, through the real `applyRecordWrites`), `writesOf`, `basics` (one root, `ROOT_ID`, in `fakeDocuments`), `putLane`, `writeDirectory` |

## The documents' keeper

- **Every command but your repo's is a step on one keeper**, and so is every
  drain (`@pinetrie/keeper`, `packages/keeper/TECHNICAL.md`, keyed by
  `HostKey` in `basics.ts`). Where a command runs is decided, pure, by
  `placeOfCommand` (`commands/index.ts`, ADR-0065), which reads a table
  of every kind (`COMMAND_PLACE`), so a kind with no place does not
  compile: an offer action but a
  split, and a setup or publish, go straight to the owner of your repo after
  the gate, which opens no root for these kinds, and hold no other command; a move
  on the board is up to three parts (`commands/board.ts`): its place on the
  keeper, and, when it crosses the archive's edge, its teardown
  (containers, refs through the owner, snapshots) off it, tracked, and, for
  a close, its unload on the keeper again, the reply after all of it.
  Between the place and the unload, the gate refuses any write into the
  root. A split stays one keeper step: it reads the lane and starts a run. A
  step
  gathers, plans and executes with nothing in between, so its plan is still
  true when it is carried out: with one host, this is what makes "a late
  message goes after" and "a busy lane holds" hold. A run is started inside
  a step and continues outside it, so one long run never blocks another
  thread's commands.
- **What merges by key:** a lane's drain is `once` (`drain:<lane>`), queued
  by a card's move (`queueDrain`, `index.ts`) and by a settle alike, so one
  waiting drain covers both, and keeps its place among the commands. A
  root's directory record is `once` (`root:<id>`). The compaction is
  `later` ("compact"): it starts only when no command, drain or refresh
  waits.
- **A failed step never stops the steps behind it,** and is logged
  (`[host] step failed: …`); its caller still gets the rejection. A step
  that ran over a second is logged too (`onSlow`), and so is a command or a
  drain that waited over one; upkeep's wait is not, since waiting is what
  upkeep does.
- **One seat's commands run in the order sent, by a chain, not by timing**
  (`control.ts`). Each is queued on the keeper only once the one before it
  has replied, so what that one queued is ahead of it: a queue's drain runs
  before an unqueue sent right behind it (the host suite's `cards`
  scenario). Different seats' commands go in the order they arrive. The
  chain is never awaited in the loop, and catches each step's failure, so a
  command that throws neither ends its seat's commands nor rejects unhandled
  (`packages/keeper/TECHNICAL.md`, on voiding).
- **An undo of moves holds its step until its revert is written.**
  Kyneta's `undo()` writes its note to the store and waits for it before it
  plans and applies the step, so `undo-move` awaits it inside its keeper
  step: a write to `places` between would race the step's check.
- **A failed drain is logged against its lane** (`settle.ts`), inside its
  step, and the settle still drains the other lanes, compacts and sweeps.
- **A closed keeper refuses new steps and finishes the ones it holds**, and
  `failed()` logs nothing for its `KeeperClosed`. A step refused then is lost
  without harm: a queued card stays queued for the next host, and a refresh
  or a description runs again at the next trigger.
- **`RunningHost.quiet()`** is the keeper's `idle()`, then lane work's
  `quiet()`, then `exchange.flush()`. The suites await it before they check,
  so any background promise must be a keeper step or `track`ed, or `quiet`
  resolves early and the suites turn flaky rather than failing.

## A run's start

- **A prompt's run reads its pinned cards first** (`readPinned`,
  `pinned.ts`): a chat's, a popped queued card's, a resolution's, a split's
  and a carry-on's. It
  gathers the thread's pinned cards at the lane's tip (`pinnedAt`), loads
  their texts, waits for each as the chat's sender had it (`seen`, at most
  `PINNED_WAIT_MS`, 2 s), gathers again (a card may have been pinned or
  unpinned meanwhile), and plans against what the model last read on the
  path (`pinnedInView`, `planPinnedRead`). `runs.ts` only awaits it and
  passes the entry to `handle.run`; a failure is logged and the run goes
  without cards. A resume reads nothing: its prompt and entry were written
  when it began.
- **The wait is a window in which pi's `abort` reaches nothing**: the run is
  begun (its `begin` is written, so the lane is busy and the suites count
  it running),
  but pi has no run yet. `Runs.cancel(lane)` aborts a chat's wait; the run
  then appends the chat, as a refused run does, and ends. `handleStop`
  cancels first and asks pi to abort only when nothing was cancelled. A
  land or stack start cannot be cancelled: it writes no prompt then, and
  `end()` would read the lane's previous one, and for a stack end an old
  split again. They carry no `seen`, so their window is as short as
  before. A carry-on's start cannot be cancelled either, for the same
  reason: a Stop in its window reaches nothing.

## A run's end

`planRunEnd(role)` returns the order, and `runs.ts` carries it out: a
split's `splitEnded`, then `verdictPending`, `endRun`, `laneStopped`,
`ended`. A resolution ends as any run does (ADR-0080, S104): what it left
conflicted is the offer's, and whether the agent asked is the tree's. A run touches no tools: every lane's list is the
same for every run (`packages/pi/TECHNICAL.md`, S85).

- **`endRun` comes before `laneStopped` and `ended`.** It closes the lane's
  streams (ADR-0044: a stream stays open past its message's end) and clears
  its active run. `laneStopped` is lane work's `runEnded`: the container
  stops, and the offer is refreshed; then base news forgets what it
  steered into the lane, so the next run plans from the tree alone. `ended`
  drains the lane; a drain that ran before
  `endRun` could start the next run with the last one's reply still open.
- **The verdict is pending before `endRun`** (ADR-0077, `writePendingVerdict`):
  written after, a page would see the lane stopped beside the last run's
  verdict, and draw its arrival. Its `end` is the run's last entry from its
  asks, as at `ended`.
- **A failure before `endRun` is logged as `run end failed`,** and `endRun`
  and every step after it still run.
- **`ended` is one function, set once** in `startHost`: `settle`, banners, and the verdict with the final digest. It breaks a cycle: a run's end
  drains, the drain may run an update, and an update may start a run.
  `runs.ts` imports neither the queue's pop nor the commands.
- **`ended` is given the run's prompt**, read at the start of `end()`,
  before any step. A listener uses it, never the lane's tip: `settle`'s
  drain is queued first, and pops a queued card or starts the next run
  before any step queued after it reads the lane. pi reports no prompt id,
  and the lookup gives the same answer as pi's own end tip (S71).

## The session's documents (`docs.ts`, `directory.ts`, ADR-0063)

- **`Basics.docs` is the one port for documents** (`HostDocuments`): the
  session's, `pinetrie:live`, the places, a root's by its `RootId` (opened and
  hydrated if it is not), a loaded root's `RootView`, a lane's root from its
  `LANE` record, and `unload`. A synchronous step plans from `view` and
  `docOfLane`, which answer only for a loaded root; an async one asks
  `root` or `laneDoc`.
- **A starting host opens the roots `planLoads` names**: every root in the
  directory with a thread on the canvas of a task outside the archive, or
  in an inventory (`rootsHeld`, ADR-0116), before `recover`. A busy task
  cannot be archived, so these hold every lane a crash could have
  interrupted. Which tasks are archived is the board's (`readArchived`,
  ADR-0122). Archiving `unload`s the task's roots nothing else holds
  (`work/archive.ts`); restoring opens them.
  `unload` first runs its `onReleasing` listeners: the scribe's `release`
  closes the agent's harness over the root, then the root's pi session
  (`packages/pi/TECHNICAL.md`, ADR-0092), and the root's histories of moves
  are unloaded. A harness kept would write to the closed document, and
  every later command in the root, the restored one included, would fail
  with "This document was unloaded, and is closed".
- **The host is every document's authority** (`{ authority: "self" }`), so
  Kyneta loads a root it let go again when a client asks for it (S86).
  `resolveDoc` interprets a `root:` id the directory names, as an archived
  root a client previews, and rejects any other: only the host makes roots.
- **The directory follows each root's document** (`directory.ts`): a change
  to its entries, pi's values or its records queues one refresh, the
  keeper's `once` (`root:<id>`), absorbed by one already queued, which writes
  `readRootRecord` with `setIfChanged`. It starts once the records port
  exists, since a refresh writes through it, and follows every root through
  `onOpened`: the roots `startHost` opened before it, then each opened
  later. It refreshes each as it starts to follow it, so a record stored
  before a field was added (ADR-0077) is rewritten at startup. `ROOT` is
  derived, so its shape changes with no migration: a root a thread's record
  names whose record does not decode, and which is not held, is opened,
  refreshed and let go at startup (`planRebuild`). A settle's compaction is `later`, so
  it runs after every refresh queued before it starts, and the records it
  compacts are current. A write after a compaction only lands in the next
  one's log.
- **A compaction replaces a document's stored records with what it holds
  now** (`compactAfter`), which also trims a `json` document's in-memory op
  log (ADR-0023). The places are Yjs (ADR-0066): their storage is
  compacted, and nothing in memory is trimmed (S90). A client's command
  Line is stored too but not compacted: Kyneta cannot compact a replica of
  a document another peer writes, which its pruning should do upstream
  (S25). A card's text is Yjs, which Kyneta cannot compact live (S24).
- **A command names its root and its task** (`Command.root`,
  `Command.task`, ADR-0063, ADR-0116): a chat writes in its root, and a
  chat at the root starts it, under the root and task ids the sender's tab
  minted, refused `root_id_in_use` or `task_id_in_use` when the session
  holds either already; a branch elsewhere names a task the session holds.
  The host's `TaskIndex` is `tasksNow(basics)` (`tasks.ts`), from the
  places and the threads' records, built once per command by the
  dispatcher (`commands/index.ts`), which hands it to the gate and
  every card command; a drain, a title and an offer each build their own,
  once a step. Only an undo reads it again, after its revert wrote.

## The stored schemas (`migrations/`, ADR-0096)

A document opened under a changed schema keeps a dropped field's data only
until the next compaction (S120), and the host compacts at startup. So
`startHost` checks every stored document's schema before its first `get`:

- **`deleteStored`** runs first, after the stored command Lines are
  deleted: each `StoreMigration` (`STORE_MIGRATIONS`) names, from every
  stored id, the documents nothing writes any more, and they are deleted
  from the store, after one `backup`. Each is one-time, like a
  `RecordMigration`. Registered now: `0017-stale-documents`, the Lines of
  the `pineta.control` topic from before the rename, which the deletion of
  Lines no longer matches, and `pinetrie:cards`, the cards document
  ADR-0059 replaced.
- **`readStored`** reads each document's stored schema hash through the
  `Store` (`listDocIds`, `currentMeta`). **`planStoredOpen`** compares each with the hash of the schema its
  kind opens with (`storedKind` and `SCHEMA_OF`, `policy.ts`, which `resolve`
  uses too): open as it is, run the migrations registered from a stored
  hash, or refuse to start, naming the document and both hashes. A stack
  of moves has Kyneta's own schema and is skipped; any other id no schema
  of ours opens is logged and left alone.
- **`migrate`** runs the plan on the host's Exchange: every migration's reads
  first, then, if every stored record loaded, its writes; then it compacts
  and unloads what it opened. Before a migration that moves data it copies
  a file store (`backup`, `VACUUM INTO` on the store's connection, to
  `<file>.before-<migration>`). Kyneta reports a record it could not load
  only as a `console.warn`, so `migrate` watches for that warning while it
  reads; one stops it before it writes. A read-only open leaves a stored
  hash as it was (S120), so a stopped migration leaves the store to be
  planned the same way next time.
- **One file per migration**, deleted once Duane's store has passed it; a
  store still on its hash is then refused. A change that moves no data is a
  migration with no `run`: registering it is the acknowledgement. None is
  registered now: `0001-live-row`, `0002-records` (ADR-0095),
  `0005-tasks`' places and sidebars (ADR-0116) and `0008-entry-thread`
  (every root's rows given the thread column, a context entry in the
  thread of the prompt below it, ADR-0125) ran, and were deleted.
- **A change to a record's contents moves no hash**: records are JSON in a
  document's `records`, and so does a change to the values of the places'
  rows, whose fields stay. A `RecordMigration` (`RECORD_MIGRATIONS`) is
  one-time: `migrate` runs each one's reads with the hash migrations', and
  it returns a write only when what it read is in the old shape, so a
  second start finds nothing to do. It writes under the document's current
  schema, so its hash stays. The backup is taken after the reads, before
  the first write. Each is deleted, with its mutations, once Duane's store
  has run it. Registered now: `0009-card-content` (ADR-0126): each
  place at a thread loses the `at` its row and its history events kept,
  and each fact stored on a text card's id moves to an `x-` fact card's,
  with its history; and `0014-trash-left` (ADR-0134): each place row of the
  old trash shape (`discarded`, with `holder` and `task`) is deleted, since
  it says too little to rebuild where the card was, and is at most a week
  old; and `0015-lane-history` (ADR-0150): each lane record's `work` (`{
  kind: "own" }` or null) becomes `history` (`"jj"` or null), since every
  project served before folder projects was jj; and `0016-revision-point`
  (ADR-0150): each turn record's `commit` becomes `point`, the same string,
  and the record is written whole (`snapshot`, `paths`, `conflicts`,
  `disk` and a disk's `shared`, absent in records written before each
  existed, become none), so `REVISION` decodes one shape. A migration that only
  reshapes one namespace's records, record by record, is a pure rewrite
  over `rewriteRecords` (`migrations/rewrite.ts`), which reads every
  document the namespace lives in before it writes any. `0003-workflow-archive` (the
  workflow's `closed` state renamed `archive`), `0004-threads` (each thread
  named in its first message, ADR-0117), `0005-tasks`' records (a task per
  root, ADR-0116), `0006-note-columns` (each thread's notes moved from
  its notes board's cells into a note column beside it, ADR-0116) and
  `0007-thread-origin` (each thread record's `fork` replaced by its
  `origin`, ADR-0117) ran, and were deleted.

## Blobs hold any file (`blobs.ts`, ADR-0126, ADR-0151)

- **A blob's kind is its bytes'** (`classifyUpload`): an image pi can read
  and fit, UTF-8 text with no NUL, or opaque. `POST /blob` reads any type,
  refusing only past `MAX_UPLOAD_BYTES` (`planUploadHeaders` reads the
  length alone), so the same bytes are the same kind whoever sends them.
  A reference's quote is a text blob like a shared text file. Every other
  `put` stores an image `prepareImage` made or text `storedText` made.
- **An image is kept as it came,** with its fitted copy beside it when that
  differs, in `pinetrie_blob_fits` (`original`, `shown`); `fitted` reads it,
  and `delete` forgets a deleted original's row. pi's resize returns an
  image that fits byte for byte, and a shrunk one without EXIF; a GIF too
  large becomes one PNG frame (S211).
- **Text and opaque blobs have no dimensions**: their `width` and `height`
  are null. `pinetrie_blobs`' columns are `NOT NULL` from before, so their
  rows hold 0 in each, read as none (`rowRef`); `mime` holds the kind's tag
  (an image's type, `text/markdown`, `application/octet-stream`). `size`
  reads a blob's length in the query. Every reader of images takes images
  alone (`isImageRef`): a chat's, a session's, a picture.
- **`GET /blob/` serves every blob with `nosniff` and CSP `sandbox`**
  (`blobResponse`, one entry per kind): text as `text/plain`, never drawn
  as HTML; an opaque file as an attachment, which the chip's `download`
  names (S208).
- **The sweep keeps a reference's quote** (`sweepBlobs`): every card's
  words that are a blob (`textSourceOf`) count as referenced. It keeps
  each referenced original's fitted copy too: a draft names the original,
  and its message will show the copy.
- **The sweep reads the host's clock, and so do the blobs** (ADR-0139):
  `startHost`'s `now` is `Basics.now`, and the clock of the blobs it opens
  (`openStore`'s `now`) or keeps in memory. A caller that passes its own
  `blobs` must give them the same clock: a store behind the host's stamps
  each blob as old, and the next sweep deletes it, though nothing has had
  its `BLOB_GRACE_MS`. A suite moves the clock instead of waiting out the
  grace (`suiteClock`, `clockedStore`).
- **A message's links are quoted for the model** (`linkedQuotes`,
  `withQuotes`): `sendChat` gathers each past referent its text links to
  from the root it is in, and the chat's content quotes it under the text,
  frozen as sent.
- **A message's shares are gathered with it** (`gatherShares`, ADR-0151):
  each blob its text names (`textBlobs`), its ref, size and fitted copy,
  whether an image's or an opaque file's bytes hold a location
  (`hasLocation`; a text file's words may name a place without being one),
  and a text file's text, which is quoted under the message up to
  `shares.quoteBytes` (`shareQuote`). `planShares` refuses a send that
  names a blob no longer stored.
- **`save_blob`'s hook** (`save-blob.ts`) reads the lane's path to its root
  (`ancestry` from its tip), and gives the bytes of a blob some message
  there named (`readableBlobs`, `planSaveBlob`). It never writes: the tool
  writes through its environment, so the helper counts the write as the
  agent's (S207).

## Startup

After `recover`, `sweepHistories` retires the histories of moves no one will undo again (§
Moves' history), and `sweepHolds` deletes the holds on queues whose lane no
root holds or whose root is archived (ADR-0048 step 7). Both run again after
each run's end, in `settle`'s sweep.

`recover` runs, in order: the clear of `pinetrie:live` (`planClear`: no
stream survives a process), a new store's default workflow
(`planWorkflowSeed`), the deletion of the records of a type no spec
declares, in the session and the roots opened (`planUndeclaredSweep`,
ADR-0100, so a renamed record leaves nothing behind), the deletion of
the offer, accepted-work and base records of another kind than the
project's (`planKindSweep`, ADR-0150: caches of the project as it was
before; a folder's `STATE` and `CONFLICT` records are kept whatever the
kind), a
log of the stored lane names, in the roots opened, that fail `isThreadId`
(`readStoredLanes`: no reader is given them, so the log is where one shows;
it never throws, and nothing is deleted), `ensureNames` (ADR-0039),
`planStartup` over the queued cards and `interrupted(roots)`, each
interrupted lane resumed before anything waiting for it (S36 item 18), the
project and commands records that changed in one write (`setIfChanged`),
the sweep of what no one will type in again: empty cards, card documents
with no record, and seat records no stored text names, all of them in one
write (`sweepTexts`: the cards in one change of the host's, which destroys
their texts and deletes their histories, then the documents no record
names), then traces older than 30 days and histories a crash left with no
card (`provenance.sweep`, which each run's end's settle runs too), and last
`settle` for the lanes with cards queued:
its compaction is `later`, so it runs after every write above, and after
any refresh they queued.

- **A starting host reads its config before anything opens** (ADR-0146,
  `@pinetrie/config`). `startHost` takes `places` (each layer's file and
  pine·trie's own directories; by default from the XDG variables), `env`
  and `binding`, the proof that pi's agent directory is pine·trie's
  (`bindAgentDir`, which `server.ts` calls once per process). It reads the
  start layers (system, user, local, env) once; `lanes.vm.slots` settles
  from them alone, for `findProject`. Then `openProject` (`work/setup.ts`)
  gathers, settles and acts: the working copy's `pinetrie.json`, settled for
  your repo's names alone, opens the project with them; accepted work's
  copy is then read through it (`startLaneConfigs`) and settled with the
  rest. That report is logged (`reportLines`), feeds pi's setup (`model`,
  `packages`, `skills`, `prompts`), and is published as the setup record
  (`recover`, and again whenever accepted work's config is taken). A host
  without lane work reads its folder's `pinetrie.json` as every copy
  (`folderReport`). A later acceptance that changes `model`, `skills` or
  `prompts` takes effect at the next start; grants follow accepted work as
  ever.
- **The session is opened after the project folder, before the store**
  (`server.ts`, `sessions.ts`). A refusal (`PINETRIE_SESSION` that is no
  name, names a session whose folder exists, or would replace the
  folder's own; a registry that is not one; a lock held for 5 s) prints
  `sessionWords` and exits 2, with nothing opened. Its name keys the
  local layer (`configPlaces`); `startHost` names it on the setup page
  (`served`), and with none given has no local layer, as every suite.
- **The registry is written whole, under its lock** (`sessions.ts`):
  `sessions.json.lock` holds the writer's pid, linked into place so it is
  never seen empty; the write is `sessions.json.tmp` renamed over the
  registry. A served session holds `host.pid` in its data directory,
  which only a rename reads. A host that dies leaves both; each is taken
  over once its pid names no process (`ESRCH`; `EPERM` is alive). Two
  processes taking over one dead lock at once can both hold it.
- **A session's directories are removed with `rmdir`,** never a
  recursive delete: when an attach replaces a folder's own empty session,
  a file written since it was found empty refuses the attach, and stays.
- **A starting host says what it read** (`startup-lines.ts`). `server.ts`
  logs the project, the session (found, attached and where it was, or
  new) and the store, `startHost` each config file (with
  `(none)` when missing, `(not read)` when broken) and each refusal, then
  the roots it opened, then `agent ready` with the model and where it came
  from (a file, or `$PINETRIE_MODEL`), or `no model:` and why; and
  `server.ts` the URL and invites, then, with no model, the setup page's
  URL. Every config word is `@pinetrie/interface`'s, which the setup page
  says too.
- **The project folder is found before `startHost`** (`server.ts`):
  `prepareProjectDir` (`@pinetrie/jj`) finds its root and its kind, and
  writes nothing there. pine·trie's own files for a session are in its
  data directory (`sessionFiles`, `@pinetrie/lanes`; ADR-0150): its store,
  and its lanes' runtime, ignore file, ssh files and ssh secret.
  `server.ts` computes them once, gives the store to `storeChoice` and the
  rest to `startHost` with the project (`project.files`, only with tools);
  no other module computes the layout. The ssh secret is 0600 whatever
  its directory's mode (`sshSecret`, `work/ssh.ts`): a file there that is
  no secret is removed before one is written, since writing over a file
  keeps its mode. A suite gives its own store, and each project a session
  directory of its own under the suite's data directory
  (`suiteSessionFiles`, `e2e/lane-hosts.ts`), 0755 so a nested rootless
  Docker can bind the runtime and ignore file as another user. `startHost` runs
  `prepareProjectDir` again with tools on, and hands the `ProjectDir` to
  `findProject` and to the adapter's choice (`project.ts`).
- **The lanes' ignore file is the host's** (`openProject`, `setup.ts`):
  written into `project.files`' `laneGit` after each preparing of the
  shared directories, before they are in force, for every kind of
  project; the adapter's `prepareShared` keeps them out of your repo
  alone.
- **The project is apart from tools** (`StartHostOptions.project`). Its
  `AGENTS.md` loads from it with tools off too, on any folder;
  lane work starts only with tools on. `startSetup` returns a whole `Setup`
  (project, runtime, your repo's owner, the lanes' configs, `ready`) or,
  without tools, null, and lane work is then `NO_LANES`: it records each
  lane and its name, and its `destination` (`Destination`: accepted work
  and the offers, all or none) is null. Nothing
  asks a lane's access then.
- **Commands are taken only after `recover`.** `Control.listen` is made
  earlier, and `startControl` registers `onReceive` after `recover`. Earlier,
  a new message could run before an interrupted lane resumed, and jump a
  queued card.
- **pi is made in three parts, each when what it needs exists**
  (ADR-0092, `packages/pi/TECHNICAL.md`), and every module is given values,
  never a function that returns one:
  1. the documents, then the host's records (`createRecords`, ADR-0095),
     which every module that writes a record takes
     (`Pick<Records, "writeValues">`), then the cards' texts, provenance and
     the writer of the places (`createPlaces`), which every module that
     writes a card takes (`placesWriter`), then the scribe;
  2. the project and its lanes' runtime (`findProject`, `work/runtime.ts`,
     before the store opens, so a refusal leaves nothing to close), then
     pi's setup (`loadPiSetup`), which loads from its root and reads no
     document; the title-model and banner logs follow it;
  3. the documents' keeper, the roots `planLoads` names, the directory,
     banners, digests, titles, names and the split call, each
     with the records and the setup;
  4. lane work, with them;
  5. the agent, last, with lane work's `access` and `hooks`, banners'
     `request` and digests' `step`; then base news, which steers its lanes
     and joins lane work's `onBaseChanged`, the runs, the commands and the
     drain.

  A base change announced before base news joins is lost harmlessly: it
  steers only a running lane, and no lane runs before `recover`. The
  commands and the queue's drain still refer to each other (a command asks
  for a drain, a drain sends through the commands), as closures that run
  only once both exist.

- **The runtime is Docker** (`work/runtime.ts`, ADR-0130): the lane VM's on
  the Mac and the host's own on Linux (`planRuntime`). On the Mac, a host
  whose lane VM image is missing builds it as it leases (ADR-0147,
  `packages/vm/TECHNICAL.md`), saying so first; it takes about 20 s.
  - **A host with tools that cannot run lanes does not start** (ADR-0102):
    `projectAdapter` (`project.ts`) and `findProject` return the refusal as
    a value, worded with its fix, and `startHost` throws it as
    `HostRefused`; `server.ts` prints it and exits 1. The refusals: a folder
    with no jj repo (`folderRefusal`, asked first, before any runtime), and
    the runtime's: no docker CLI or daemon, no buildx, a lanes directory not on
    btrfs with `user_subvol_rm_allowed` (Linux), and on the Mac the VM's
    (no image, no Xcode tools, not Apple silicon or older than macOS 13, a
    full VM). Without tools a host starts on any folder.
  - **On the Mac the host takes a lease** on a slot of the user's lane VM
    (`leaseVm`), starting the VM if need be. The slot is filled once setup
    knows every directory a lane mounts (`Found.ready`, before the base's
    refresh, the first lane), and never replaced while the host runs. The
    fill first removes every container with a bind into the slot
    (`sweepSlot`): a host that died holding it left them (S130).
  - **What accepted work adds while the host runs** (ADR-0141) is shared
    and granted before it is in force: `refreshBaseNow` in `setup.ts` reads
    accepted work's config (`readAccepted`), hands what lanes may then mount
    and reach to `Found.shareAndGrant`, then puts it in force
    (`takeAccepted`). The decision is a value (`planShareAndGrant`,
    `shares.ts`): the host's slot first; then a directory no slot holds as
    wanted goes in an extra slot, swept first; ports are written when they
    changed. The state it reads is `createShares`', changed only in one
    queue, a new lease's reset among its tasks. Nothing
    changed, nothing is done: in a project whose accepted work moves often
    this path runs often. A widening the VM has no slot for is said once,
    and not asked again while the same directories are what is new; a lane
    naming one fails with those words.
  - **Docker's startup sweep** (`sweepProjects`, after the fill) removes the
    containers and disks of every project whose folder is gone.
  - **The lease is kept** (`keepLease`): if the VM stops under the host, it
    leases again, sweeps its slot, drops the extra ones, and shares and
    grants the last of what it was given, as on its first lease.
    After an update, a host holding the only lease on an out-of-date VM
    replaces it (`planVmVersion`).

## Shutdown

`planShutdown` (`shutdown.ts`) returns the order, and `shutdown()` carries
it out, each step but `server` in its own `try`: `intake` (seats, control), `close` (the documents' keeper and the owner of your repo, which stops its watch), `quiet`, `agent` (every harness),
`scribe` (every pi session, so a later write is refused in any document), `work` (the containers, then, on the Mac, the lease: its slot empties, and the VM outlives the host until no lease is left for 10 minutes), `exchange`, `server`. Only a failure in `server`
rejects `shutdown()`.

- **`shutdown()` runs once.** A later call returns the first call's
  promise, so a second signal, a scenario's `finally` and `withHost` never
  close anything twice.
- **`server` stops accepting, then closes Vite (under `pnpm dev`) and every socket.**
  `httpServer.close` calls back only when every socket has ended, upgraded
  ones included, and neither `wss.close()` nor `closeAllConnections()`
  closes an upgraded socket. Vite's HMR socket kept a host with a page open
  from ever stopping (S98). So `close()` (`http.ts`) starts
  `httpServer.close`, closes Vite, terminates the exchange's sockets (one
  that reconnected after the `exchange` step was accepted again), cuts any
  request in flight, then waits. Accepting must stop before Vite closes: a
  page retries Vite's socket once a second, and once Vite's `upgrade`
  listener is gone, the `"vite"` route leaves that socket open. A host
  serving the built page has no Vite to close.
- **`host.pid` goes after `shutdown()`** (`server.ts`): the session's
  `release`, also when lanes refuse to start.
- **Only the first signal shuts down** (`server.ts`). It takes the SIGINT
  and SIGTERM listeners off, so a second Ctrl-C gets Node's default action
  and ends the process, even while `shutdown()` hangs.

- **The queues close before `quiet`.** `quiet` waits only for what is queued
  when it looks. A step started after it (an offer refresh marked by an
  observed move or a lane's fetch, a drain from a command) writes to a
  closing agent and document: its jj steps land and its record is lost
  (S73). A watch event after `close` finds the owner closed.
- **Closing the agent ends running runs.** pi's harness seals every lane, so
  a run's `run` rejects and `runs.ts`' `end` runs its steps: a refresh and a
  `settle`. The closed queues refuse them.

## Commands

- **Every command gets exactly one reply.** `handle` sends it from one place,
  after `outcomeOf`. A command that throws is logged (`[host] a <kind>
  command failed: …`) and answered `failed`, not `refused`: the host may have
  written part of it. The seat's loop goes on to its next command.
- **A command's id is its send's id.** The column that sent a chat finds its
  message by it (`TreeIndex.bySend`).
- **Every command, and every send made for one, is cleared by one gate**
  (`commands/gate.ts`'s `clear`, over `planGate`, `@pinetrie/rules`:
  ADR-0029, ADR-0124, ADR-0150). It gathers the places, the archive, the
  lane records and the project's kind, and plans: a task the command
  writes in archived (`writesIn`); then, read only when the plan asks for
  them (`read`), the roots a branch forks in, so a command the archive
  refuses opens none; then a thread someone holds or trashed, "put it on
  a canvas first"; then a run that would start on a lane of another kind
  than the project's (`ERR.FOREIGN_LANE`). The refusal is worded in rules
  (`gateRefusal`). The dispatcher clears each decoded command once and
  carries out the `Cleared<Intent>`; a popped queued card and a spin-off's
  first message are cleared as `Send`s (`send`). `sendChat` takes only a
  `Cleared<Send>`, so a send nobody cleared does not compile
  (`commands/types.test.ts`). The drain asks the hold and the lane's kind
  before it pops (`away`: held, or `LaneWork.runnable` refusing), so their
  messages wait; a fact on top is popped all the same (it starts no run),
  so a take's stop is in the thread, and its face says it was stopped.
- **A pass is not a promise.** `Cleared` proves the gate ran, not that its
  facts still hold: the dispatcher, the drain and a spin-off each clear and
  send in one keeper step, with nothing between that could change them,
  and must keep doing so. A spread of a cleared value keeps the brand, so
  a cleared send is passed on as it is, never rebuilt.
- **No run starts on a lane of another kind, whatever path asks**:
  `Runs.start` takes a `RunnableLane`, which only `proveRunnable` makes,
  through `LaneWork.runnable` (the lane's record and the adapter's kind).
  The gates word the refusal first; every path past them must prove its
  lane too: a chat and a carry-on (`startRun`, `runs.ts`), the drain's
  catch-up conflict and split, a relay's delivery (`planRelay` refuses an
  asked thread of another kind, `RelayRefusal`'s `foreign`) and its answer
  (appended, not run, to an asker of another kind), and a crash's resume
  (`planStartup` leaves it interrupted, logged).
- **A take stops the run in the step that made it**: the close of the
  change, which every write to the places is, finds the threads a person's
  change took into an inventory (`takenIn`, in `planClose`) and calls the
  dispatcher's `onTaken`, which stops each running one with `handleStop`,
  as the taker: the one stop planner, so a take's stop is a fact too. A
  host's change takes nothing. Provenance itself writes no fact. A move, an
  undo or a redo take alike.
- **A copy** (`copyThread`, `commands/cards.ts`): `planCopy` over the
  source's record and tree; the copy's `THREAD` record first, then its card,
  then its name (`names.ensure`). Its first send is a branch at its fork:
  `sendChat` refuses a branch naming a recorded thread anywhere else, and
  writes no record or card for it.
- **A thread is opened before its first send** (ADR-0126, `open-thread`
  below), so its first send writes only its entry; a branch at the root in
  a task the session holds is refused unless its thread was opened there,
  in that root: a new tab's, or a new root's made past a canvas's last
  column (ADR-0138). A branch naming a thread no column opened (a script's) is
  opened with its send (ADR-0116, ADR-0117): `planChat`'s decision names
  the thread it writes in (`thread`), and for a branch what its card needs
  (`starts`), and `sendChat`, after its last await, plans its opening
  (`planThreadOpen`): the thread's record, its card just after the thread
  it forks from on its task's canvas, and for a new task its card on the
  board (ADR-0126), at the end of the state the chat names
  (`Command.state`, a board column's ＋), else of the first open state.
  `executeChat` writes that before the message and reads nothing for it.
- **A move on the board** (`commands/board.ts`): `planBoardMove` over the
  workflow and the places; a move within open states writes the task's
  card (`placeTask`, the card commands': a move in its mover's history
  outside any task, a reorder in none, with its card's history) and
  answers `moved`; one that crosses the archive's edge gathers the task's
  roots' documents (`docs.root` loads an unloaded one, S86) and
  `planArchive`s the crossing first. A refusal is a card move's,
  `unmoved`, saying where the card is and who put it there. An undo of
  moves whose step crossed the archive's edge is refused `archived`
  (`crossesArchive`), before Kyneta reverts anything. The crossing's
  teardown (`work/archive.ts`) reports a lane whose removal fails and goes
  on: one disk left behind is waste, while a teardown stopped there would
  leave every lane after it, its history and its snapshots. **A change to the states** (`handleWorkflow`) is one
  keeper step, `planWorkflowEdit` over the workflow and the board.
- **A message sent from a card spends it** (ADR-0048): `sendChat` names the
  card's other writers as contributors, through the card port, and spends
  nothing. The dispatcher's `chat` case spends the card when the answer
  takes its text (`spendsCard`: `appended` or `started`): the record goes,
  then the text, and the reply carries the places' `rev`, its trace naming
  the message the send wrote (found by the send's id). A popped card's
  text goes as the pop's change closes, since the pop removed its record;
  one written back keeps it. The command's text is what is sent: the text
  its sender saw.
- **A chat carries its sender's pinned versions** (`pinned`, each card
  pinned at the sender's thread end with its text version): `executeChat`
  passes them to `start` for a `run` or `createAndRun`, and the run waits
  for them. A popped queued card's chat (`chatOfPoppedQueuedCard`), in
  its thread's root (its `THREAD` record's: a queued place names no root;
  `failed` with none), carries none: its thread's
  cards were edited long before.
- **A busy lane answers a chat from a card `queued`** (ADR-0059): the
  dispatcher queues the card behind the others in the same step
  (`queueBusy`), so no other send gets between. A chat with no card, or one
  whose card the host does not hold, still answers `busy`.
- **Every write to the places is one change** (`places.ts`), opened with
  its cause, which is always given: a person's move, undo, redo, spend or
  busy chat's queue, or `{ kind: "host" }` for the host's own (a pop, an
  unsent card, a fact, a split's card, a sweep). Only `places.ts` writes
  the document (`places-boundary.test.ts`), and `createPlaces` alone takes
  provenance's hooks, so no write skips its history, its texts or its
  take's stops. Each `apply` writes its records in one batch, then `rev` in
  a batch of its own. A client draws a move it sent until its copy reaches
  the `rev` the reply carried (`packages/session/card-moves.ts`), so a
  write that skipped `rev` would leave a move drawn over a record that had
  changed. `rev` stays out of the records' batch because that batch may be
  an undo step, and a value every later write changes would refuse every
  whole undo of it (S82).
- **A change records only the cards it touched**: `apply` and `revert`
  take each card, and its thread end from its loaded root, the first time
  the change touches it, synchronously, before the write; the close diffs
  those cards alone. So a change whose body awaits (the drain's, across a
  send) records nothing another change wrote meanwhile, such as a budget's
  stop fact written from pi's gate, outside any keeper step. A plan's read
  and the first `apply` have no `await` between them, so the change finds
  each card as the plan did. The body is called synchronously: a pop checks
  and removes with nothing between.
- **A change's text rule**: a text card whose last `apply` step in the
  change was a `remove` has its text destroyed at the close. A popped card
  written back (`busy`, `unsent`) keeps its text; so does a card a revert
  removes, which a redo brings back. A spend of a card the host no longer
  holds destroys the text itself, since no change removes a record.
- **A change opened while another is open is a change of its own**: each
  records the cards it touched, under its own cause, so a callee of the
  drain (a relay's ask card, a fact) writes its own change while the pop's
  waits. A function that must write into the change it is called from takes
  its `OpenChange` (`deleteRoot`, inside an undo's).
- **A change's close runs in a `finally`**: the records already say what
  happened, so their history and texts follow even when the body throws. A
  close that fails after a failed body is logged, and the body's error is
  rethrown. A caller that voids a change catches it (`budgets.ts`'s stop,
  `failed`): a voided async function that rejects ends the process
  (`packages/keeper/TECHNICAL.md`).
- **`move` and `set-command` are handoffs** (`commands/cards.ts`): gather
  the places and whether the lane runs, plan (`planMoveCommand` over
  several moves, `planSetCommand`), then write. A discard's history is the
  host's to name (ADR-0066, ADR-0116): `Discards` is the tasks now and the
  `here` the `move` carries, the task its sender is on. A move's list is accepted
  whole or refused by its first refusal (`planMoves`): a keep's cards are
  one command. An accepted move answers `moved` with its `rev`; a refusal
  answers `unmoved` with its code, where the card is now, who put it there,
  and the current `rev`. A move that leaves a card queued on a lane that is
  not running queues the lane's drain, a voided `keeper.once`
  (`drain:<lane>`) behind the move's own step.
- **Every change records its provenance as it closes** (`planClose`): the
  cards' history and the traces (`planProvenance` over the touched cards),
  in one `writeValues`. In `commands/cards.ts`, `carry` is the one path for
  a move, a busy chat's queue, a spend and a command set on a card (which
  changes no place, so records nothing), each with its cause. `undoMove`
  carries Kyneta's revert through `revert`, in one change with the threads
  it lifts (`deleteRoot`). A spin-off's thread card and its card's move to
  the trash are one change, its sender's. A thread's card placed by its
  first send (`executeChat`) is its sender's change, so `canvas-news.ts`
  tells the task's running threads, as for an opened or copied thread. The
  drain makes each pop one change of the host's (`queued-card-pop.ts`), with
  `popNextQueuedCard` still synchronous (S69). The presence the close reads
  is `readReading`'s pairs: a placer with a column open at the card's end
  saw it go.
- **`picture` sets the sender's picture** (`commands/picture.ts`,
  ADR-0098): `planPicture` over the blob's reference, read without its
  bytes. A picture wider or taller than `PICTURE_MOST` is fitted by
  `fitImage` (`prepareImage` with a 512 box, `@pinetrie/pi`), kept as a
  blob of its own, and that copy is set; the original is left to the sweep,
  which keeps only pictures that are set (`readReferencedBlobs`). The fit
  runs inside the command's keeper step: an upload is already fitted to
  2000×2000, so it takes milliseconds, and the browser's 256 picture is
  never fitted at all.
- **`traces-seen` deletes the sender's own traces**, ignoring any other
  id, and answers `seen`. A client sends it for the traces a column drew.
- **`undo-move` undoes or redoes the sender's newest move in a task, or,
  naming none, in their history outside any task** (§ Moves' history). It answers `undone` with each card it moved and its
  place now, `unmoved` (shaped as a refused move) when someone moved a card
  since, or `nothing`. An undo first reads the cards its step moves
  (`MoveHistories.top`, S139): one a thread's record says it was spun from
  lifts that thread back (`planLiftRoot`) only while it holds its first
  message alone, with
  no lane and no other card; else it answers `unmoved` `replied`, naming
  who wrote second, and reverts nothing. A lift deletes the thread after
  the revert (`deleteRoot`, `planRootDelete`): its directory record, its
  thread's, its task's record, board place and title, any card in it or on
  the task's canvas, its document (`HostDocuments.destroy`, which tells
  every peer), and the task's stacks, unloaded for the startup sweep to
  retire. A redo after a lift moves the card back to the trash, its thread
  deleted: a discard.
- **`spin-off` makes a text card a thread** (ADR-0111, ADR-0126,
  `spinOff`), in one keeper step: the card's text loaded whole,
  `planSpinOff` (refused for a blank card, a root or thread id in use, or
  as `planMove` refuses the move), then the thread's records (its own,
  spun from the card, and its new task's), a chat at the root of the new
  root its tab minted (`sendChat`, cleared as every send is, never asking
  the agent, the card's writers its contributors), then, once the chat took the card's text, the
  thread's card on its task's canvas and the card's move to its sender's
  trash, in the history of the task it leaves, or from an inventory the
  new task's; a chat that took nothing deletes the records again. The
  answer is the chat's: `appended`, with the first message's id.
- **`open-thread` opens a thread before its first entry** (ADR-0126,
  `openThread`), in one keeper step: a branch's root's tree loaded (a new
  root has none: a new tab's, or one in a task the session holds, ADR-0138),
  `planOpenThread`, then its record, its card and the canvas re-ranked for
  it (and a new tab's task's card on the board), then its name
  (`names.ensure`). No entry is written. A move that takes a new tab's only
  thread to a trash before its first send sends its emptied task's card
  to the closer's trash in the same step (`emptiedTasks`,
  `planTasksTrashed`), in their history outside any task, so the undo key
  on no task brings both back.
- **A person's documents are clients' documents the host only keeps**
  (ADR-0059, ADR-0077, ADR-0122): their inventory, their attention and
  their list. `resolveDoc` names a `<kind>:<writer>` id's kind, and the host
  interprets it as `InventoryDoc`, `AttentionDoc` or `OpenDoc`; the policy shares it only with the
  peers whose principal is that writer (`holdsPersonDoc`), and who may
  write it is the protocol's (`writersPolicy`, below). Kyneta fires
  `resolve` only for a peer `canShare` grants (S76), so nobody else can
  create someone's document. The host never writes one: it decides only
  whose inventory a card is in, and refuses a nineteenth card without
  knowing the slots.
- **Who may write a document is declared once, on every peer**
  (`writersPolicy`, `@pinetrie/protocol/writers`, Kyneta's `canWrite`): the
  session and the places only the host; a person's document its person,
  and the host, which relays it between that person's tabs (Kyneta judges the
  sender, not the author). The host registers it beside `hostPolicy`, and
  `connectSession` (`@pinetrie/session`) on every client, so a client's write to a document it
  may not write throws before it is made, rather than forking its copy
  (S28, S76). `hostPolicy` keeps what is the host's alone: which peers may
  hold a document, and which writes it takes from presence and cards. A
  card's text is created by a client, and accepted from anyone; without
  `resolve` creating the documents clients make, one the host never opened
  itself would be neither stored nor relayed (S58).

## Moves' history (`move-history.ts`, ADR-0066)

- **One Kyneta undo stack per person and task**, `moves:<writer>:<TaskId>`
  (ADR-0116), and one per person outside any task, `moves:<writer>`
  (ADR-0126): a `MoveHistoryScope`. Key `moves`, scope the places document, made on first use
  and kept in the store. Kyneta undoes only its own runtime's writes, and
  only the host writes `places`, so the stacks are the host's: `policy.ts`
  shares them with no one and rejects one a client announces, and
  `writersPolicy` gives them to the host alone.
- **Which history a move enters is the host's** (`historyOf`): the task the
  card goes to, else the one it leaves, read from its record; a discard's,
  the task it leaves, else, from an inventory, the task its sender is on
  (`here`), else, on none, its sender's history outside any task; a
  creation or a removal enters none. `move` writes inside that
  stack's `gesture`. The host's own writes (a queued card's pop, a spend,
  an unsent card, a thread's card as it opens, the sweep) are outside every
  gesture, so every stack rebases over them, and an undo of a move the
  host overtook is refused.
- **Every undo is `whole`.** Without it a step someone else's move broke is
  skipped and an older one undone out of sight (S82). With it, a card's row
  (its place and its placer) changed by anyone since refuses the undo.
- **`rev` is raised after an undo too** (`OpenChange.revert`), apart from
  the revert, which Kyneta writes itself, and only when one of the cards it
  reverts changed.
- **Retired 7 days after their task is archived** (`planHistorySweep`,
  `ARCHIVED_HISTORY_MS`), at startup and after each run's end; and at
  startup only, those of a task the session does not hold (a new tab's,
  deleted as it closed unsent). A person's history outside any task is
  never retired. The stored ids come from the store's listing by `moves:`;
  `retire` destroys a stack loaded or not (S91).
- **Unloaded when nobody can use them:** a person's when their last seat
  leaves (the seats step, `idleWriters`), a task's when it is archived
  (`unloadTask`). The next move loads one again (S91).
- **Shutdown disposes them, then flushes,** so a stack's open step is
  stored before the Exchange stops.

## The queue (`queued-card-pop.ts`, ADR-0048, ADR-0108)

- **Popping the next queued card is one synchronous step** (`popNextQueuedCard`): read that the card is
  queued and on top, read its text, remove its record (raising `rev`). A
  move and a drain are steps on one keeper, so an unqueue lands before the
  pop or after it, never between: before, the card is not popped; after, the
  unqueue is refused `gone`, and its client says "already sent" (S69).
- **`drain` loads each queued card's text before the pop** (`hydrate`),
  and checks again after every wait, so a card queued while texts load is
  loaded too. `textNow` then reads a text with no wait.
- **The pop waits for the text its queuer had** (S96). Kyneta keeps no
  order between documents, so a card's record can arrive before its text.
  The record carries the text's version (`seen`); a top card the host's
  copy does not yet hold is `behind`, and stays on top, and the host drains
  the lane again once it holds it (`createWaits`, below). A
  wait whose card leaves the queue, popped, unqueued or discarded, is given
  up (`givenUp`), so it neither stays subscribed nor drains; the places are
  watched only while a wait is out.
- **What a popped card comes to is decided first** (`planCarry`,
  ADR-0080), then carried out (`carryOut`): a fact is appended to the
  thread; a catch-up runs `prepareUpdate`, then sends the text; a split
  starts the split's own run, its text the brief; a message is sent; a card
  with no text and no command is discarded. A queued reference's quote is
  read from its blob before the pop (`queuedQuotes`) and sent as a
  message; one whose blob is missing is skipped, logged, and the drain goes
  on (ADR-0126). A catch-up's `prepareUpdate`:
  clean, the update is written, then the text, if any, is sent;
  conflicted, the resolution run carries the text; nothing new, the text
  alone; refused, the card goes back. The text is sent through
  `sendPoppedQueuedCard` in mode `queue`, cleared by the gate, as its queuer (`by`), with the card's other
  writers as contributors. A card with no text starts no run.
- **A card the host could not send goes back below the line, whole**
  (`planUnsent`): a note in the note column nearest its thread, made in the
  same step when its task has none (ADR-0116), saying why, and never queued
  again, or the next drain would fail the same way (S69, answer 5). With
  nowhere to go (a thread in a full inventory, or one with no card) it
  stays queued, saying why, and the host holds the queue first
  (`planQueueHold`), so the drain stops at it. Its text
  is kept. After a clean update its command is cleared: it was carried out.
  An update or a send that throws writes the card back the same way, saying
  the host failed: the pop has deleted its record, so nothing else would.
- **Five things drain a lane:** a run's end (`settle`), startup
  (`recover`), a move that leaves a card queued on it while it is not
  running (a lane is never written while it runs, S21), (`queueDrain` in `index.ts`), a release of its queue, and the end
  of a wait for its top card (below). All are the keeper's `once`
  (`drain:<lane>`): queued once until its step starts, the same step for
  all; a move while it runs queues one more, which finds what the running
  one missed, or nothing.
- **A held queue pops no message card** (ADR-0048 step 7): the drain reads
  the hold (`readQueueHolds`) and who is typing in which card
  (`readTypingIn`, presence) in the synchronous span of the pop. `held`
  ends the drain; a release drains again. A fact on top is popped anyway.
  Startup drains every lane with queued cards, and a held one stops at
  `held`. Presence is empty when a host starts, so a card someone was
  typing in as it restarted can be popped: ADR-0048 accepts that.
- **The drain waits for its top card** (`createWaits`, one wait per card):
  for its text as its queuer had it (`behind`, S96), or for the typing in it
  to stop (`typing`, `untilNotTyped`, which watches presence; a decay
  reaches the host's subscribers, S28), or, when every card queued is a
  blank message, for the first to be written in (`blank`, `whenWritten`).
  A blank message (`blankQueued`: no command, only whitespace) is passed
  over and stays queued (ADR-0113), and does not wait: a command that reads
  lanes for who waits (a chat, a queue, a stop, a carry-on, a move to the
  archive) gathers the blank cards first (`CardPort.blankQueued`,
  which loads each queued card's text). One whose text is behind is not blank,
  or the cards behind it would go first. A wait is given up when its card
  leaves the queue (`givenUp`), and its end drains the lane again. `runs.start` marks a lane
  running at once (a `begin`), so a drain behind a started run pops
  nothing.
- **`executeChat` still checks where a new lane begins and asks pi for the
  lane.** Both are ports that may refuse, not facts to gather. The begin is
  checked first (`checkBegin`), so a refused send creates no lane.
- **The new lane's id is its thread's** (ADR-0117): `planChat` names it from
  where the send goes, and neither the host nor pi makes one. A thread's
  first message is preceded by its `THREAD` record, written in
  `executeChat`.
- **`reserve` is answered `reserved`** whether it named the id or the id
  had a name already, so a column may send it again; an id pi holds is
  refused `lane_id_in_use`.
- **Stop queues who pressed it before it aborts** (ADR-0106, ADR-0126):
  `planStop` (`@pinetrie/rules`) gives the fact card naming the running
  ask's stopper, unless one is queued or appended already, and
  `handleStop` writes it (with its history, a host write), then asks pi to
  abort, in one step. So the fact is queued when the run ends, and the
  first press is the one named. With a message card queued it holds the
  queue first (`holdOnStop`, ADR-0048 step 7); the run's end, a drain on
  the same keeper, appends the stop's fact, which goes before the cards,
  and pops nothing else. The run's verdict names the stopper from the
  queued fact (`endedOutcome`).
- **`queue-hold` holds or releases a thread's queue** (`handleQueueHold`,
  `planQueueHold`): it answers how the queue is now, `held` or `released`,
  whether it wrote or the queue was already so. A release asks for the lane's drain: nothing else
  would pop what waited.
- **`queue-card` queues a card and changes its queue's hold in one step**
  (`queueCard`, `planQueueCard`, ADR-0113): the hold is written first, then
  the move carried as `move` carries one, so its drain finds the queue held
  or released as planned. The move is in the sender's history; the hold is
  not, so an undo takes the card back and leaves the hold. One with no
  `from` makes the card in the queue with its command (`targetId` on the
  wire), in no history, as any creation.
- **Trashed cards are swept** (`sweepTrash`, `housekeeping.ts`): a card past
  its `trashDeadline`, and every card on a surface it owns, loses its
  record, then its text and its history, in one change of the host's, at
  startup and in `settle`'s sweep. A deleted thread's lanes of
  their own go as an archive's do (`planLanesGone`, through
  `work.teardown`, off the documents' keeper), which withdraws their
  offers; the thread's record stays, since its entries name it.
- **`reorder` and `unqueue-all` are moves of their own** (`commands/cards.ts`).
  A reorder is written in the sender's history of its place's root
  (`planReorder`), through `carry`, and drains nothing. Unqueue all plans
  its moves from the queue as it is (`planUnqueueAll`) and hands them to
  `move`, so it is one step one undo reverses; with nothing queued it
  answers `nothing`.
- **A command on an offer leaves a fact** (ADR-0080): `actOnOffer`
  answers first, then writes the action's fact as a queued fact card in a late
  step of its own (`Later.step`, through `queueFact`), with its history
  (cause `host`, as for every fact and the split card `split_offer`
  queues), and asks for the lane's drain. An idle
  lane appends it at once; a running one when its run ends, in order with
  the cards already queued. The client draws it as a quiet row, and nobody
  moves it.
- **A chat on a thread with no work of its own is caught up first**
  (ADR-0080): `planChat`'s `catch-up-first` runs `prepareUpdate` with a run
  to follow (`follows: "run"`), then sends the chat with `caughtUp`, so it
  does not loop (`catchUpFirst`, `commands/chat.ts`).
- **Resume is `carry-on`** (ADR-0082): `handleCarryOn` starts a run whose
  prompt is `planCarryOn`'s carry-on message, or answers its refusal. It is
  one step on the documents' keeper, as a split is, so a second press finds
  the lane busy and is refused.

## Late writes (`later.ts`)

An archived task is read-only, and a command is refused there by the gate
(`planGate`). The host's own writes that it decides before a gap and makes
after it are refused by `Later`'s: a model request's answer, a step a run's
end queues, an offer action's fact, a budget a round's request spent. A
root record written through `Records` after an archive let its root go
opened it again for good, and one written after `docs.destroy` made the
document again (S198); a fact queued in an archived task left it holding
queued cards, which `planArchive` refuses.

- **`Later.step(scope, what, plan)` is the one way to write late.** Its
  step gathers the places and the archive, asks `lateAway` of the thread or
  the task (a title's) it writes into, and on a refusal logs `[host]
  <thread>: <what> not written: <why>` (`awayWords`) and stops. Else
  `plan` reads the documents as they are now and returns a `LateWrite`,
  which `Later` carries out: its records (`Records`), then each fact,
  gated again on its own lane and queued by `queueFact` (`facts.ts`), each
  a host change of its own with its history and its lane's drain, then
  `after`, a write whose own rule gates it in the same step (a relay,
  behind `unreachableRefusal`; an answer's delivery, behind `planAnswer`'s
  reach). Not `then`: a plan is async, and a value with a `then` method is
  awaited as a promise.
- **A late step is queued synchronously**: `step` calls `keeper.run` before
  anything is awaited, so a caller that orders its step ahead of another's
  by queueing first keeps that order (`answers.ended`'s held answers ahead
  of the run's end's drain).
- **A plan never reads through `docs.root` or a handle from before the
  gap.** It reads `docs.view` or `docOfLane`, or `threadsNow`'s `thread`,
  which opens a root only for a live thread. A thread `lateAway` lets
  through is live, and a live thread's root is held once it is started
  (S199), so a late step opens no archived root and makes no destroyed one
  again.
- **`Later.outside`** asks a model outside the keeper, tracked so `quiet`
  waits for it, then plans its answer as a `step`; a null answer writes
  nothing. With `held`, a key is in a set while the request is out, for the
  caller's plan to read (`bannerDue`, `planDigest`'s `inFlight`). A failure
  goes to `failed`, never to the caller.
- **The modules whose work is late hold no write port and no keeper**:
  `digests.ts`, `titles.ts`, `banners.ts` and `answers.ts` take `Later`,
  and no `Records`, places writer or keeper, so every step they take is a
  late one. `answers.ts` keeps pi's ports for an answer's delivery, which
  it makes only in an `after`; that much is held by its tests. `budgets.ts`
  keeps its keeper, `Records` and places writer for what is exempt below,
  and its `budget-spent` fact is a `Later.step`.
- **Exempt, each with its reason** (the list is closed):
  - commands, and the sends made for one: `planGate`, through `clear`;
  - the archive's own steps (`commands/board.ts`): they write about the
    archived task on purpose, its pending verdicts among them (below);
  - upkeep: the directory's refresh and rebuild, the sweeps
    (`housekeeping.ts`, the trash, holds, histories, provenance), names,
    seats, the compaction, startup;
  - what happens inside a running lane, whose task cannot be archived
    (`planArchive` refuses `running`): `budgets`' `stopNow` in pi's gate,
    `split-call.ts`, `canvas-news.ts`, `base-news.ts`,
    `writePendingVerdict`, `runs.ts`;
  - a budget's own record (`BUDGET`), written when it goes over whatever
    became of its thread, so a restored task's agents cannot spend it
    again;
  - the drain: a popped card's send is cleared by `planGate` (`writesIn`'s
    `queue` case), its `away` is `holdingOf`, and no fact is queued in an
    archived task;
  - `relays.ts`' `ask`, `leave`, `relayChat`, `relayCard` and `deliver`:
    each reads both threads' reach and refuses with `unreachableRefusal`
    in the step that writes;
  - an offer's description (`describe.ts`, for either kind of project):
    each adapter's settle writes only while its offer is the one asked
    about (`planDescribeSettle`, or a folder offer's start and tip), and an
    archive's teardown withdraws its threads' offers;
  - a turn's tail (`work/turns.ts`): its revision, fetch and snapshot after
    a run ends. Dropping it would lose a revision a restore needs; whether
    an archive must wait for it (`pendingRecords`, as a fork does) is not
    decided.

  Every places write, exempt or not, goes through `Places.change`.
- **An archive settles what it cuts off.** A run's end the gate refuses
  would leave its verdict `pending` in the archive for good, so the
  archive's record step writes `unclassified` over each pending verdict of
  the task's threads (`planArchive`'s `verdicts`, `unclassifiedPending`),
  as a starting host does.

## Digests and verdicts (`digests.ts`, ADR-0106, ADR-0077)

- **Always made.** The config's `digests` (`enabled`) turns off live
  digests and the final digest; a run's end still asks for its verdict.
- **A run's end is one request** (`planRunEnded`): a failed or stopped run's
  verdict is written from its facts and only a due digest is asked for; an
  answered run asks for its verdict, with the final digest when
  `planDigest` gives one, and for a short ask the verdict alone. The
  request's last line says which (`VERDICT_ALONE`, `VERDICT_THEN_DIGEST`),
  and the scripted model answers it (`packages/pi/scripted.ts`).
- **One settle, one write** (`runEndedToWrite`): the verdict and the digest
  together. A failed request still settles, so a verdict asked for is
  `unclassified`, never left pending; a reply for a run whose stored
  verdict the next run's end has replaced writes no verdict. A failed
  request writes no digest, as before.
- **The lane keys the verdict and nothing else.** `ended` takes it from
  `runs.onEnded`, and reads the run's last entry from its asks: the lane's
  tip may already be past the run (below). It is also the scope of every
  late step `digests.ts` takes, a live digest's (`step(lane, at)`) and a
  run's end's, so none lands in a thread archived meanwhile.
- **A starting host** writes `unclassified` over each verdict still pending
  (`planStartup`), unless its lane is resumed.
- **Asked on events, each naming an entry**: the tip the lane's `turnDone`
  hook is given (wrapped in `startHost` after lane work records the turn),
  and the prompt each run's end is given. The ask is `promptOf` that entry,
  which never changes: entries are written once (ADR-0004). No step reads
  a lane's tip. At a run's end the tip is already past the ask: a plain
  queued card popped there would lose the ask its final digest, and a next
  run with work would take it, which then refuses that run every later
  digest.
- **`planDigest` decides** in one step, from the stored digest, the request
  out, and presence: the host holds the presence document, and `readsAsk`
  reads its `reading` ends (S70).
- **Only the ask goes out**: its message, worded from its prompt entry so a
  land or stack ask is named too, its run's messages read up from the run's
  last entry, newest first within the budget, its last word, and the last
  digest. No agent reads the answer.
- **The reply is read in `request`, as a title's is** (`titles.ts`):
  `endReplyOf` there, and each refused half logged ("the model's digest is
  not one", "the model's verdict is not one"). The answer's `plan` gets
  the parsed reply, never raw model text. A live digest writes what `digestToWrite`
  returns; a run's end, what `runEndedToWrite` returns.
- A missing `ask-digest` skill is logged, and settles as a failed request.

## Agents talking (`relays.ts`, `answers.ts`, `budgets.ts`, ADR-0128)

- **A relay is a run in the asked thread.** `deliver` gathers both
  threads as they are now, plans with `planRelay` and `planDelivery`, and
  starts the run with the heard entry first (`RunStart.heard`), or makes an
  ask card on a busy lane and asks for its drain. Every step is one keeper
  step; the `ask` hook's too, as `split-call.ts` is.
- **Whose agents a send may name is every open task's named threads**
  (`readReachableAgents`, over `reachableAgents`), wherever it is sent, so
  a branch's first message, whose thread has no card yet, names them too.
- **Reach is read before any root is opened.** Each step gathers both
  threads' `threadReach` from the session and the places, and refuses one
  out of reach (`unreachableRefusal`) before `threadNow`, which opens a
  root only for a live thread (`threads-now.ts`): an archived task's root
  stays let go.
  `planRelay` and `planAnswer` take the reaches too, so an ask card whose
  asker was archived since is refused, and an answer for it becomes an
  `undelivered` fact in the answering thread.
- **A person's chat is relayed after it is written** (`relayChat`, queued
  by `sendChat`, not awaited inside its step): it finds the chat by its
  send's id, sets its budget, and relays each member it asks.
- **The run's end sends the answer** (`answers.ts`' `ended`, from
  `runs.onEnded`, before the settle), each a late step on the answering
  thread: the answer runs an idle asker it wakes, is steered into a
  running one, and is appended otherwise; one that wakes nobody waits, in
  memory, for the asker's run to end, so its agent does not take it as
  something to answer. At that end it is appended if the asker is still
  in reach, and is the answering thread's `undelivered` fact if not. A
  restart drops what waited.
- **The round is a late write too**: gathered first (an asker out of reach
  asks nothing), asked outside the keeper (`Later.outside`), and its
  answer, a round fact or a relay (`Relays.deliver`, in an `after`),
  planned when it comes, behind the asking thread's gate.
- **A thread with no lane** is told its facts at its end through the
  scribe (`appendLaneless`, the drain's), since only a lane appends; a
  person's message to one is written through the scribe too (S21).
- **The budget is read from the run's prompt** (`promptBudget`): a
  relay's or an answer's names it, a person's message is its own, and only
  a run an agent started spends. Its count is kept in memory and written
  when it crosses the limit (with a `budget-spent` fact in the thread that
  set it) and at a run's end. A request spends what it adds
  (`addedTokens`), measured against the run's last request, kept in
  memory by its prompt until the run ends, so a run resumed after a
  restart counts only its first request's output. `mayRequest`, pi's gate, queues the stop's
  fact itself, synchronously, while the lane still runs, so the run's end
  appends it.
- **Stop reaches the runs a thread asked for** (`handleStop`): every
  running lane whose prompt is a relay from the stopped thread is stopped
  by the same person.

## Banners (`banners.ts`, ADR-0050, ADR-0053, ADR-0143)

- **Banners are made under every icon source.** `createBanners` takes
  `draws`, whether the config's `icons.source` is `drawn`, and passes
  it to both decisions: `bannerDue` draws nothing unless it draws, and
  `planAsk` sets a pasted image under any source but refuses a new drawing
  (`off`) unless it draws. The module holds no condition of its own, and
  `set_banner` is the agent's in every run.
- **The source is published at start**: `recover` writes the one
  `pinetrie.icons` value beside `pinetrie.commands`, only when it changed,
  before commands are taken, so the page never decides a thread's icon on a
  stale source. The page shows a built-in icon only under `built-in`.
- **A decision is one late step** (`Later.step`): gather the lane's
  banner, whether one is being made and whether a blob is stored;
  `bannerDue` or `planAsk`; write a pasted image. A new image is asked
  outside the queue (`Later.outside`), then planned in a step of its own,
  only while `bannerStillWanted`. A thread its gate refuses gets none
  (`set_banner` answers `no_thread`). A thread named for a column before
  its first message is opened in no task, and takes one. A missing
  `column-banner` skill is logged.
- **A thread is due one as it is named for its lane** (`createNames`'
  `onNamed`): as a column about to create its lane asks for its name
  (ADR-0057), or as a lane is created. A conversation's thread is named and
  draws none. It is due again at each run's end, which draws only when it still has none: the
  retry for a failed one. `recover` does not: choosing `drawn` must not
  draw one for every thread that ever ran. Banners are made before
  `createNames`, whose `onNamed` asks them.
- **Only the name goes out**: the prompt is the `column-banner` skill's
  body, filled from the thread's name (`bannerPrompt`). No text model is
  asked, and no message leaves for the image model.
- **A drawn image arrives fitted** (`PiSetup.drawBanner`), as an upload is,
  so the host stores it as given. `drawWithRetries` asks up to three times.
- **A failure is logged, never thrown**: `[host] no banner for <name>: …`,
  one line per failed attempt.

## Titles (`titles.ts`, ADR-0074)

- **Planned inside the command that asks**: `executeChat`'s `createAndRun`
  calls `laneStarted` after `prepareLane`, so the new lane's record is
  among the root's, and a `retitle` command calls `asked`. Both are steps
  on the documents' keeper already, so `titles.ts` gathers and plans
  (`planTitling`) without a step of its own, and only the request goes out.
- **The prompt is given, not read**: the run writes it after `executeChat`
  returns, so `laneStarted` takes its author and text from the chat's
  details. The title is settled as the task's mark (ADR-0116), keyed by
  the task, so nothing waits for the root's first entry.
- **The answer is planned again**: it is a late write on the task, so an
  archived task takes nothing, and an unasked title gives way to any mark
  written meanwhile (`titleStillWanted`). `planMark` writes it, so an unchanged title writes
  nothing.
- **Only an unasked request is `held`**: a person's Auto-update goes out
  even while an unasked one is out for the same task.
- A missing `tab-title` skill, or a reply `titleOf` refuses, is logged, and
  nothing is written.

## HTTP

- **Admission comes first**, for a request and for an upgrade. Nothing
  reaches the page, the blobs, an offer's reads or the Exchange without it.
- **The built page is sent by `planPageRequest`** (`routes.ts`), over the
  set of files `dist/` held at start: `/` is `index.html`, `no-cache`, so a
  rebuild is seen at the next load; `assets/` files, named by their hash,
  are `immutable`; nothing falls back to `index.html` (the page routes by
  its URL's hash), and only a name in the set is read, so no path leaves
  `dist/`. The stamp, which names this machine's paths, is not in the set.
  There is no HMR: an upgrade but `/ws` is refused (`planUpgrade`).
- **Under `pnpm dev`, Vite's HMR socket shares the host's port, behind admission.** Vite's
  listener sits on `viteUpgrades`, a server that never binds, and `http.ts`
  passes it each admitted upgrade that is not `/ws`. `hmr: false` does not
  stop `/@vite/client` from connecting, and without `hmr.server` Vite
  listens on port 24678. Behind a tunnel that socket hangs, and Firefox,
  which opens one WebSocket to a host at a time, held `/ws` behind it (S112).
  Vite's own host check is off (`allowedHosts: true`): admission decides.
- **Every answer the host writes itself is a `responses.ts` value**, written
  by one `send`. A blob, a review and a diff are cached for a year
  (`IMMUTABLE`: each is named by what it holds); a refusal is never stored.

## Lane work (`work/`)

`work/index.ts` builds each piece in order, with the project's adapter
(`adapter.ts`), and returns `LaneWork`. No file under `work/`, tests
included, imports `@pinetrie/jj` or `../jj/` (`work/boundary.test.ts`):
accepted work is reached through `Destination` (`destination.ts`), and a
lane's history through `LaneHistory` (`@pinetrie/lanes`), both the
adapter's.

| module | owns |
|---|---|
| `adapter.ts` | `ProjectAdapter`, which carries its `kind`: opened by setup where it reads your repo's names, with the runtime, a folder project's `FolderDisks`, the session's lane files and the records, before anything else reads the project (`OpenProject`: `kind`, `fileAt`, `prepareShared`, `identity`, `acceptedNow`, whose checkout is bound to its read, or none for a folder), then started once lane work has its registry, with `ready` (asked, never held: a read waits on it for lanehost) and `keepStates` (`StartedProject`: the `Destination`, each lane's `history` from its record, refused for a lane of another kind, and `Splits`). The registry and the containers it is started with are bound late: neither is asked for before startup ends |
| `destination.ts` | `Destination`: accepted work and offers as any kind has them: a file at a point (`fileAt`), where a new lane begins (`begin`), what a catch-up's base is now (`baseNow`), an archive's lanes moved (`lanesMoved`), the offers' acts (`OfferActs`), setup and publish (`AcceptedActs`), `quiet` and `close` |
| `setup.ts` | `openProject`: the project opened through its adapter, with your repo's names settled from your files and the working copy's `pinetrie.json`, before anything else reads it, and its lane configs, before pi's setup. `Setup`, all of it or none: the opened project, the lanes' ssh, the shared directories, the default-image check (the default image carries a browser, ADR-0041, and python3, ADR-0064), the images and runtime (`ready`), `specOf`, the granted host paths (planned at its start, from the roots of the commands pi's setup loaded, none inside the project and none holding pine·trie's own directories, ADR-0036), and the base snapshot's refreshes |
| `config.ts` | `pinetrie.json` as a fact of a state (ADR-0135, ADR-0146): accepted work's copy read at accepted work (`Destination.fileAt`) at startup and when the base moves (`readAccepted`), decoded by the host's table and settled with the start layers, its shared directories (the settled `lanes.shared`) prepared again, and put in force (`takeAccepted`, `onTaken`) once what it names is shared; a lane's own copy and the copy it started on, read at its tip and its start before its container starts (`readLane`), so `specOf` and the prompt's facts use the lane's config; the note on a write of the file (`configNote`, the `configWritten` hook): what it changes, and each key not taken. A lane with no commit in your repo yet runs with accepted work's |
| `shared.ts` | the shared files' lineages (`pinetrie.shared`, ADR-0135), one recorder for every lane and the watcher, so none reads and writes a lineage at once: a turn's accesses of shared files (`classifyWritesOnQueue` hands them over), based on what the lane last read, numbered and flagged (`planSharedLineages`) after the turn's queued step, since the lineages are every lane's; the watcher's stamps (`seen`). An earlier turn found concurrent after its rival is learnt has its revision record rewritten; one whose record is not written yet keeps what it says |
| `shared-watch.ts` | your writes to the shared directories as they are made (S169): each directory of accepted work's watched (`watch-dir.ts`, with no quiet window), each file an event names stat'ed into the stamp a lane would read, and handed to `shared.ts`. A scan at each start, and after a dropped-events error, finds what changed unseen. It follows accepted work's list (`LaneConfigs.onShared`). Lanes' writes come by here too, and are claimed when their turns are recorded |
| `registry.ts` | `LaneRegistry`: each lane's handle, its record, whether it is a lane of its own; the only module that touches the handles; `withHistory`, the one way to a lane's `LaneHistory`, which queues its function on the lane's queue with the history, the handle and the lane's record; refused, with nothing queued, for a lane with no record, no copy of its own, or a history the adapter does not keep |
| `containers.ts` | `access`, a container's start (`planContainer`, `planStartFrom`; after a restore from a snapshot, the history's `afterRestore`, for jj `pre-rename:`, since a snapshot made before the rename holds the old names (S114); run from a queued step, which hands it the history; every start loses stale outputs, `removeStaleOutputs`), `beforeRun`, `runEnded` |
| `turns.ts` | pi's `turnDone`: the turn's revision (`recordTurn`), its classes and snapshot (`disk.ts`), its whole-disk diff, and what follows its commit (`follow`, for jj its fetch), fired once the snapshot step is queued (`queueTurnEnd`); the turn records still being written (`pendingRecords`). A revision is titled by its message's first line, else its first call in a person's words (`titleOf`, `callLabel` from `@pinetrie/interface`, ADR-0114: `shell pnpm test`, not `bash …`). A lane is fetched into your repo only after a turn that commits, so a lane that never changed a file has no `tip@pinetrie-<lane>`, no refresh and no `pinetrie.base` until it catches up (a clean merge is fetched) |
| `create.ts` | a new lane: `checkBegin`, its record and name (`recordLane`, its `history` the kind of the disk it will clone, `sourceHistory`), its fork (`forkFacts` waits for `pendingRecords`; `forkSource` refuses a disk of another kind than the record's, thrown with `foreignLaneWords`) |
| `update.ts` | an update (`withLaneStarted`, then one queued step, `planSettle` and `applySettle`, which fires the merge's `follow` after `recordUpdate`); `catchUpInRun`, the agent's `catch_up`; `askedAboutConflict`, which asks the lane's history for conflicts in its copy |
| `archive.ts` | a close's or a reopen's teardown (`planArchive`'s), off the documents' keeper; its lanes' history moved in the destination (`lanesMoved`) |
| `shares.ts` | what lanes may mount and reach, shared into the lane VM's slots and granted: the decision (`planShareAndGrant`) and, on the Mac, its state behind one queue (`createShares`: a share, a new lease's reset, the extra slots' close) |
| `runtime.ts` | the one place that picks the runtime, from the project as startup found it (`ProjectDir`): gathers, plans (`planRuntime`), and builds the `LaneRuntime` lanes of their own get (`Setup.runtime`), wiring `@pinetrie/vm`'s lease to `@pinetrie/docker` on the Mac |
| `ssh.ts` | lanes' ssh (ADR-0140): what the host reads of the person's and the service folder's (`ssh/` in pine·trie's config directory) ssh files, from `lanes.ssh` as settled (`sshChoice`), the lanes' files, the service agent and the host's socket (`@pinetrie/ssh`), what each lane is given (`attachedFor`, `holdsFor`), and the owner's answers, which it follows in `pinetrie.access` |

- **State lives where it changes.** What startup found is `Setup`'s, fixed
  after it. Each lane's handle is the registry's. Each coordination set is
  owned by the module that writes it, behind a function: `turns`' pending
  records, `base-news`' steers told.
- **One `turns` and one `updates`.** `index.ts` makes each once and builds
  pi's `hooks` from them, so a fork waits on the records this `turnDone`
  adds. A second instance would have its own set, and the fork would wait
  on the empty one.
- **The queues a lane's work crosses:** its own `LaneQueue` (the start, a
  fork, each turn's commit and snapshot, the bundle, the stop and trim),
  every step that reaches the lane's history through `withHistory`; the
  owner of your repo, for jj's import (a command, queued as the bundle is
  made, so a lane's imports keep their order: the fetch forces its ref, and
  an older bundle imported after a newer one would move it back); and the
  base snapshot's keeper. Every read of the destination from lane work (an
  update's base now, a new lane's begin, the base snapshot's accepted
  work, a file at a point) is, in jj's adapter, a pinned read
  (`owner.read`), which writes nothing (S87) and waits on no queue. A
  fetch's bundle needs the lane running, about 30 ms (S43), so a container
  stopped since is started for it, then stopped.
- **A turn's end is one queued step** (`turns.ts`, `disk.ts`). The commit
  is queued and awaited; the rest is one step, not awaited, so the next
  tool call waits for all of it and the next request for none:
  1. the turn's runs drained from the helper, the paths they name checked
     against the lane's `.gitignore` files and its ignore file on the host
     (`ignoredPaths`, `@pinetrie/rules/ignores`), from what one call to
     the helper reads of the disk (`ignoreFacts`): each path through a
     symlink classed as the first symlink on its way (`ignoreQuery`),
     which paths are directories, and each `.gitignore` above them. Then
     classed,
     the new recipes' inputs and roots' `CACHEDIR.TAG` hashed, and the
     registry written (ADR-0135). Each ask is a two-step value from
     `@pinetrie/rules` (`writesToClass`, `registryAfter`): the paths to ask
     about, then a step that accepts answers for exactly those. The
     registry goes on the `run`'s input: one shell argument is capped at
     128 KB. The
     host cannot reach the write tools' calls, which the helper records as
     tool writes (`packages/pi/TECHNICAL.md`);
  2. the snapshot, which so holds the registry its outputs are kept by;
  3. its whole-disk diff against the snapshot before (the newest this host
     planned for the lane, else the nearest above the turn), whose paths no run or
     tool wrote are checked against `.gitignore` too. This is in the same
     step because a lane's container stops after its run, and the check
     runs in the lane.
  The record is written after it. A fork waits for pending records, so a
  branch at a turn waits for its classes and diff. What follows the turn's
  commit (`TurnMade.follow`, for jj its fetch into your repo) is fired once
  this step is queued (`queueTurnEnd`), so its work runs behind the
  snapshot, never before it.
- **Every run starts on a disk whose recipes hold** (`disk.ts`,
  `removeStaleOutputs`, ADR-0135): at every container start
  (`startContainer`), so no way of making a disk need remember it; and
  right after an update's merge, in the same queued step, since an agent's
  `catch_up` merges with its container running. The
  helper checks each recipe's key (`checkRecipes`), `planStaleOutputs`
  says what goes, the paths are deleted and the registry rewritten. A
  failure is reported and the step goes on: a stale output is a rebuild
  the agent misses, not a broken lane.
- **An update is one step on the lane's `LaneQueue`** (`updateOnQueue`):
  the copy found ready (`readyToMerge`, whose `ReadyCopy` alone `merge`
  takes), the lane's base from its own history, accepted work and the WIP
  from the destination (`baseNow`), `planUpdateFrom`, then `merge`: the
  edits committed and, for jj, `mergeUpdate`
  (which first joins each accepted-offer commit the lane holds to its source, ADR-0079), so nothing
  changes the lane between what is read and what is merged. Before the
  merge, `planCatchUp` settles the floor a resolution's prompt must fit
  (ADR-0084), from the resolve-conflicts skill, read before the step, and
  the card's text: a catch-up whose smallest prompt would not fit is refused
  with the lane untouched, since a merge left without a prompt is one no
  later catch-up merges again (S106). Then
  `planSettle`, pure, decides what the thread gets, the land message
  included, and `applySettle` writes it, then fires what follows the merge
  (`MergeDone.follow`): the adapter's own, which lane work never reads. For
  jj, `planFetch` decides what is fetched: a clean merge, and a move to
  accepted work with nothing to merge, whose mark your repo would otherwise
  learn of only at a later fetch (`packages/jj/TECHNICAL.md`, A lane's
  repo).
- **A catch-up with the thread a thread branched from** (ADR-0072) is the
  same step: the card's command picks the rule. Its facts come from the
  lane's root document, not your repo (`parentNow`, with whether the
  parent's lane runs from `pinetrie:live`), and `planParentUpdate` decides;
  the parent's newest commit is fetched by id into the lane like accepted work's.
  A resolution's prompt names the incoming side as that thread's work.
- **An update stops the lane it started** (`withLaneStarted`), whatever it
  comes to, unless a run follows: a resolution, or the chat a quiet
  catch-up goes before (`follows: "run"`). That run's end stops it.
- **The agent's `catch_up` merges during its run** (`catchUpInRun`,
  ADR-0080, S103): the same `updateOnQueue`, with no start or stop of the
  lane and nothing appended: the tool's result is the update, and the
  turn's record names the merge (`turnMerged`). It is refused unless the
  call is its turn's only one and there is something new. Every catch-up,
  a card's too, is refused when the lane's working copy is off its own line
  (`planCopyReady`), since the merge lands at the lane's bookmark.
- **`ask_about_conflict` is taken while jj finds a conflict** in the lane's
  copy (`askedAboutConflict`, on the lane's queue), in any run: never from
  a revision record, which can be late (S104).
- **A split reads its skill before `beforeRun`**, so nothing between the
  lane's start and its run can fail. It is a card's command (ADR-0080),
  popped when the thread is free, its card's text the split's brief.
- **A lane's `LaneQueue` breaks on a fatal failure and the host's keepers
  do not.** A failed start or fork must stop the lane's tools, which wait on
  its queue; a failed host step must not stop the steps behind it.

## Lanes' ssh (`work/ssh.ts`, ADR-0140)

- **Its socket's path comes first:** `prepareSshDir` makes its directory
  before the runtime is found, since the Mac's lease names the socket
  (`hostSocketIn`); it listens only once setup has read the configs, before
  any lane is made. Docker binds it as a lane is made, and the launcher
  connects to it for each of a lane's connections.
- **A lane is given ssh only if it holds an identity:** a usable service
  key, or the person's own, which your config grants, or the project
  does and the lane's own config keeps (`laneMayAsk`). Its agent is told
  the same (`holdsFor`).
- **The record is the one truth.** The relay asks `mayUsePersonal`: an
  approved lane signs, a refused one does not, and anything else writes
  `waiting` and holds the signature until the record changes or
  `approvalSeconds` pass (`unanswered`). The `ssh-access` command only
  writes the record; a subscription to the session's records carries out
  each change (`planAccessChange`): release, refuse, or cut, which closes
  the lane's connections through the host and runs `KILL_SSH` in it.
- **A starting host leaves nothing waiting** (`recover`,
  `planAccessRecovery`): a held signature goes with the host that held it.
- **Shutdown** is part of lane work's close (`"work"`): every waiting
  signature is refused, each ask's deadline cleared, the socket and the
  service agent closed, and the socket's directory removed.
- **No suite reads the person's ssh:** `startHost`'s `ssh` names the
  folder and agent, and the harness gives every suite host an empty one
  and none (`suiteSshPlaces`).

## jj's adapter (`jj/`)

- **`startJjProject` takes a jj project alone** (`JjProjectDir`,
  `Extract<ProjectDir, { kind: "jj" }>`, `project.test.ts`). Opened, it
  takes your repo's names as settled (`repoNames`, from your files and the
  working copy's `pinetrie.json`), starts the owner of your repo,
  renames accepted work's old bookmark (`pre-accepted:`), and reads files at
  a point (`fileAt`, `@pinetrie/jj`). Started, it makes accepted work
  (`jj/accepted.ts`), the offers (`jj/offers/`), the fetches (`jj/fetch.ts`)
  and the splits (`jj/split.ts`), and each lane's history (`historyOf`),
  whose `follow` is the lane's fetch into your repo.
- **A starting host says when a tidy is due** (ADR-0155): one pinned read of
  your whole op log (`readOpLog`), tracked and never awaited, so the start
  does not wait for it; when its oldest operation is more than twice the
  window old (`planTidyHint`), one log line naming `pnpm tidy`
  (`tidyWords`). A read that fails says nothing.
- **A lane's fetch reaches the lane through `withHistory`** (`jj/fetch.ts`),
  as anything on a lane's history does, and its import is the owner's.
- **A split's prompt, and its end** (`jj/split.ts`, `finishSplit`, which
  moves the lane back to its tip even when a step before it throws: left on
  the stack, the lane refuses every catch-up).

## A folder project's adapter (`folder/`)

- **Only `folder/` touches your folder** (ADR-0142); `@pinetrie/folder`
  decides for it, and lanehost's disks role does the copying.
- **A read** (`line.ts`, one at a time on its own queue): gather (the last
  read's stamps, from the session's `folder-stamps.json`; the scan,
  `scan.ts`), plan (`planLineRead`), execute (lanehost's `readIn` into a
  new state, `line-<uuidv7>`, its parent your folder's newest). A read
  whose paths moved during their copy is read again, five times at most;
  nothing changed makes no state, but your folder's first read makes one
  even of an empty folder. With no stamps kept, a read copies every path
  into an empty disk, so nothing deleted since lingers. The stamps are
  written only once the state's record is, so a lost write costs one
  whole read, never a wrong one.
- **The scan** (`scan.ts`) walks by `lstat`, reads each directory's
  `.gitignore` as it enters it, and never enters an ignored directory: what
  is source is the lanes' own rule (`ignoredPaths` with `laneIgnores`).
  Symlinks are stamped by their target, never followed.
- **The watcher** (`watch.ts`) reads your folder once it has been quiet for
  10 s after a change to a source path (`isSourceChange`); a change only
  ignored paths saw reads nothing, and a dropped-events error reads at once.
  Every read waits for lanehost (`ProjectParts.ready`): the watcher's go
  through `acceptedMoved`, which setup runs once lanes can.
- **A lane's history** (`history.ts`) is states of the graph: its start
  (`begun`, its parent the state its disk was restored from), each turn
  (snapshotted after the lane's `sync`, then diffed against the lane's
  newest: no state when no source path changed), each catch-up (the path
  merge, `merge.ts`, on the graph's base, `virtual-base.ts` merging several
  first; two parents). What differs between two states is `changes.ts`'s
  one answer: the disk's diff, made or gone directories read as their
  files, files rewritten alike dropped, source paths alone. A conflict is a
  `CONFLICT` record and its three versions in the lane's states directory;
  `resolve` writes the version chosen and closes it.
  `follow` is always null: nothing is fetched.
- **The destination** (`index.ts`): `begin` and `baseNow` read your folder
  first, so a catch-up merges its newest state; a WIP is refused. Each run's
  end builds the lane's offer and base records (`offers.ts`) and describes
  the offer with the host's describer (`describe.ts`, jj's too); your
  folder moving rebuilds every folder lane's. An accept is refused
  (`folder_accept_later`), a squash too (`not_a_stack`), a setup and a
  publish with why. A review reads an open folder offer's `start..tip`:
  its files with their line counts (`diffStats`), and one file's diff
  (`fileDiff`), both lanehost's.
- **The sweep** (`sweep.ts`), at start and after each run's end, deletes the
  snapshots of the states `liveStates` keeps not, `folder.history.states`
  of your folder's line among them; every `STATE` record stays.

## Offers (`jj/offers/`)

- **Every offer step runs on the owner of your repo** (`@pinetrie/jj`,
  `packages/jj/TECHNICAL.md`, ADR-0065), since a take once waited behind
  every refresh queued before it (S89). An offer action, a `line`
  command, a split's span and its end, and moving lanes' refs are owner
  commands; a refresh is upkeep, `later("refresh:<lane>")`, and accepted work's
  record `later("line")`. So a command waits for at most the one step
  running, however many refreshes are marked, and a lane marked many times
  before its refresh starts refreshes once.
- **What marks a lane** (`planMarks`, `marks.ts`, pure, from the owner's `onMoved`): a
  move of accepted work or a WIP, or the first observation (`all`), marks the
  line's record, every named lane whose root is not archived, and every
  open record; your `@` alone
  (`yours`, jjui and your editor) marks no lane: one `later("shared")` step
  rewrites each open record's `yourEdits` (its files that `@` changes,
  `planYourEdits`) and
  accepted work's record from the shared facts; a lane's
  ref (a fetch's import) marks that lane; an offer bookmark the lane its
  thread names. A run's end marks its lane, then describes it. A refresh
  that wrote is observed, and refreshes the lanes it moved once more: that
  one reads, plans `none`, and writes nothing, so it ends there. The record
  is only a hint of where to look: it is how an offer you abandoned by hand
  is built again. A bookmark of yours that no offer depends on moves
  nothing. Every named lane, not only those with an offer, so each lane's
  `pinetrie.base` follows accepted work, and with it what catching up would
  change. Not an archived root's lanes: they have no base to follow
  (`gatherRefresh` gives them none), and their refresh only withdraws an
  offer. What could still hold one marks such a lane anyway: its ref or its
  offer bookmark (the first observation reports every bookmark as moved),
  or an open record. That is safe because an untraced start, or what jj cannot say,
  builds nothing (ADR-0067): a thread accepted before offers carried
  `Pinetrie-Source` is not offered again (S97).
- **Reads are pinned and never queued:** a page's review or diff
  (`Offers.read`), a description's gather, and lane work's reads of your
  repo run at the head the owner last observed (`owner.read`). An offer
  acceptance gathers in its own command, unpinned, so it acts on the repo as it is.
- **The host decides nothing and runs no jj on an offer.** Each step is a
  gather (`@pinetrie/jj`: `gatherRefresh`, `gatherOffer`, `gatherOfferAcceptance`,
  `gatherStack`, `gatherDescribe`), a decision (`@pinetrie/rules`: `planRefresh`,
  `planOfferAcceptance`, `planRebuild`, `planStackEnded`, `planDescribeSettle`),
  a translation into steps (`@pinetrie/jj`: `offerEffects`, `offerAcceptanceEffects`,
  `rebuildEffects`, `describeEffects`), and `executeOffer` (`execute.ts`),
  which carries out every action over ports: the lane's base record first,
  when it differs from the page's, then the steps, then what comes after
  (`OfferEffects.after`). So the rules are tested as values in the two
  packages, what the host writes is tested over `record<T>()`, and
  `packages/jj/repo.test.ts` proves the reads and steps against real jj.
- **What only the documents know is read here, first** (`state.ts`,
  `OfferDocs`): the thread's name, whether its root is archived (from its
  board place, `readArchived`, never from the lane's tip being missing: a tip missing
  for one import, S78, must not withdraw a live offer), the last catch-up
  read (`pinetrie.base`, a memo `readCatchUp` keeps at the same tip and base
  commit, never read to decide), the lane's tip entry and the WIP line.
  Everything else is read from your repo (ADR-0104), and where an offer
  sits is decided once there (`OfferPlace`): a WIP gone moves nothing and
  writes only its base record; an untraced start builds nothing, so squash,
  refresh, describe and a split's span refuse it, while an acceptance, a
  bookmark move, can still accept an offer you edited there.
- **The records are written from the repo after each step**
  (`OfferRecords`): an offer's from the read made before planning when the
  step ran no steps (the common `none` reads nothing more; a `mark`, which
  moves only the host's version of the offer, reads it again), else from a new
  read; `withdraw` and `forget` remove it; an acceptance writes it marked
  accepted (`acceptedAs`; a record from before ADR-0083 says `taken`,
  read as the same).
  Each write is skipped when it changes nothing, and the records are read
  only for that. A base record that changed is reported (`baseChanged`), so a
  running thread whose base now has news is told (`base-news.ts`,
  ADR-0080); the report queues a keeper step, never awaited from the owner's
  command, which would wait on itself.
- `refresh.ts` carries out a refresh and a rebuild, and gives the ports;
  `describe.ts` gathers by a pinned read, asks the model outside the owner,
  one request per lane at a time (`describing`), and writes in an owner
  command; `act.ts` and `stack.ts` are the actions and a split's stack;
  `marks.ts` is `planMarks`.
- **A root archived or restored moves its lanes' refs in an owner
  command** (`Offers.moveLanes`, called by `work/archive.ts`), then marks
  each lane: an archived thread's offer is withdrawn, a restored one's built
  again (ADR-0061).
- **An acceptance names the offer it was shown** (`OfferSeen`, ADR-0065): the
  ledger its record carried, and whether it conflicted, which the page's
  session client reads from the record as it sends (`offerSeen`).
  `planOfferAcceptance` refuses `offer_changed` when the ledger now differs (its source, or its
  start as a set), or the offer conflicts now and did not then. A rebase
  onto a moved target and your edit keep the ledger, and are accepted.
- **An acceptance names its destination** (`planOfferAcceptance`): one of
  `offerAcceptanceDestinations`, and refused (`bad_destination`) unless the bookmark is
  at or below the offer's bottom's parent, read in the same command
  (`gatherOfferAcceptance`). jj's
  refusal of a backwards move is the second guard (S77 item 1).
- **Setup and publish** (`jj/accepted.ts`, created by the adapter's start beside
  the offers, which rewrite its record when the owner observes accepted work or
  your `@` move): decided by `@pinetrie/rules` (`planAcceptedAction`), its steps
  `@pinetrie/jj`'s. `setup` creates accepted work's bookmark at your `@-` and
  writes `immutable_heads()` and `revsets.log` to the repo's config, the
  text the publish button's setup showed (`planSetup`). A publish
  (ADR-0076, ADR-0090) is two rounds of gather, plan and execute in one command: the
  catch-up (`planPublishCatchUp`, as you, only with `publish.catchUp` on
  and only when the working copy is behind), then the record read again, with
  the catch-up's operation from `SharedFacts.op`, decided by
  `planPublishFinish` into the move (`planPublishMove`) or the catch-up's
  undo (`planCatchUpUndo`) and a worded refusal. A move jj refuses after a
  catch-up runs the undo and rethrows: the one branch that is not a plan's
  value. The record's preview runs `git merge-tree` on your repo (the
  step's `git`). Setup and publish are anyone's, on any host: what a
  publish does is `publish.catchUp` (`RepoConfig`, carried on the record),
  never the bind or the invite key (ADR-0099).
- **The base snapshot follows accepted work** (`jj/index.ts`): the owner's
  `Moved.onto` refreshes it (`acceptedMoved`, then `refreshBaseSoon`), so setup, an accept, an
  accepting publish and a move made in jj outside pine·trie all reach it
  by one path. An acceptance into a WIP does not, since the snapshot is
  accepted work's.
- **Shutdown closes the owner** (`LaneWork.destination.close`, the `close` step): it
  refuses every step from then on and stops its watch; `quiet` waits for
  what it holds (`LaneWork.quiet`).

## Testing the shell

- **Test a decision as a value** where the shell has one: `planRunEnd`,
  `planInvites`, `draftSent`, the responses, `planSettle`, `planInvocation`,
  `storeChoice`, the startup lines' words (`startup-lines.ts`), `isHeld`, and
  `planStartup` (`@pinetrie/rules`).
- **Otherwise, drive a module with `record<T>()`** for exactly the port it
  takes, and a real `newSessionDoc()`. A method the test did not give throws,
  naming itself, so a module that touches an undeclared port fails at once.
  `fakeLane` holds a run open until the test finishes it. `row` and
  `writeEntry` put entries in the document, `putValue` a host record
  (`putValue(doc, setRecord(MARK, mark))`, through the real writer,
  `applyRecordWrites`), and `writeLaneTip` a lane's tip; a
  running lane is `beginRun`. `writeEntry`, `writeLaneTip` and `beginRun` are
  `@pinetrie/schema/fixtures`'.
- **A port's writes are values.** Every record goes through one
  `Records.writeValues` (ADR-0062, ADR-0095), so a test asserts what was
  written: `expect(writesOf(records.calls)).toEqual([deleteRecord(MARK, entry)])`.
  A test that needs the order of calls across the records, the scribe, pi's
  setup and the agent gives one `record` as each of them. `applyWrites`
  applies writes to the test's documents through the real writer, as
  `createRecords` does.
- **The places are written through the real writer in tests too.**
  `seedPlaces` writes a test's setup through `createPlaces` with hooks that
  record nothing, and `seedChange` gives a pop an `apply` that writes so;
  `placesFor(b)` is the writer over the test's documents with its real
  provenance. No test support writes the document around it.
- **Admission is two pure plans**, `planRequest` and `planUpgrade`
  (`routes.ts`): every admission rule is a unit test there, and `http.ts`
  only carries them out.
- **A mutation uses a suite only for what no unit test can show.** The
  host's that remain, and the fact each proves:
  - `index.ts`: the host waits for its stored session; startup compacts; a
    run's end compacts; stale command Lines are deleted at start; it serves
    only after `recover`;
  - `http.ts`: the request and upgrade handlers carry out a plan's refusal;
  - `packages/rules/chat.ts`'s `attributed`: the model is told who spoke, which
    shows that pi's conversion sends `content`;
- **Tests in subdirectories run**: `vitest.config.mjs` includes
  `apps/*/host/**/*.test.ts`.
- **The acceptance is the suites'.** `e2e` and `e2e:browser` check the
  wiring; their mutations are in `scripts/mutations/app.ts`, and this
  directory's unit mutations in `scripts/mutations/host.ts`. The suites' own
  gotchas, and what their waits cost, are in `apps/pinetrie/e2e/TECHNICAL.md`.
