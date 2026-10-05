# The host's shell: technical notes

The host gathers facts, calls the pure decisions in the packages
(`@pinetrie/rules`, `@pinetrie/reads`, `@pinetrie/schema`, `@pinetrie/lanes`),
and carries them out. This directory is that imperative shell. Each module
does one thing and takes its dependencies as a parameter; `index.ts` alone
wires them.

## Where things are

| module | owns |
|---|---|
| `server.ts`, `invocation.ts` | `pnpm host [folder]` (ADR-0086): `planInvocation` (the folder), `storeChoice` (the session's file, and whether `PINETRIE_STORE` named it), `refusalText` (a refusal's words); `server.ts` carries them out |
| `startup-lines.ts` | the words of what a starting host logs about its inputs: the project, the store, the user config, the agent's model and where it came from, the URL and invites |
| `index.ts` | `startHost`: the store, the Exchange (with its `resolve` for the documents clients create, `resolveDoc`), the documents, lane work and the agent, then the wiring below |
| `basics.ts` | `Basics` (the session, `pinetrie:live`, the documents, the places, log, ids, clock) and how a failure is logged (`failed`, which words the error with core's `errorText`) |
| `places.ts` | `applyPlaceSteps`: the one writer of the places document (ADR-0059), which writes its records in one batch, in an undo step when given one, then raises its `rev` in a batch of its own (`raiseRev`) |
| `move-history.ts` | each person's history of moves per root (ADR-0066): `MoveHistories`, a shell over Kyneta's undo stacks |
| `provenance.ts` | each card's history and the traces left where someone else moved your card (ADR-0048 step 6): `before` at a step's start, `after` its places write, `seen` and `sweep` |
| `shutdown.ts` | the order a host stops in (`planShutdown`) |
| `runs.ts` | a run from its start to its end (`createRuns`, `planRunEnd`), a Stop before pi starts (`cancel`), and the agent's `onStream` (`streamInto`) |
| `pinned.ts` | what a run reads of its thread's pinned cards (ADR-0048 step 5): `readPinned` gathers, waits a bounded time for the sender's text (`waitFor`), and plans the cards entry |
| `base-news.ts` | what a thread is told of its base's new work (ADR-0080): `atStart`, a chat's run's behind entry; `baseChanged`, a steer into a running lane, at most once per base commit (`told`); `runEnded` forgets what was steered |
| `split-call.ts` | `split_offer` (ADR-0080): a split card queued on the thread, popped when its run ends |
| `queued-card-pop.ts` | popping a lane's queued cards to send them (ADR-0048, ADR-0083): `popNextQueuedCard`, and `drain`, which carries each out as `planCarry` decides: a fact appended, a catch-up, a split's run, a message sent (ADR-0055, ADR-0080); and `createWaits`, the drain's waits for its top card's text or for someone's typing in it to stop (ADR-0048 step 7) |
| `settle.ts` | what happens between runs: drains, then the compaction and sweep as upkeep (the keeper's `later`) |
| `housekeeping.ts` | which documents a run's end compacts (`planCompaction`: its roots, the session, the places, `pinetrie:live`), deleting images nothing shows, retiring histories of moves (`sweepHistories`), and deleting holds on queues nobody can use (`sweepHolds`, ADR-0048 step 7) |
| `docs.ts` | `HostDocuments`: every document the host holds, a root's opened as it is asked for, and `onOpened`, which replays the roots already held to a listener that joins late; `planLoads` |
| `directory.ts` | each root's directory record, refreshed as its document changes: `startDirectory`, started with the agent |
| `cards.ts` | the card port (ADR-0048), about texts only: who wrote in a card, destroying one, loading and reading texts for the queue's pops and a run's pinned cards, waiting until a text holds a version (`whenHolds`, which an `AbortSignal` gives up), and the texts of given cards gathered for the sweeps; where the shell opens card documents |
| `seats.ts` | each connected seat's person, written once as a `pinetrie.seat` record (started after `recover`), and unloading the histories of moves of a person with no seat left |
| `startup.ts` | `recover`: what a starting host does before it takes a command |
| `control.ts` | the command Line of each client seat, and who its writer is |
| `commands/` | one module per command: `chat`, `board` (a move on the board, a change to its states: ADR-0085), `mark`, `lane` (stop, carry on, hold or release a queue, offer: each finds its lane through `laneAt`), `cards` (a move, a reorder, unqueue all, an undo of moves, a command, a busy chat's card queued, a sent card spent: ADR-0059, ADR-0066); `index.ts` decodes, decides where it runs (`placeOfCommand`), checks the archive, routes, and sends a popped queued card behind the same check (`sendPoppedQueuedCard`) |
| `http.ts` | the HTTP server: admission, Vite, the websocket, blobs, offer reads, invites |
| `responses.ts` | every answer the host writes itself, as a pure `HttpAnswer` |
| `routes.ts` | what a request or an upgrade gets, pure: admission first (`planRequest`, `planUpgrade`), then which requests are the host's (`route`) |
| `hot-reload.ts` | Vite's hot updates: one to a file inside a running direct lane's directory is held until a run's end (`isHeld`); the project does not come into it |
| `admission.ts`, `policy.ts`, `lines.ts`, `blobs.ts`, `store.ts` | the invite key and links, the write policy, departed seats, the image store, the SQLite store |
| `work/` | lane containers and disks (§ Lane work) |
| `offers/` | each lane's offer in your repo, on the owner of your repo (§ Offers); the line's record and commands are `work/line.ts`'s |
| `names.ts` | every thread's name (ADR-0039): `ensure` for the lanes pi holds, `reserve` for a lane id a column reserved before its lane exists (ADR-0057), on one queue |
| `banners.ts` | each thread's column banner (ADR-0050, ADR-0053): made as the thread is named, at reservation or creation, set by `set_banner` |
| `digests.ts` | each ask's digest (ADR-0056), unless the user config turns them off (ADR-0071) |
| `outside.ts` | `requestOutside`: a model request outside a keeper, its answer written in a step of its own |
| `fakes.ts` | test support: `record<T>()`, `fakeLane`, `row`, `putValue` and `applyWrites` (each write to the document its target names), `writesOf`, `basics` (one root, `ROOT_ID`, in `fakeDocuments`), `putLane`, `writeDirectory` |

## The documents' keeper

- **Every command but your repo's is a step on one keeper**, and so is every
  drain (`@pinetrie/keeper`, `packages/keeper/TECHNICAL.md`, keyed by
  `HostKey` in `basics.ts`). Where a command runs is decided, pure, by
  `placeOfCommand` (`commands/index.ts`, ADR-0065): an offer action but a
  split, and a `line` command, go straight to the owner of your repo after
  the archive gate (a synchronous read), and hold no other command; a move
  on the board is up to three parts (`commands/board.ts`): its place on the
  keeper, and, when it crosses the closed state's edge, its teardown
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
  gathers the thread's pinned cards at the lane's tip (`cardsAt`), loads
  their texts, waits for each as the chat's sender had it (`seen`, at most
  `PINNED_WAIT_MS`, 2 s), gathers again (a card may have been pinned or
  unpinned meanwhile), and plans against what the model last read on the
  path (`pinnedInView`, `planPinnedRead`). `runs.ts` only awaits it and
  passes the entry to `handle.run`; a failure is logged and the run goes
  without cards. A resume reads nothing: its prompt and entry were written
  when it began.
- **The wait is a window in which pi's `abort` reaches nothing**: the run is
  begun (`beginRun`, so the lane is busy and the suites count it running),
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
  stops, and the offer is refreshed. `ended` runs hot reload, which reads
  which lanes run, and drains the lane; a drain that ran before
  `endRun` could start the next run with the last one's reply still open.
- **The verdict is pending before `endRun`** (ADR-0077, `Digests.pending`):
  written after, a page would see the lane stopped beside the last run's
  verdict, and draw its arrival. Its `end` is the run's last entry from its
  asks, as at `ended`.
- **A failure before `endRun` is logged as `run end failed`,** and `endRun`
  and every step after it still run.
- **`ended` is one function, set once** in `startHost`: hot reload, then
  `settle`, banners, and the verdict with the final digest. It breaks a cycle: a run's end
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
  directory that is not archived, before `recover`. A busy root cannot be
  archived, so these hold every lane a crash could have interrupted. Which
  roots are archived is the board's (`readArchived`), or, for a store from
  before the board, the carry-over's, planned before the roots are opened
  since the agent that writes it is made after (ADR-0085).
  Archiving `unload`s a root (`work/archive.ts`); restoring opens it.
  `unload` first has pi close its harness over the root (`releasing`,
  `Agent.release`): a harness kept would write to the closed document, and
  every later command in the root, the restored one included, would fail
  with "This document was unloaded, and is closed".
- **The host is every document's authority** (`{ authority: "self" }`), so
  Kyneta loads a root it let go again when a client asks for it (S86).
  `resolveDoc` interprets a `root:` id the directory names, as an archived
  root a client previews, and rejects any other: only the host makes roots.
- **The directory follows each root's document** (`directory.ts`): a change
  to its entries or values queues one refresh, the keeper's `once`
  (`root:<id>`), absorbed by one already queued, which writes
  `readRootRecord` with `setIfChanged`. It starts once the agent exists,
  since a refresh writes through it, and follows every root through
  `onOpened`: the roots `startHost` opened before it, then each opened
  later. It refreshes each as it starts to follow it, so a record stored
  before a field was added (ADR-0077) is rewritten at startup. A settle's compaction is `later`, so
  it runs after every refresh queued before it starts, and the records it
  compacts are current. A write after a compaction only lands in the next
  one's log.
- **A command names its root** (`Command.root`, ADR-0063): a chat or a mark
  writes in it, and a chat at the root starts it, under the id the sender's
  tab minted, refused `root_id_in_use` when the directory holds it already.

## Startup

After `recover`, `sweepHistories` retires the histories of moves no one will undo again (§
Moves' history), and `sweepHolds` deletes the holds on queues whose lane no
root holds or whose root is archived (ADR-0048 step 7). Both run again after
each run's end, in `settle`'s sweep.

`recover` runs, in order: `clearStreams` (no stream survives a process), the
carry-over's writes from before the board, if `planCarryOver` planned any
(`carryOverWrites`, ADR-0085), a
log of the stored lane names, in the roots opened, that fail `isLaneName`
(`readStoredLanes`: no reader is given them, so the log is where one shows;
it never throws, and nothing is deleted), `ensureNames` (ADR-0039),
`planStartup` over the queued cards and `interrupted(roots)`, each
interrupted lane resumed before anything waiting for it (S36 item 18), the
project and commands records that changed in one write (`setIfChanged`),
the sweep of what no one will type in again: empty cards, card documents
with no record, and seat records no stored text names, all of them in one
write (`sweepTexts`), then the histories of the cards it swept and traces
older than 30 days (`provenance.sweep`, which each run's end's settle runs
too), and last `settle` for the lanes with cards queued:
its compaction is `later`, so it runs after every write above, and after
any refresh they queued.

- **A starting host says what it read** (`startup-lines.ts`). `server.ts`
  logs the project and the store, `startHost` the user config (with
  `(none)` when missing, or why it is broken), then the roots it opened,
  then `agent ready` with the model and where each of its fields came from
  (`Agent.modelOrigin`: `PINETRIE_PROVIDER`/`PINETRIE_MODEL`, or the pi
  settings file that named it), and `server.ts` the URL and invites. The
  user config is read with `readConfigFile` (`@pinetrie/lanes`): missing or
  broken, its decoders get null and decode it as empty, as ADR-0071 says.
- **The project folder is prepared before `startHost`** (`server.ts`):
  `prepareProjectDir` (`@pinetrie/lanes`) finds its root and adds `/.pinetrie/`
  to its repo's exclude file, so the store, opened first in `startHost`, is
  never taken into your `@` (S108). A suite skips this: it gives its own
  store, and `prepareHost` runs `prepareProjectDir` again for lanes, which
  writes nothing the second time.
- **The project is apart from tools** (`StartHostOptions.project`). pi's
  settings and `AGENTS.md` load from it with tools off too; lane work starts
  with a directory only with tools on, so `Setup.project` is null without
  them, and nothing asks a lane's access then.
- **Commands are taken only after `recover`.** `Control.listen` is made
  earlier, and `startControl` registers `onReceive` after `recover`. Earlier,
  a new message could run before an interrupted lane resumed, and jump a
  queued card.
- **The agent, lane work and banners are made in a cycle.** Lane work and
  banners are made first and read the agent lazily (`theAgent()`), because
  the agent is made with lane work's `access` and `hooks` and banners'
  `request`. Digests, titles and names are made before it too, and read it
  the same way. Those are the only lazy reads: every module made after the
  agent is given the agent. The documents' keeper is made before them, for banners.
- **A module made before the agent writes nothing as it is made.**
  `theAgent()` throws until the agent exists, and the documents' keeper runs
  a step at once. A directory that refreshed each root as `startHost`
  opened it, before the agent, failed on every stale record; so the
  directory starts after the agent, and `onOpened` replays the roots opened
  before it.

## Shutdown

`planShutdown` (`shutdown.ts`) returns the order, and `shutdown()` carries
it out, each step but `server` in its own `try`: `intake` (seats, control), `close` (the documents' keeper and the owner of your repo, which stops its watch), `quiet`, `agent`,
`work` (the containers), `exchange`, `server`. Only a failure in `server`
rejects `shutdown()`.

- **`shutdown()` runs once.** A later call returns the first call's
  promise, so a second signal, a scenario's `finally` and `withHost` never
  close anything twice.
- **`server` stops accepting, then closes Vite and every socket.**
  `httpServer.close` calls back only when every socket has ended, upgraded
  ones included, and neither `wss.close()` nor `closeAllConnections()`
  closes an upgraded socket. Vite's HMR socket kept a host with a page open
  from ever stopping (S98). So `close()` (`http.ts`) starts
  `httpServer.close`, closes Vite, terminates the exchange's sockets (one
  that reconnected after the `exchange` step was accepted again), cuts any
  request in flight, then waits. Accepting must stop before Vite closes: a
  page retries Vite's socket once a second, and once Vite's `upgrade`
  listener is gone, the `"vite"` route leaves that socket open.
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
- **The archive gate is in the dispatcher** (`refuseInArchive`), over
  `readArchived`: a root in the closed workflow state. Only the
  `chat` command and `sendPoppedQueuedCard` call `sendChat`, both behind the gate, so
  `sendChat` has no gate of its own.
- **A root a chat starts takes its place on the board in the same step**
  (`placeNewRoot`, `placeStarted`): at the end of the state the chat names
  (`Command.state`, a board column's ＋), else of the first open state.
- **A move on the board** (`handleRootMove`): `planRootMove` over the
  workflow and the places; a move within open states writes its place and
  answers; one that crosses the closed state's edge gathers the root's
  document (`docs.root` loads an unloaded one, S86) and `planArchive`s the
  crossing first. **A change to the states** (`handleWorkflow`) is one
  keeper step, `planWorkflowEdit` over the workflow and the board.
- **A message sent from a card spends it** (ADR-0048): `sendChat` names the
  card's other writers as contributors, through the card port, and spends
  nothing. The dispatcher's `chat` case spends the card when the answer
  takes its text (`spendsCard`: `appended` or `started`): the record goes,
  then the text, and the reply carries the places' `rev`. Sent from a fresh
  column, the spend first moves the column's other cards to drafting at the
  message it wrote (`planFreshFollow`, found by the send's id), in the same
  step, so no move gets between. The drain destroys
  a popped card's text itself, since the pop removed the record. The command's
  text is what is sent: the text its sender saw.
- **A chat carries its sender's pinned versions** (`pinned`, each card
  pinned at the sender's thread end with its text version): `executeChat`
  passes them to `start` for a `run` or `createAndRun`, and the run waits
  for them. A popped queued card's chat (`chatOfPoppedQueuedCard`) carries none: its thread's
  cards were edited long before.
- **A busy lane answers a chat from a card `queued`** (ADR-0059): the
  dispatcher queues the card behind the others in the same step
  (`queueBusy`), so no other send gets between. A chat with no card, or one
  whose card the host does not hold, still answers `busy`.
- **Every write to the places goes through `applyPlaceSteps`** (`places.ts`):
  every record in one batch, then `rev` raised in a batch of its own. A
  client draws a move it sent until its copy reaches the `rev` the reply
  carried (`packages/session/card-moves.ts`), so a write that skipped `rev`
  would leave a move drawn over a record that had changed. `rev` stays out
  of the records' batch because that batch may be an undo step, and a value
  every later write changes would refuse every whole undo of it (S82).
- **`move` and `set-command` are handoffs** (`commands/cards.ts`): gather
  the places and whether the lane runs, plan (`planMoveCommand` over
  several moves, `planSetCommand`), then write. A move's list is accepted
  whole or refused by its first refusal (`planMoves`): a keep's cards are
  one command. An accepted move answers `moved` with its `rev`; a refusal
  answers `unmoved` with its code, where the card is now, who put it there,
  and the current `rev`. A move that leaves a card queued on a lane that is
  not running queues the lane's drain, a voided `keeper.once`
  (`drain:<lane>`) behind the move's own step.
- **Every place-changing command records its provenance in the same step**
  (`provenance.ts`): `before()` reads the places and each shared card's
  thread end at the step's start, and `after(cause, before)`, once the
  places are written, plans the cards' history and the traces
  (`planProvenance`) and writes them in one `writeValues`. In
  `commands/cards.ts`, `carry` is the one path for a move, a busy chat's
  queue and a spend, each with its cause; a command moves no card and has
  none. `undoMove` calls both itself, since Kyneta writes the revert. The
  drain does too, around each pop (`queued-card-pop.ts`), with `popNextQueuedCard` still
  synchronous (S69). The presence it reads is `readReading`'s pairs: a
  placer with a column open at the card's end saw it go.
- **`traces-seen` deletes the sender's own traces**, ignoring any other
  id, and answers `seen`. A client sends it for the traces a column drew.
- **`undo-move` undoes or redoes the sender's newest move in a root**
  (§ Moves' history). It answers `undone` with each card it moved and its
  place now, `unmoved` (shaped as a refused move) when someone moved a card
  since, or `nothing`.
- **A person's documents are clients' documents the host only keeps**
  (ADR-0059, ADR-0077, ADR-0085): their inventory, their attention and
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
  hold a document, and which writes it takes from presence and cards.

## Moves' history (`move-history.ts`, ADR-0066)

- **One Kyneta undo stack per person and root**, `moves:<writer>:<RootId>`,
  key `moves`, scope the places document, made on first use and kept in the
  store. Kyneta undoes only its own runtime's writes, and only the host
  writes `places`, so the stacks are the host's: `policy.ts` shares them
  with no one and rejects one a client announces, and `writersPolicy` gives
  them to the host alone.
- **Which history a move enters is the host's** (`historyOf`): the root the
  card goes to, else the one it leaves, read from its record; a creation or
  a removal enters none. `move` writes inside that stack's `gesture`. The
  host's own writes (a queued card's pop, a spend, an unsent card, a fresh column's
  followers, the sweep) are outside every gesture, so every stack rebases
  over them, and an undo of a move the host overtook is refused.
- **Every undo is `whole`.** Without it a step someone else's move broke is
  skipped and an older one undone out of sight (S82). With it, a card's row
  (its place and its placer) changed by anyone since refuses the undo.
- **`rev` is raised after an undo too** (`raiseRev`), apart from the
  revert, which Kyneta writes itself.
- **Retired 7 days after their root is archived** (`planHistorySweep`,
  `ARCHIVED_HISTORY_MS`), at startup and after each run's end; and at
  startup only, those of a root the directory does not name (a new tab that
  never sent). The stored ids come from the store's listing by `moves:`;
  `retire` destroys a stack loaded or not (S91).
- **Unloaded when nobody can use them:** a person's when their last seat
  leaves (the seats step, `idleWriters`), a root's when it is archived
  (`docs.unload`'s `releasing`). The next move loads one again (S91).
- **Shutdown disposes them, then flushes,** so a stack's open step is
  stored before the Exchange stops.

## The queue (`queued-card-pop.ts`, ADR-0048, ADR-0055)

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
  with no text and no command is discarded. A catch-up's `prepareUpdate`:
  clean, the update is written, then the text, if any, is sent;
  conflicted, the resolution run carries the text; nothing new, the text
  alone; refused, the card goes back. The text is sent through
  `sendPoppedQueuedCard` in mode `queue`, as its queuer (`by`), with the card's other
  writers as contributors. A card with no text starts no run.
- **A card the host could not send goes back below the line, whole**
  (`planUnsent`): drafting where it was queued, saying why, and never queued
  again, or the next drain would fail the same way (S69, answer 5). Its text
  is kept. After a clean update its command is cleared: it was carried out.
  An update or a send that throws writes the card back the same way, saying
  the host failed: the pop has deleted its record, so nothing else would.
- **Five things drain a lane:** a run's end (`settle`), startup
  (`recover`), a move that leaves a card queued on it while it is not
  running (`queueDrain` in `index.ts`), a release of its queue, and the end
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
  reaches the host's subscribers, S28). A wait is given up when its card
  leaves the queue (`givenUp`), and its end drains the lane again. `runs.start` marks a lane
  running at once (`beginRun`), so a drain behind a started run pops
  nothing.
- **`executeChat` still checks a new lane's directory and asks pi for the
  lane.** Both are ports that may refuse, not facts to gather. The directory
  is checked first, so a refused send creates no lane.
- **The new lane's id is decided before that, in `planChat`** (ADR-0057).
  `sendChat` gathers `newLane` beside `sendId`: the column's reserved id,
  the lanes pi holds, and a spare made with `newId`. pi makes no ids.
- **`reserve` is answered `reserved`** whether it named the id or the id
  had a name already, so a column may send it again; an id pi holds is
  refused `lane_id_in_use`.
- **Stop records who pressed it before it aborts** (ADR-0056): `planStop`
  (`@pinetrie/rules`) gives the `pinetrie.stop` record for the running ask's prompt, unless one is
  there, and `handleStop` writes it, then asks pi to abort, in one step. So
  the record is there when the run's end is drawn, and the first press is
  the one named. With a message card queued it holds the queue in the same
  write (`holdOnStop`, ADR-0048 step 7), so the run's end, a drain on the
  same keeper, pops nothing.
- **`queue-hold` holds or releases a thread's queue** (`handleQueueHold`,
  `planQueueHold`): it answers how the queue is now, `held` or `released`,
  whether it wrote or the queue was already so. A release asks for the lane's drain: nothing else
  would pop what waited.
- **`reorder` and `unqueue-all` are moves of their own** (`commands/cards.ts`).
  A reorder is written in the sender's history of its place's root
  (`planReorder`), through `carry`, and drains nothing. Unqueue all plans
  its moves from the queue as it is (`planUnqueueAll`) and hands them to
  `move`, so it is one step one undo reverses; with nothing queued it
  answers `nothing`.
- **A command on an offer leaves a fact** (ADR-0080): `actOnOffer`
  answers first, then writes the action's fact as a queued card in a keeper
  step of its own (`recordFact`), with its history (`provenance`, cause
  `host`, as for the split card `split_offer` queues), and asks for the
  lane's drain. An idle
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

## Requests outside the queue (`outside.ts`)

A model request takes seconds, and no command may wait on it. Banners,
commit messages, digests, verdicts and titles ask with `requestOutside`: the request runs
outside the documents' keeper, tracked so `quiet` waits for it, and its
answer is written in a step of its own (a keeper step, or for a commit
message an owner command), after that step decides it is still wanted (`bannerStillWanted`, the offer's checks, `digestToWrite`, `runEndedToWrite`, `titleStillWanted`). A
failure is logged, never thrown. With `held`, a key is in a set while the
request is out, for the caller's plan to read (`bannerDue`, `digestDue`).

## Digests and verdicts (`digests.ts`, ADR-0056, ADR-0077)

- **Always made.** The user config's `digests` (`enabled`) turns off live
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
  tip may already be past the run (below).
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
  not one", "the model's verdict is not one"). `settle` gets the parsed
  reply, never raw model text. A live digest writes what `digestToWrite`
  returns; a run's end, what `runEndedToWrite` returns.
- A missing `ask-digest` skill is logged, and settles as a failed request.

## Banners (`banners.ts`, ADR-0050, ADR-0053)

- **A decision is one keeper step**: gather the lane's banner, whether one
  is being made and whether a blob is stored; `bannerDue` or `planAsk`;
  write a pasted image. A new image is a `keeper.track`ed task: the image takes seconds,
  outside the queue, then the write is a step of its own, only while
  `bannerStillWanted`. A missing `column-banner` skill is logged.
- **A thread is due one as it is named** (`createNames`' `onNamed`): as a
  column reserves its lane (ADR-0057), or as a lane with no reservation is
  created. It is due again at each run's end, which draws only when it still has none: the
  retry for a failed one. `recover` does not: turning banners on must not
  draw one for every thread that ever ran. Banners are made before
  `createNames`, which is made before lane work.
- **Only the name goes out**: the prompt is the `column-banner` skill's
  body, filled from the thread's name (`bannerPrompt`). No text model is
  asked, and no message leaves for the image model.
- **A drawn image arrives fitted** (`Agent.drawBanner`), as an upload is,
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
  details. A new root has no entry yet, so the request, outside the keeper,
  waits for the root's first entry (`whenRooted`, at most 30 s) before its
  title is settled as the root's mark.
- **The settle checks again**: an archived root takes nothing, and an
  unasked title gives way to any mark written meanwhile
  (`titleStillWanted`). `planMark` writes it, so an unchanged title writes
  nothing.
- **Only an unasked request is `held`**: a person's Auto-update goes out
  even while an unasked one is out for the same root.
- A missing `tab-title` skill, or a reply `titleOf` refuses, is logged, and
  nothing is written.

## HTTP

- **Admission comes first**, for a request and for an upgrade. Nothing
  reaches Vite, the blobs, an offer's reads or the Exchange without it.
- **Vite's HMR socket shares the host's port, behind admission.** Vite's
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

`work/index.ts` builds each piece in order and returns `LaneWork`:

| module | owns |
|---|---|
| `setup.ts` | `Setup`: the project, lane configs and shared directories, the owner of your repo (`Setup.owner`, made from the project root once the line's names are read, before anything else reads your repo), the default-image check, the images and runtime (`ready`), `specOf`, the granted host paths (read once, lazily: the agent exists only after lane work), and the base snapshot's refreshes |
| `registry.ts` | `LaneRegistry`: each lane's handle, its jj, its record, whether it is a lane of its own; the only module that touches the handles |
| `containers.ts` | `access`, a container's start (`planContainer`, `planStartFrom`), `beforeRun`, `runEnded` |
| `fetch.ts` | a lane's history into your repo: the bundle on the lane's queue, the import an owner command (`importLane`) |
| `turns.ts` | pi's `turnDone`: the turn's revision, snapshot and fetch; the turn records still being written (`pendingRecords`). A lane is fetched into your repo only after a turn that commits, so a lane that never changed a file has no `tip@pinetrie-<lane>`, no refresh and no `pinetrie.base` until it catches up (a clean merge is fetched) |
| `create.ts` | a new lane: `checkDirectory`, its record and name, its fork (`forkFacts` waits for `pendingRecords`) |
| `update.ts` | an update (`withLaneStarted`, then one queued step, `planSettle` and `applySettle`); `catchUpInRun`, the agent's `catch_up`; `askedAboutConflict`, which asks jj for conflicts in the lane's copy |
| `split.ts` | a split's prompt, and its end (`finishSplit`) |
| `archive.ts` | a close's or a reopen's teardown (`planArchive`'s), off the documents' keeper |
| `disk.ts` | the snapshot on a lane's queue, and the lockfile's hash |

- **State lives where it changes.** What startup found is `Setup`'s, fixed
  after it. Each lane's handle is the registry's. Each coordination set is
  owned by the module that writes it, behind a function: `turns`' pending
  records, `base-news`' steers told.
- **One `turns` and one `updates`.** `index.ts` makes each once and builds
  pi's `hooks` from them, so a fork waits on the records this `turnDone`
  adds. A second instance would have its own set, and the fork would wait
  on the empty one.
- **The queues a lane's work crosses:** its own `LaneQueue` (the start, a
  fork, each turn's commit and snapshot, the bundle, the stop and trim); the
  owner of your repo, for the import (a command, queued as the bundle is
  made, so a lane's imports keep their order: the fetch forces its ref, and
  an older bundle imported after a newer one would move it back); and the
  base snapshot's keeper. Every read of your repo from lane work (an
  update's line and WIP, a new lane's begin and lockfile, the base
  snapshot's line, a split's stack) is a pinned read (`owner.read`), which
  waits on no queue.
- **An update is one step on the lane's `LaneQueue`** (`updateOnQueue`):
  the lane's base from its own history, the line and the WIP from your
  repo (pinned), `planUpdateFrom`, the edits committed and `mergeUpdate`
  (which first joins each integrated-offer commit the lane holds to its source, ADR-0079), so nothing
  changes the lane between what is read and what is merged. Before the
  merge, `planCatchUp` settles the floor a resolution's prompt must fit
  (ADR-0084), from the resolve-conflicts skill, read before the step, and
  the card's text: a catch-up whose smallest prompt would not fit is refused
  with the lane untouched, since a merge left without a prompt is one no
  later catch-up merges again (S106). Then
  `planSettle`, pure, decides what the thread gets, the land message
  included, and `applySettle` writes it. `Settle.fetch` alone decides
  what is fetched: a clean merge, and a move to the line with nothing to
  merge, whose mark your repo would otherwise learn of only at a later
  fetch. Its list is `fetchLane`'s `have`: commits your repo may hold,
  which the bundle leaves out.
- **A catch-up with the thread a thread branched from** (ADR-0072) is the
  same step: the card's command picks the rule. Its facts come from the
  lane's root document, not your repo (`parentNow`, with whether the
  parent's lane runs from `pinetrie:live`), and `planParentUpdate` decides;
  the parent's newest commit is fetched by id into the lane like the line's.
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

## Offers (`offers/`)

- **Every offer step runs on the owner of your repo** (`@pinetrie/repo`,
  `packages/repo/TECHNICAL.md`, ADR-0065). An offer action, a `line`
  command, a split's span and its end, and moving lanes' refs are owner
  commands; a refresh is upkeep, `later("refresh:<lane>")`, and the line's
  record `later("line")`. So a command waits for at most the one step
  running, however many refreshes are marked, and a lane marked many times
  before its refresh starts refreshes once.
- **What marks a lane** (`planMarks`, `marks.ts`, pure, from the owner's `onMoved`): a
  move of the line or a WIP, or the first observation (`all`), marks the
  line's record, every named lane whose root is not archived, and every
  open record; your `@` alone
  (`yours`, jjui and your editor) marks no lane: one `later("shared")` step
  rewrites each open record's `yourEdits` (its files that `@` changes,
  `planYourEdits`) and
  the line's record from the shared facts; a lane's
  ref (a fetch's import) marks that lane; an offer bookmark the lane its
  thread names. A run's end marks its lane, then describes it. A refresh
  that wrote is observed, and refreshes the lanes it moved once more: that
  one reads, plans `none`, and writes nothing, so it ends there. The record
  is only a hint of where to look: it is how an offer you abandoned by hand
  is built again. A bookmark of yours that no offer depends on moves
  nothing. Every named lane, not only those with an offer, so each lane's
  `pinetrie.base` follows the line, and with it what catching up would
  change. Not an archived root's lanes: they have no base to follow
  (`gatherRefresh` gives them none), and their refresh only withdraws an
  offer. What could still hold one marks such a lane anyway: its ref or its
  offer bookmark (the first observation reports every bookmark as moved),
  or an open record. That is safe because an untraced start, or what jj cannot say,
  builds nothing (ADR-0067): a thread integrated before offers carried
  `Pinetrie-Source` is not offered again (S97).
- **Reads are pinned and never queued:** a page's review or diff
  (`Offers.read`), a description's gather, and lane work's reads of your
  repo run at the head the owner last observed (`owner.read`). An offer
  integration gathers in its own command, unpinned, so it acts on the repo as it is.
- **The host decides nothing and runs no jj on an offer.** Each step is a
  gather (`@pinetrie/repo`: `gatherRefresh`, `gatherOffer`, `gatherOfferIntegration`,
  `gatherStack`, `gatherDescribe`), a decision (`@pinetrie/rules`: `planRefresh`,
  `planOfferIntegration`, `planRebuild`, `planStackEnded`, `planDescribeSettle`),
  a translation into steps (`@pinetrie/repo`: `offerEffects`, `offerIntegrationEffects`,
  `rebuildEffects`, `describeEffects`), and `executeOffer` (`execute.ts`),
  which carries out every action over ports: the lane's base record first,
  when it differs from the page's, then the steps, then what comes after
  (`OfferEffects.after`). So the rules are tested as values in the two
  packages, what the host writes is tested over `record<T>()`, and
  `packages/repo/repo.test.ts` proves the reads and steps against real jj.
- **What only the documents know is read here, first** (`state.ts`,
  `OfferDocs`): the thread's name, whether its root is archived (from its
  board place, `readArchived`, never from the lane's tip being missing: a tip missing
  for one import, S78, must not withdraw a live offer), the last catch-up
  read (`pinetrie.base`, a memo `readCatchUp` keeps at the same tip and base
  commit, never read to decide), the lane's tip entry and the WIP line.
  Everything else is read from your repo (ADR-0060), and where an offer
  sits is decided once there (`OfferPlace`): a WIP gone moves nothing and
  writes only its base record; an untraced start builds nothing, so squash,
  refresh, describe and a split's span refuse it, while an integration, a
  bookmark move, can still integrate an offer you edited there.
- **The records are written from the repo after each step**
  (`OfferRecords`): an offer's from the read made before planning when the
  step ran no steps (the common `none` reads nothing more), else from a new
  read; `withdraw` and `forget` remove it; an integration writes it marked
  integrated (`integratedAs`; a record from before ADR-0083 says `taken`,
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
- **An offer integration names the offer it was shown** (`OfferSeen`, ADR-0065): the
  ledger its record carried, and whether it conflicted, which the page's
  session client reads from the record as it sends (`offerSeen`).
  `planOfferIntegration` refuses `offer_changed` when the ledger now differs (its source, or its
  start as a set), or the offer conflicts now and did not then. A rebase
  onto a moved target and your edit keep the ledger, and are integrated.
- **An offer integration names its destination** (`planOfferIntegration`): one of
  `offerIntegrationDestinations`, and refused (`bad_destination`) unless the bookmark is
  at or below the offer's bottom's parent, read in the same command
  (`gatherOfferIntegration`). jj's
  refusal of a backwards move is the second guard (S77 item 1).
- **The `line` command** (`work/line.ts`, created by `startLaneWork` beside
  the offers, which rewrite its record when the owner observes the line or
  your `@` move): decided by `@pinetrie/rules` (`planLineAction`), its steps
  `@pinetrie/repo`'s. `setup` creates the line's bookmark at your `@-` and
  writes `immutable_heads()` and `revsets.log` to the repo's config, the
  text the publish button's setup showed (`planLineSetup`). A publish
  (ADR-0090) is two rounds of gather, plan and execute in one command: the
  catch-up (`planPublishCatchUp`, as you, only on the host's own machine
  and only when your files are behind), then the record read again, with
  the catch-up's operation from `SharedFacts.op`, decided by
  `planPublishFinish` into the move (`planPublishMove`) or the catch-up's
  undo (`planCatchUpUndo`) and a worded refusal. A move jj refuses after a
  catch-up runs the undo and rethrows: the one branch that is not a plan's
  value. The record's preview runs `git merge-tree` on your repo (the
  step's `git`). Setup, and a publish's moves of your files and commits,
  act on the repo as its owner: only a host that admits no one else does
  them (`lineCommands`: no invite key), since Kyneta does not say which
  connection a seat came over. Elsewhere setup is refused `not_yours`, and
  a publish moves the publish bookmark alone.
- **The base snapshot follows the line** (`work/index.ts`): the owner's
  `Moved.onto` refreshes it (`refreshBaseSoon`), so setup, an accept, an
  integrating publish and a move made in jj outside pine·trie all reach it
  by one path. An integration into a WIP does not, since the snapshot is
  the line's.
- **Shutdown closes the owner** (`LaneWork.owner`, the `close` step): it
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
  (`putValue(doc, setRecord(MARK, mark))`), and `writeLaneTip` a lane's tip; a
  running lane is `beginRun`. Both of those are `@pinetrie/schema`'s.
- **A port's writes are values.** Every record goes through one
  `writeValues` (ADR-0062), so a test asserts what was written:
  `expect(writesOf(agent.calls)).toEqual([deleteRecord(MARK, entry)])`.
  `applyWrites` is a fake `writeValues` that applies them to the document.
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
- **The integration is the suites'.** `e2e` and `e2e:browser` check the
  wiring; their mutations are in `scripts/mutations/app.ts`, and this
  directory's unit mutations in `scripts/mutations/host.ts`. The suites' own
  gotchas, and what their waits cost, are in `apps/pinetrie/e2e/TECHNICAL.md`.
