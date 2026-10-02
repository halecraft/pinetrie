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
| `basics.ts` | `Basics` (doc, places, log, ids, clock) and how a failure is logged (`messageOf`, `failed`) |
| `places.ts` | `applyPlaceStep`: the one writer of the places document (ADR-0059), which raises its `rev` with every write |
| `queue.ts` | `createSerial`: the one serial executor, which a shutdown closes |
| `shutdown.ts` | the order a host stops in (`planShutdown`) |
| `runs.ts` | a run from its start to its end (`createRuns`, `planRunEnd`), and the agent's `onStream` (`streamInto`) |
| `take.ts` | taking a lane's queued cards (ADR-0048): `takeTop`, and `drain`, which sends each through its command (ADR-0055) |
| `settle.ts` | what happens between runs: drain, then compact and sweep |
| `housekeeping.ts` | compacting the session and the places, and deleting images nothing shows |
| `cards.ts` | the card port (ADR-0048), about texts only: who wrote in a card, destroying one, loading and reading texts for the take, and the texts of given cards gathered for the sweeps; where the shell opens card documents |
| `seats.ts` | each connected seat's person, written once as a `pineta.seat` record (started after `recover`) |
| `startup.ts` | `recover`: what a starting host does before it takes a command |
| `control.ts` | the command Line of each client seat, and who its writer is |
| `commands/` | one module per command: `chat`, `archive`, `mark`, `lane` (stop, offer), `cards` (a move, a command, a busy chat's card queued, a sent card spent: ADR-0059); `index.ts` decodes, checks the archive, routes, and sends a taken card behind the same check (`sendTaken`) |
| `http.ts` | the HTTP server: admission, Vite, the websocket, blobs, offer reads, invites |
| `responses.ts` | every answer the host writes itself, as a pure `HttpAnswer` |
| `routes.ts` | what a request or an upgrade gets, pure: admission first (`planRequest`, `planUpgrade`), then which requests are the host's (`route`) |
| `hot-reload.ts` | Vite's hot updates, held while a direct lane in the project runs |
| `admission.ts`, `policy.ts`, `lines.ts`, `blobs.ts`, `store.ts` | the invite key and links, the write policy, departed seats, the image store, the SQLite store |
| `work/` | lane containers and disks (§ Lane work) |
| `offers/` | each lane's offer in your repo (§ Offers) |
| `names.ts` | every thread's name (ADR-0039): `ensure` for the lanes pi holds, `reserve` for a lane id a column reserved before its lane exists (ADR-0057), on one queue |
| `banners.ts` | each thread's column banner (ADR-0050, ADR-0053): made as the thread is named, at reservation or creation, set by `set_banner` |
| `digests.ts` | each ask's digest (ADR-0056), when the user config turns them on |
| `outside.ts` | `requestOutside`: a model request outside the serial executor, its answer written inside it |
| `fakes.ts` | test support: `record<T>()`, `fakeLane`, `row`, `putValue`, `basics` |

## One serial executor

- **Every command and drain step is a step on one `Serial`**
  (`queue.ts`). A step gathers, plans and executes with nothing in between,
  so its plan is still true when it is carried out: with one host, this is
  what makes "a late message goes after" and "a busy lane holds" hold. A run
  is started inside a step and continues outside it, so one long run never
  blocks another thread's commands.
- **A failed step never stops the steps behind it.** The tail swallows the
  failure and reports it (`[host] step failed: …`); the step's own caller
  still gets the rejection. `@pineta/lanes`' `createQueue` is the opposite: a
  fatal failure breaks it until `reset`, which a lane's disk needs and a host
  step must not have.
- **Voiding `serial.run`'s promise is safe; awaiting it in a voided function
  is not.** The tail's `.catch` is attached to the very promise `run`
  returns, so a voided one is handled. An `await` of it inside an async
  function whose own promise is voided throws there, and that function's
  promise rejects unhandled, which ends the process. So the command loop
  (`control.ts`) voids each step: an await there would end a seat's
  commands at the first one that throws.
- **A failed drain is logged against its lane** (`settle.ts`), and the
  settle still drains the other lanes, compacts and sweeps. A throw there
  would also leave `compactionQueued` set, and no later settle would compact.
- **A closed `Serial` refuses new steps and finishes the ones it holds.**
  `run` then rejects with `SerialClosed`, already handled, so voiding it is
  still safe, and `failed()` logs nothing for it: a refusal during shutdown
  is expected. A step refused then is lost without harm: a queued card stays
  queued for the next host, and a refresh or a description runs again at the
  next trigger.
- **`RunningHost.quiet()`** is `serial.idle()`, then lane work's `quiet()`,
  then `exchange.flush()`. The suites await it before they check, so any
  background promise must be a `serial.run` or `serial.track`, or `quiet`
  resolves early and the suites turn flaky rather than failing.

## A run's end

`planRunEnd(role)` returns the order, and `runs.ts` carries it out:
`guidanceOff`, then a resolution's `landingEnded` or a split's
`splitEnded`, then `endRun`, `laneStopped`, `ended`.

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

## Startup

`recover` runs, in order: `clearStreams` (no stream survives a process), a
log of the stored lane names that fail `isLaneName` (`readStoredLanes`: no
reader is given them, so the log is where one shows; it never throws, and
nothing is deleted), `ensureNames` (ADR-0039), `planStartup` over the queued cards and `interrupted()`,
each interrupted lane resumed before anything waiting for it (S36 item 18),
`settle` for the other lanes with cards queued, the values an older host
left in `pineta.outbox` deleted and each one's text logged, the project and commands
records written only when changed, and the sweep of what no one will type in
again: empty cards, card documents with no record, and seat records no stored
text names (`sweepTexts`).

- **Commands are taken only after `recover`.** `Control.listen` is made
  earlier, and `startControl` registers `onReceive` after `recover`. Earlier,
  a new message could run before an interrupted lane resumed, and jump a
  queued card.
- **The agent, lane work and banners are made in a cycle.** Lane work and
  banners are made first and read the agent lazily (`theAgent()`), because
  the agent is made with lane work's `access` and `hooks` and banners'
  `request`. Those are the only lazy reads: every module made after the
  agent is given the agent. The `Serial` is made before them, for banners.

## Shutdown

`planShutdown` (`shutdown.ts`) returns the order, and `shutdown()` carries
it out, each step in its own `try`: `intake` (seats, control), `close` (the host's `Serial` and the offers'), `quiet`, `agent`,
`work` (the containers), `exchange`, `server`.

- **The queues close before `quiet`.** `quiet` waits only for what is queued
  when it looks. A step started after it (an offer refresh from the 2 s poll
  or a lane's fetch, a drain from a command) writes to a closing agent and
  document: its jj steps land and its record is lost (S73).
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
  then the text, and the reply carries the places' `rev`. The take destroys
  a taken card's text itself, since it removed the record. The command's
  text is what is sent: the text its sender saw.
- **A busy lane answers a chat from a card `queued`** (ADR-0059): the
  dispatcher queues the card behind the others in the same step
  (`queueBusy`), so no other send gets between. A chat with no card, or one
  whose card the host does not hold, still answers `busy`.
- **Every write to the places goes through `applyPlaceStep`** (`places.ts`),
  which raises `rev` in the same batch. A client draws a move it sent until
  its copy reaches the `rev` the reply carried (`packages/client/card-moves.ts`),
  so a write that skipped `rev` would leave a move drawn over a record that
  had changed.
- **`move` and `set-command` are handoffs** (`commands/cards.ts`): gather
  the places and whether the lane runs, plan (`planMoveCommand`,
  `planSetCommand`), then write. An accepted move answers `moved` with its
  `rev`; a refusal answers `unmoved` with its code, where the card is now,
  who put it there, and the current `rev`. A move that leaves a card queued
  on a lane that is not running queues the lane's drain, a voided
  `serial.run` behind the move's own step.

## The queue (`take.ts`, ADR-0048, ADR-0055)

- **The take is one synchronous step** (`takeTop`): read that the card is
  queued and on top, read its text, remove its record (raising `rev`). A
  move and a drain are steps on one `Serial`, so an unqueue lands before the
  take or after it, never between: before, the card is not taken; after, the
  unqueue is refused `gone`, and its client says "already sent" (S69).
- **`drain` loads each queued card's text before the take** (`hydrate`),
  and checks again after every wait, so a card queued while texts load is
  loaded too. `textNow` then reads a text with no wait.
- **The take waits for the text its queuer had** (S72). Kyneta keeps no
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
  running (`queueDrain` in `index.ts`). A lane's drain is queued once until
  its step starts; a move while it runs queues one more, which finds what the
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
outside the serial executor, tracked so `quiet` waits for it, and its
answer is written in a step of its own, after that step decides it is still
wanted (`bannerStillWanted`, the offer's checks, `digestStillWanted`). A
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

- **A decision is one `Serial` step**: gather the lane's banner, whether one
  is being made and whether a blob is stored; `bannerDue` or `planAsk`;
  write a pasted image. A new image is a `serial.track`ed task: the image takes seconds,
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
| `setup.ts` | `Setup`: the project, lane configs and shared directories, the browser check, the images and runtime (`ready`), `specOf`, the granted host paths (read once, lazily: the agent exists only after lane work), and the base snapshot's refreshes |
| `registry.ts` | `LaneRegistry`: each lane's handle, its jj, its record, whether it is a lane of its own; the only module that touches the handles |
| `containers.ts` | `access`, a container's start (`planContainer`, `planStartFrom`), `beforeRun`, `runEnded` |
| `fetch.ts` | a lane's history into your repo, each lane's fetches on a `Serial` of its own |
| `turns.ts` | pi's `turnDone`: the turn's revision, snapshot and fetch; the turn records still being written (`pendingRecords`) |
| `create.ts` | a new lane: `checkDirectory`, its record and name, its fork (`forkFacts` waits for `pendingRecords`) |
| `update.ts` | an update (`applyClean` for a clean one), and a resolution's outcome, with the guidance flag pi's hook sets |
| `split.ts` | a split's prompt, and its end (`finishSplit`) |
| `archive.ts` | a root archived or restored |
| `disk.ts` | the snapshot on a lane's queue, and the lockfile's hash |

- **State lives where it changes.** What startup found is `Setup`'s, fixed
  after it. Each lane's handle is the registry's. Each coordination set is
  owned by the module that writes it, behind a function: `turns`' pending
  records, `update`'s guidance flag, `fetch`'s queues.
- **One `turns` and one `updates`.** `index.ts` makes each once and builds
  pi's `hooks` from them, so a fork waits on the records this `turnDone`
  adds, and `landingEnded` reads the flag this `askedForGuidance` sets. A
  second instance would have its own set, and the fork would wait on the
  empty one.
- **The queues a lane's work crosses:** its own `LaneQueue` (the start, a
  fork, each turn's commit and snapshot, the bundle, the stop and trim); its
  fetch `Serial` (your repo's fetch, which tools never wait on); the base
  snapshot's `Serial`; and the offers' queue for your repo.
- **A lane's `LaneQueue` breaks on a fatal failure and the host's `Serial`s
  do not.** A failed start or fork must stop the lane's tools, which wait on
  its queue; a failed host step must not stop the steps behind it.

## Offers (`offers/`)

- **One `Serial` for your repo, in `OfferState`,** carries every offer
  operation, take and read, so no two interleave. A read waits there too,
  since a jj read can write (S57).
- **Each step carries out a pure plan** (`offers/plan.ts`): `planRefresh`
  (marginalia) picks the branch, `planOfferEffects` says what it runs and
  writes, `offerRecord` builds the record, and `planTake` a take.
  `execute.ts` carries them out over ports (`executeOffer`, `executeTake`).
  So the offers' rules are tested as values, and what a plan makes the host
  write is tested over `record<T>()`; `packages/lanes/lanes.test.ts` proves
  the jj steps themselves against real jj.
- `refresh.ts` builds and records, and carries out a refresh; `describe.ts`
  asks the model outside the queue and writes inside it; `act.ts`,
  `stack.ts` and `watch.ts` (`planPoll`) are the actions, a split's stack
  and your jj operations.
- **Where an offer sits and starts is read from the repo** (`placeOf`,
  ADR-0060): its base from the lane's newest `Pineta-Base`, its target the
  line's commit or the WIP's, its start `startOfOffer`. `placeOf` writes the
  lane's `pineta.base` cache as it reads it.
- **A take names its destination** (`planTake`): one of
  `takeDestinations`, and refused (`bad_destination`) unless the bookmark is
  at or below the offer's bottom's parent, read in the same step. jj's
  refusal of a backwards move is the second guard (S77 item 1).
- **The `line` command** (`offers/line.ts`): `setup` creates the line's
  bookmark at your `@-` and writes `immutable_heads()` and `revsets.log`
  to the repo's config, the text the header's menu showed; `land` moves the line to your
  `@-`, as you. Only a host that admits no one else takes it
  (`lineCommands`: no invite key), since both act on the repo as its owner;
  Kyneta does not say which connection a seat came over. Others are refused
  `not_yours`.
- **A new jj operation refreshes the line's record** and touches every open
  offer (`planPoll`), so a land or a take moves every offer on the line.
- **The first poll touches every open offer.** A host that just started
  checks each one, so a record its predecessor lost (S73) is corrected before
  you can take the offer.
- **`Offers.stop()`** closes the poll and the offers' `Serial`; it is the
  `close` step of a shutdown. `touch`, `runEnded`, `act` and `stackEnded`
  need no check of their own: each goes through the closed queue.
- **A record's baseline (`host.wrote`) is what was read** whenever the plan
  is not `leave` or `repair` (`planOfferEffects`): an offer that is not
  yours is safe to compare against as it is now. `leave` and `repair` keep
  what the host wrote, against which your edit is seen.

## Testing the shell

- **Test a decision as a value** where the shell has one: `planRunEnd`,
  `planInvites`, `draftSent`, the responses, and marginalia's `planStartup`.
- **Otherwise, drive a module with `record<T>()`** for exactly the port it
  takes, and a real `newSessionDoc()`. A method the test did not give throws,
  naming itself, so a module that touches an undeclared port fails at once.
  `fakeLane` holds a run open until the test finishes it. `row` and
  `writeEntry` put entries in the document, `putValue` a pi value (a work
  record, an archive record, a participant's name), and `writeLaneTip` a lane's tip; a running lane is
  `beginRun`. Both of those are `@pineta/schema`'s.
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
