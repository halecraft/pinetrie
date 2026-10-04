# The host's shell: technical notes

The host gathers facts, calls the pure decisions in the packages
(`@pineta/marginalia`, `@pineta/reads`, `@pineta/schema`, `@pineta/lanes`),
and carries them out. This directory is that imperative shell. Each module
does one thing and takes its dependencies as a parameter; `index.ts` alone
wires them.

## Where things are

| module | owns |
|---|---|
| `index.ts` | `startHost`: the store, the Exchange (with its `resolve` for the documents clients create, `resolveDoc`), the documents, lane work and the agent, then the wiring below |
| `basics.ts` | `Basics` (the session, `pineta:live`, the documents, the places, log, ids, clock) and how a failure is logged (`messageOf`, `failed`) |
| `places.ts` | `applyPlaceSteps`: the one writer of the places document (ADR-0059), which writes its records in one batch, in an undo step when given one, then raises its `rev` in a batch of its own (`raiseRev`) |
| `move-history.ts` | each person's history of moves per root (ADR-0066): `MoveHistories`, a shell over Kyneta's undo stacks |
| `shutdown.ts` | the order a host stops in (`planShutdown`) |
| `runs.ts` | a run from its start to its end (`createRuns`, `planRunEnd`), and the agent's `onStream` (`streamInto`) |
| `take.ts` | taking a lane's queued cards (ADR-0048): `takeTop`, and `drain`, which sends each through its command (ADR-0055) |
| `settle.ts` | what happens between runs: drains, then the compaction and sweep as upkeep (the keeper's `later`) |
| `housekeeping.ts` | which documents a run's end compacts (`planCompaction`: its roots, the session, the places, `pineta:live`), deleting images nothing shows, and retiring histories of moves (`sweepHistories`) |
| `docs.ts` | `HostDocuments`: every document the host holds, a root's opened as it is asked for; `planLoads` |
| `directory.ts` | each root's directory record, refreshed as its document changes |
| `cards.ts` | the card port (ADR-0048), about texts only: who wrote in a card, destroying one, loading and reading texts for the take, and the texts of given cards gathered for the sweeps; where the shell opens card documents |
| `seats.ts` | each connected seat's person, written once as a `pineta.seat` record (started after `recover`), and unloading the histories of moves of a person with no seat left |
| `startup.ts` | `carryPlacesOver` (the places stored before ADR-0066, once) and `recover`: what a starting host does before it takes a command |
| `control.ts` | the command Line of each client seat, and who its writer is |
| `commands/` | one module per command: `chat`, `archive`, `mark`, `lane` (stop, offer), `cards` (a move, an undo of moves, a command, a busy chat's card queued, a sent card spent: ADR-0059, ADR-0066); `index.ts` decodes, decides where it runs (`placeOfCommand`), checks the archive, routes, and sends a taken card behind the same check (`sendTaken`) |
| `http.ts` | the HTTP server: admission, Vite, the websocket, blobs, offer reads, invites |
| `responses.ts` | every answer the host writes itself, as a pure `HttpAnswer` |
| `routes.ts` | what a request or an upgrade gets, pure: admission first (`planRequest`, `planUpgrade`), then which requests are the host's (`route`) |
| `hot-reload.ts` | Vite's hot updates, held while a direct lane in the project runs |
| `admission.ts`, `policy.ts`, `lines.ts`, `blobs.ts`, `store.ts` | the invite key and links, the write policy, departed seats, the image store, the SQLite store |
| `work/` | lane containers and disks (§ Lane work) |
| `offers/` | each lane's offer in your repo, on the owner of your repo (§ Offers) |
| `names.ts` | every thread's name (ADR-0039): `ensure` for the lanes pi holds, `reserve` for a lane id a column reserved before its lane exists (ADR-0057), on one queue |
| `banners.ts` | each thread's column banner (ADR-0050, ADR-0053): made as the thread is named, at reservation or creation, set by `set_banner` |
| `digests.ts` | each ask's digest (ADR-0056), when the user config turns them on |
| `outside.ts` | `requestOutside`: a model request outside a keeper, its answer written in a step of its own |
| `fakes.ts` | test support: `record<T>()`, `fakeLane`, `row`, `putValue` and `applyWrites` (each write to the document its target names), `writesOf`, `basics` (one root, `ROOT_ID`, in `fakeDocuments`), `putLane`, `writeDirectory` |

## The documents' keeper

- **Every command but your repo's is a step on one keeper**, and so is every
  drain (`@pineta/keeper`, `packages/keeper/TECHNICAL.md`, keyed by
  `HostKey` in `basics.ts`). Where a command runs is decided, pure, by
  `placeOfCommand` (`commands/index.ts`, ADR-0065): an offer action but a
  split, and a `line` command, go straight to the owner of your repo after
  the archive gate (a synchronous read), and hold no other command; an
  archive is three parts (`commands/archive.ts`): its record on the keeper,
  its teardown (containers, refs through the owner, snapshots) off it,
  tracked, and its unload on the keeper again, the reply after all three.
  Between the record and the unload, the gate refuses any write into the
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
  that waited or ran over a second is logged too (`onSlow`).
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

## A run's end

`planRunEnd(role)` returns the order, and `runs.ts` carries it out: a
resolution's `landingEnded` or a split's `splitEnded`, then `endRun`,
`laneStopped`, `ended`. A run touches no tools: every lane's list is the
same for every run (`packages/pi/TECHNICAL.md`, S85).

- **`endRun` comes before `laneStopped` and `ended`.** It closes the lane's
  streams (ADR-0044: a stream stays open past its message's end) and clears
  its active run. `laneStopped` is lane work's `runEnded`: the container
  stops, and the offer is refreshed. `ended` runs hot reload, whose pause
  reads which lanes run, and drains the lane; a drain that ran before
  `endRun` could start the next run with the last one's reply still open.
- **A failure before `endRun` is logged as `run end failed`,** and `endRun`
  and every step after it still run.
- **`ended` is one function, set once** in `startHost`: hot reload, then
  `settle`, banners and the final digest. It breaks a cycle: a run's end
  drains, the drain may run an update, and an update may start a run.
  `runs.ts` imports neither the take nor the commands.
- **`ended` is given the run's prompt**, read at the start of `end()`,
  before any step. A listener uses it, never the lane's tip: `settle`'s
  drain is queued first, and takes a queued card or starts the next run
  before any step queued after it reads the lane. pi reports no prompt id,
  and the lookup gives the same answer as pi's own end tip (S71).

## The session's documents (`docs.ts`, `directory.ts`, ADR-0063)

- **`Basics.docs` is the one port for documents** (`HostDocuments`): the
  session's, `pineta:live`, the places, a root's by its `RootId` (opened and
  hydrated if it is not), a loaded root's `RootView`, a lane's root from its
  `LANE` record, and `unload`. A synchronous step plans from `view` and
  `docOfLane`, which answer only for a loaded root; an async one asks
  `root` or `laneDoc`.
- **A starting host opens the roots `planLoads` names**: every root in the
  directory that is not archived, before `recover`. A busy root cannot be
  archived, so these hold every lane a crash could have interrupted.
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
  `readRootRecord` with `setIfChanged`. A settle's compaction is `later`, so
  it runs after every refresh queued before it starts, and the records it
  compacts are current. A write after a compaction only lands in the next
  one's log.
- **A command names its root** (`Command.root`, ADR-0063): a chat or a mark
  writes in it, and a chat at the root starts it, under the id the sender's
  tab minted, refused `root_taken` when the directory holds it already.

## Startup

Before `recover`, `carryPlacesOver` carries the places stored before
ADR-0066 (`pineta:places`, `json`) into the Yjs document, once
(`planPlacesCarryOver`): it writes the rows, flushes, then destroys the old
document, so a crash at any step leaves it to carry over at the next start.
A fresh card stored then has no root, and is dropped. After `recover`,
`sweepHistories` retires the histories of moves no one will undo again (§
Moves' history).

`recover` runs, in order: `clearStreams` (no stream survives a process), a
log of the stored lane names, in the roots opened, that fail `isLaneName`
(`readStoredLanes`: no reader is given them, so the log is where one shows;
it never throws, and nothing is deleted), `ensureNames` (ADR-0039),
`planStartup` over the queued cards and `interrupted(roots)`, each
interrupted lane resumed before anything waiting for it (S36 item 18), the
project and commands records that changed in one write (`setIfChanged`),
the sweep of what no one will type in again: empty cards, card documents
with no record, and seat records no stored text names, all of them in one
write (`sweepTexts`), and last `settle` for the lanes with cards queued:
its compaction is `later`, so it runs after every write above, and after
any refresh they queued.

- **Commands are taken only after `recover`.** `Control.listen` is made
  earlier, and `startControl` registers `onReceive` after `recover`. Earlier,
  a new message could run before an interrupted lane resumed, and jump a
  queued card.
- **The agent, lane work and banners are made in a cycle.** Lane work and
  banners are made first and read the agent lazily (`theAgent()`), because
  the agent is made with lane work's `access` and `hooks` and banners'
  `request`. Those are the only lazy reads: every module made after the
  agent is given the agent. The documents' keeper is made before them, for banners.

## Shutdown

`planShutdown` (`shutdown.ts`) returns the order, and `shutdown()` carries
it out, each step in its own `try`: `intake` (seats, control), `close` (the documents' keeper and the owner of your repo, which stops its watch), `quiet`, `agent`,
`work` (the containers), `exchange`, `server`.

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
- **The archive gate is in the dispatcher** (`refuseInArchive`). Only the
  `chat` command and `sendTaken` call `sendChat`, both behind the gate, so
  `sendChat` has no gate of its own.
- **A message sent from a card spends it** (ADR-0048): `sendChat` names the
  card's other writers as contributors, through the card port, and spends
  nothing. The dispatcher's `chat` case spends the card when the answer
  takes its text (`spendsCard`: `appended` or `started`): the record goes,
  then the text, and the reply carries the places' `rev`. Sent from a fresh
  column, the spend first moves the column's other cards to drafting at the
  message it wrote (`planFreshFollow`, found by the send's id), in the same
  step, so no move gets between. The take destroys
  a taken card's text itself, since it removed the record. The command's
  text is what is sent: the text its sender saw.
- **A busy lane answers a chat from a card `queued`** (ADR-0059): the
  dispatcher queues the card behind the others in the same step
  (`queueBusy`), so no other send gets between. A chat with no card, or one
  whose card the host does not hold, still answers `busy`.
- **Every write to the places goes through `applyPlaceSteps`** (`places.ts`):
  every record in one batch, then `rev` raised in a batch of its own. A
  client draws a move it sent until its copy reaches the `rev` the reply
  carried (`packages/client/card-moves.ts`), so a write that skipped `rev`
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
- **`undo-move` undoes or redoes the sender's newest move in a root**
  (§ Moves' history). It answers `undone` with each card it moved and its
  place now, `unmoved` (shaped as a refused move) when someone moved a card
  since, or `nothing`.
- **Your inventory is a client's document the host only keeps**
  (ADR-0059). `resolveDoc` interprets `inventory:<writer>` as
  `InventoryDoc`; the policy shares it only with the peers whose principal
  is that writer (`holdsInventory`), and who may write it is the
  protocol's (`writersPolicy`, below). Kyneta fires
  `resolve` only for a peer `canShare` grants (S76), so nobody else can
  create someone's inventory. The host never writes one: it decides only
  whose inventory a card is in, and refuses a nineteenth card without
  knowing the slots.
- **Who may write a document is declared once, on every peer**
  (`writersPolicy`, `@pineta/protocol/writers`, Kyneta's `canWrite`): the
  session and the places only the host; an inventory its person, and the
  host, which relays it between that person's tabs (Kyneta judges the
  sender, not the author). The host registers it beside `hostPolicy`, and
  `connectSession` on every client, so a client's write to a document it
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
  host's own writes (a take, a spend, an unsent card, a fresh column's
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

## The queue (`take.ts`, ADR-0048, ADR-0055)

- **The take is one synchronous step** (`takeTop`): read that the card is
  queued and on top, read its text, remove its record (raising `rev`). A
  move and a drain are steps on one keeper, so an unqueue lands before the
  take or after it, never between: before, the card is not taken; after, the
  unqueue is refused `gone`, and its client says "already sent" (S69).
- **`drain` loads each queued card's text before the take** (`hydrate`),
  and checks again after every wait, so a card queued while texts load is
  loaded too. `textNow` then reads a text with no wait.
- **The take waits for the text its queuer had** (S96). Kyneta keeps no
  order between documents, so a card's record can arrive before its text.
  The record carries the text's version (`seen`); a top card the host's
  copy does not yet hold is `behind`, and stays on top, and the host drains
  the lane again once it holds it (`CardPort.whenHolds`, one wait per card).
- **A taken card is sent through its command.** `bring-up-to-date` runs
  `prepareUpdate` first: clean, the update is written, then the text, if
  any, is sent; conflicted, the resolution run carries the text; nothing
  new, the text alone; refused, the card goes back. The text is sent through
  `sendTaken` in mode `queue`, as its queuer (`by`), with the card's other
  writers as contributors. A card with no text starts no run.
- **A card the host could not send goes back below the line, whole**
  (`planUnsent`): drafting where it was queued, saying why, and never queued
  again, or the next drain would fail the same way (S69, answer 5). Its text
  is kept. After a clean update its command is cleared: it was carried out.
  An update or a send that throws writes the card back the same way, saying
  the host failed: the take has deleted its record, so nothing else would.
- **Three things drain a lane:** a run's end (`settle`), startup
  (`recover`), and a move that leaves a card queued on it while it is not
  running (`queueDrain` in `index.ts`). All three are the keeper's `once`
  (`drain:<lane>`): queued once until its step starts, the same step for
  all three; a move while it runs queues one more, which finds what the
  running one missed, or nothing. `runs.start` marks a lane
  running at once (`beginRun`), so a drain behind a started run takes
  nothing.
- **`executeChat` still checks a new lane's directory and asks pi for the
  lane.** Both are ports that may refuse, not facts to gather. The directory
  is checked first, so a refused send creates no lane.
- **The new lane's id is decided before that, in `planChat`** (ADR-0057).
  `sendChat` gathers `newLane` beside `sendId`: the column's reserved id,
  the lanes pi holds, and a spare made with `newId`. pi makes no ids.
- **`reserve` is answered `reserved`** whether it named the id or the id
  had a name already, so a column may send it again; an id pi holds is
  refused `lane_taken`.
- **Stop records who pressed it before it aborts** (ADR-0056): `planStop`
  gives the `pineta.stop` record for the running ask's prompt, unless one is
  there, and `handleStop` writes it, then asks pi to abort, in one step. So
  the record is there when the run's end is drawn, and the first press is
  the one named.

## Requests outside the queue (`outside.ts`)

A model request takes seconds, and no command may wait on it. Banners,
commit messages and digests ask with `requestOutside`: the request runs
outside the documents' keeper, tracked so `quiet` waits for it, and its
answer is written in a step of its own (a keeper step, or for a commit
message an owner command), after that step decides it is still wanted (`bannerStillWanted`, the offer's checks, `digestStillWanted`). A
failure is logged, never thrown. With `held`, a key is in a set while the
request is out, for the caller's plan to read (`bannerDue`, `digestDue`).

## Digests (`digests.ts`, ADR-0056)

- **Asked on events, each naming an entry**: the tip the lane's `turnDone`
  hook is given (wrapped in `startHost` after lane work records the turn),
  and the prompt each run's end is given. The ask is `promptOf` that entry,
  which never changes: entries are written once (ADR-0004). `Digests` takes
  no lane, so it cannot read a lane's tip. At a run's end the tip is
  already past the ask: a plain queued card taken there would lose the
  ask its final digest, and a next run with work would take it, which then
  refuses that run every later digest.
- **`planDigest` decides** in one step, from the stored digest, the request
  out, and presence: the host holds the presence document, and `readsAsk`
  reads its `reading` ends (S70).
- **Only the ask goes out**: its message, worded from its prompt entry so a
  land or stack ask is named too, its run's messages read up from the run's
  last entry, newest first within the budget, and the last digest. No agent
  reads the answer.
- A missing `ask-digest` skill is logged, and nothing is asked.

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

## HTTP

- **Admission comes first**, for a request and for an upgrade. Nothing
  reaches Vite, the blobs, an offer's reads or the Exchange without it.
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
| `turns.ts` | pi's `turnDone`: the turn's revision, snapshot and fetch; the turn records still being written (`pendingRecords`) |
| `create.ts` | a new lane: `checkDirectory`, its record and name, its fork (`forkFacts` waits for `pendingRecords`) |
| `update.ts` | an update (`withLaneStarted`, then one queued step, `planSettle` and `applySettle`), and a resolution's outcome, with the guidance flag pi's hook sets |
| `split.ts` | a split's prompt, and its end (`finishSplit`) |
| `archive.ts` | an archive's or a restore's teardown (`planArchive`'s), off the documents' keeper |
| `disk.ts` | the snapshot on a lane's queue, and the lockfile's hash |

- **State lives where it changes.** What startup found is `Setup`'s, fixed
  after it. Each lane's handle is the registry's. Each coordination set is
  owned by the module that writes it, behind a function: `turns`' pending
  records, `update`'s guidance flag.
- **One `turns` and one `updates`.** `index.ts` makes each once and builds
  pi's `hooks` from them, so a fork waits on the records this `turnDone`
  adds, and `landingEnded` reads the flag this `askedForGuidance` sets. A
  second instance would have its own set, and the fork would wait on the
  empty one.
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
  repo (pinned), `planUpdateFrom`, the edits committed and `mergeUpdate`, so nothing
  changes the lane between what is read and what is merged. Then
  `planSettle`, pure, decides what the thread gets, the land message
  included, and `applySettle` writes it. `Settle.fetch` alone decides
  what is fetched: a clean merge, and a move to the line with nothing to
  merge, whose mark your repo would otherwise learn of only at a later
  fetch. Its list is `fetchLane`'s `have`: commits your repo may hold,
  which the bundle leaves out.
- **An update stops the lane it started** (`withLaneStarted`), whatever it
  comes to, unless a resolution runs: that run's end stops it. A split
  reads its skill before `beforeRun`, so nothing between the lane's start
  and its run can fail.
- **A lane's `LaneQueue` breaks on a fatal failure and the host's keepers
  do not.** A failed start or fork must stop the lane's tools, which wait on
  its queue; a failed host step must not stop the steps behind it.

## Offers (`offers/`)

- **Every offer step runs on the owner of your repo** (`@pineta/repo`,
  `packages/repo/TECHNICAL.md`, ADR-0065). An offer action, a `line`
  command, a split's span and its end, and moving lanes' refs are owner
  commands; a refresh is upkeep, `later("refresh:<lane>")`, and the line's
  record `later("line")`. So a command waits for at most the one step
  running, however many refreshes are marked, and a lane marked many times
  before its refresh starts refreshes once.
- **What marks a lane** (`planMarks`, pure, from the owner's `onMoved`): a
  move of the line or a WIP, or the first observation (`all`), marks the
  line's record, every named lane and every open record; your `@` alone
  (`yours`, jjui and your editor) marks no lane: one `later("shared")` step
  rewrites each open record's `yourEdits` (its files that `@` changes) and
  the line's record from the shared facts; a lane's
  ref (a fetch's import) marks that lane; an offer bookmark the lane its
  thread names. A run's end marks its lane, then describes it. A refresh
  that wrote is observed, and refreshes the lanes it moved once more: that
  one reads, plans `none`, and writes nothing, so it ends there. The record
  is only a hint of where to look: it is how an offer you abandoned by hand
  is built again. A bookmark of yours that no offer depends on moves
  nothing. Every named lane, not only those with an offer, so each lane's
  `pineta.base` follows the line, and with it what catching up would
  change. That is safe because an untraced start, or what jj cannot say,
  builds nothing (ADR-0067): a thread taken before offers carried
  `Pineta-Source` is not offered again (S97).
- **Reads are pinned and never queued:** a page's review or diff
  (`Offers.read`), a description's gather, and lane work's reads of your
  repo run at the head the owner last observed (`owner.read`). A take
  gathers in its own command, unpinned, so it acts on the repo as it is.
- **Each step carries out a pure plan** (`offers/plan.ts`): `planRefresh`
  (marginalia) picks the branch, `planOfferEffects` says what it runs and
  writes, `offerRecord` builds the record, and `planTake` a take.
  `execute.ts` carries them out over ports (`executeOffer`, `executeTake`).
  So the offers' rules are tested as values, and what a plan makes the host
  write is tested over `record<T>()`; `packages/repo/repo.test.ts` proves
  the jj steps themselves against real jj.
- `refresh.ts` builds and records, and carries out a refresh; `describe.ts`
  gathers by a pinned read (the offer, its diff, your recent messages), asks
  the model outside the owner, one request per lane at a time
  (`describing`), and writes in an owner command; `act.ts` and `stack.ts`
  are the actions and a split's stack.
- **The host decides an offer only from your repo** (ADR-0060), and the
  archive. A refresh gathers with `refreshNow`: for a thread whose root is
  archived, only its offer, read against the line; else `offerNow`'s facts
  and whether the lane's work changes any file (`workChanges`). A place
  whose start is untraced, or whose WIP is gone, is no `Placed`
  (`placedOf`): nothing is built from it, so squash, refresh, describe and
  a split's span refuse it. A take needs no start (a bookmark move), so an
  offer you edited on an untraced lane can still be taken. Archived
  is read from the archive record, not from the lane's tip being missing:
  a tip missing for one import (S78) must not withdraw a live offer. One gather,
  `offerNow`, reads where it sits and starts (`placeOf`: its base from the
  lane's newest `Pineta-Base`, its target the line's commit or the WIP's,
  its start `startOfOffer`) and the offer itself (`readOffer`). Refresh,
  take, squash, describe and a split's replacement all plan from it.
  **`placeOf` reads, and writes nothing:** it reads the stored
  `pineta.base` only as a memo of what catching up changes
  (`knownCatchUp`, `readCatchUp`), never to decide; the lane's
  `pineta.base` cache, with that and its untraced takes, is among the writes `planOfferEffects` and `planTake` plan
  (`baseWrites`, `setIfChanged`), so a gather can run pinned, outside the
  owner's queue. A WIP gone without landing writes only its base record.
  `OfferState` has no record reader: `write` compares with the stored
  record only to skip a write that changes nothing.
- **A record is written from the repo after each step** (`executeOffer`):
  from the read made before planning when the plan ran no steps (the
  common `none` reads nothing more), else from a new read. `withdraw` and
  `forget` remove it, and `OfferState.remove` skips a record that is not
  there. A refresh with no place (an archived thread) plans only those two;
  the ports that need a place reject if reached without one.
- **A root archived or restored moves its lanes' refs in an owner
  command** (`Offers.moveLanes`, called by `work/archive.ts`), then marks
  each lane: an archived thread's offer is withdrawn, a restored one's built
  again (ADR-0061).
- **A take names the offer it was shown** (`OfferSeen`, ADR-0065): the
  ledger its record carried, and whether it conflicted, which the page's
  session client reads from the record as it sends (`offerSeen`). `planTake`
  refuses `offer_changed` when the ledger now differs (its source, or its
  start as a set), or the offer conflicts now and did not then. A rebase
  onto a moved target and your edit keep the ledger, and are taken.
- **A take names its destination** (`planTake`): one of
  `takeDestinations`, and refused (`bad_destination`) unless the bookmark is
  at or below the offer's bottom's parent, read in the same step. jj's
  refusal of a backwards move is the second guard (S77 item 1).
- **The `line` command** (`offers/line.ts`): `setup` creates the line's
  bookmark at your `@-` and writes `immutable_heads()` and `revsets.log`
  to the repo's config, the text the header's menu showed; `land` moves the line to your
  `@-`, as you; `follow` rebases your work onto the line, as you
  (`planFollow`, ADR-0061), only while the record it plans from has a
  preview (`yours.follow`): the one you were shown. The record's preview
  runs `git merge-tree` on your repo (the step's `git`). Only a host that admits no one else takes it
  (`lineCommands`: no invite key), since all three act on the repo as its owner;
  Kyneta does not say which connection a seat came over. Others are refused
  `not_yours`.
- **Shutdown closes the owner** (`LaneWork.owner`, the `close` step): it
  refuses every step from then on and stops its watch; `quiet` waits for
  what it holds (`LaneWork.quiet`).

## Testing the shell

- **Test a decision as a value** where the shell has one: `planRunEnd`,
  `planInvites`, `draftSent`, the responses, `planSettle`, and marginalia's
  `planStartup`.
- **Otherwise, drive a module with `record<T>()`** for exactly the port it
  takes, and a real `newSessionDoc()`. A method the test did not give throws,
  naming itself, so a module that touches an undeclared port fails at once.
  `fakeLane` holds a run open until the test finishes it. `row` and
  `writeEntry` put entries in the document, `putValue` a host record
  (`putValue(doc, setRecord(MARK, mark))`), and `writeLaneTip` a lane's tip; a
  running lane is `beginRun`. Both of those are `@pineta/schema`'s.
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
  - `marginalia/chat.ts`'s `attributed`: the model is told who spoke, which
    shows that pi's conversion sends `content`;
- **Tests in subdirectories run**: `vitest.config.mjs` includes
  `apps/*/host/**/*.test.ts`.
- **The integration is the suites'.** `e2e` and `e2e:browser` check the
  wiring; their mutations are in `scripts/mutations/app.ts`, and this
  directory's unit mutations in `scripts/mutations/host.ts`. The suites' own
  gotchas, and what their waits cost, are in `apps/pineta/e2e/TECHNICAL.md`.
