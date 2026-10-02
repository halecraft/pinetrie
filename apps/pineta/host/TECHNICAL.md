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
| `basics.ts` | `Basics` (doc, log, ids, clock) and how a failure is logged (`messageOf`, `failed`) |
| `queue.ts` | `createSerial`: the one serial executor |
| `runs.ts` | a run from its start to its end (`createRuns`, `planRunEnd`), and the agent's `onStream` (`streamInto`) |
| `outbox.ts` | `drain`: an idle lane's held messages and updates, oldest first |
| `settle.ts` | what happens between runs: drain, then compact and sweep |
| `housekeeping.ts` | compacting the session, and deleting images nothing shows |
| `cards.ts` | the card port (ADR-0048): who wrote in a card, spending one, and every card's text gathered for the sweeps; where the shell opens card documents |
| `seats.ts` | each connected seat's person, written once as a `pineta.seat` record (started after `recover`) |
| `startup.ts` | `recover`: what a starting host does before it takes a command |
| `control.ts` | the command Line of each client seat, and who its writer is |
| `commands/` | one module per command: `chat`, `archive`, `mark`, `lane` (stop, update, offer); `index.ts` decodes, checks the archive, routes |
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
  `settle`. It breaks a cycle: a run's end drains, the drain may run an
  update, and an update may start a run. `runs.ts` imports neither the
  outbox nor the commands.

## Startup

`recover` runs, in order: `clearStreams` (no stream survives a process),
`ensureNames` (ADR-0039), `planStartup` over the outbox and `interrupted()`,
each interrupted lane resumed before anything waiting for it (S36 item 18),
`settle` for the other lanes with held messages, the project and commands
records written only when changed, and the sweep of what no one will type in
again: empty cards, card documents with no record, and seat records no stored
text names (`sweepTexts`).

- **Commands are taken only after `recover`.** `Control.listen` is made
  earlier, and `startControl` registers `onReceive` after `recover`. Earlier,
  a new message could run before an interrupted lane resumed, and jump a
  held one.
- **The agent, lane work and banners are made in a cycle.** Lane work and
  banners are made first and read the agent lazily (`theAgent()`), because
  the agent is made with lane work's `access` and `hooks` and banners'
  `request`. Those are the only lazy reads: every module made after the
  agent is given the agent. The `Serial` is made before them, for banners.

## Commands

- **A command's id is its send's id.** The column that sent a chat finds its
  message by it (`TreeIndex.bySend`).
- **The archive gate is in the dispatcher** (`refuseInArchive`). Only the
  `chat` command calls `sendChat`, so `sendChat` has no gate of its own.
- **A message sent from a card spends it** (ADR-0048): `sendChat` names the
  card's other writers as contributors, through the card port, and spends
  the card after `executeChat` answers `appended`, `started` or `queued`. The
  command's text is what is sent: the text its sender saw.
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

- **Asked on events**: the lane's `turnDone` hook, wrapped in `startHost`
  after lane work records the turn, and each run's end. `digestDue` decides
  in one step, from the stored digest, the request out, and presence: the
  host holds the presence document, and `readsAsk` reads its `reading`
  ends (S70).
- **Only the ask goes out**: its message and its run's messages, newest
  first within the budget, and the last digest. No agent reads the answer.
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

## Testing the shell

- **Test a decision as a value** where the shell has one: `planRunEnd`,
  `planInvites`, `draftSent`, the responses, and marginalia's `planStartup`.
- **Otherwise, drive a module with `record<T>()`** for exactly the port it
  takes, and a real `newSessionDoc()`. A method the test did not give throws,
  naming itself, so a module that touches an undeclared port fails at once.
  `fakeLane` holds a run open until the test finishes it. `row` and
  `writeEntry` put entries in the document, `putValue` a pi value (a work
  record, an archive record, a held item, a participant's name), and `writeLaneTip` a lane's tip; a running lane is
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
