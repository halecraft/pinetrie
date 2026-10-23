# The host's shell: technical notes

The host gathers facts, calls the pure decisions in the packages
(`@pinetrie/rules`, `@pinetrie/reads`, `@pinetrie/schema`, `@pinetrie/lanes`),
and carries them out. This directory is that imperative shell. Each module
does one thing and takes its dependencies as a parameter; `index.ts` alone
wires them. An operation reads its facts once, calls one plan and carries
out what it returns; it combines no helpers around the plan, and builds no
record a plan did not return (ADR-0193, `docs/01-architecture.md`, One
plan per operation). It words nothing either: a refused command's answer
is interface's words, a tool's answer rules', and only its log lines are
its own (ADR-0199). A `plan…` declared here decides what only the host
knows of.

## Where things are

| module | owns |
|---|---|
| `dev.ts`, `serve.ts`, `serve-built.ts`, `server.ts`, `invocation.ts` | `pnpm dev [folder]`, `pnpm serve [folder]` and `pinetrie serve [folder]` (ADR-0086, ADR-0148, ADR-0190), each a few lines over `runHost` (`server.ts`), which takes the command's arguments: `planInvocation` (the folder: the one named, or the one the command started in), `storeChoice` (the session's file, and whether `PINETRIE_STORE` named it; else the session's own, in its data directory for every kind of project, ADR-0150), `refusalText` (a refusal's words, with its command's usage). The folder is read from `INIT_CWD`, where pnpm was started, else the working directory (S108). `pinetrie serve` is `serve-built.ts`, the only `runHost("serve")`; `pnpm serve` rebuilds a stale page and then runs it. `pnpm dev:react` serves React's development build, for its warnings and render timeline (S59) |
| `page.ts`, `page-build.ts` | the page a host serves (ADR-0148): `page.ts` the built page in the page's `dist/`, whose files it reads once at start (`readBuiltPage`), loading no Vite, so the installed command never does; `page-build.ts` Vite's: the build (`buildPage`), the rebuild when the stamp no longer matches its inputs (`ensurePage`), and the live page `pnpm dev` and the suites serve (`livePage`), which the host opens on its own server. With no page given a host serves none (`NO_PAGE`) |
| `../command.ts`, `../bin.ts` | `pinetrie <command>`, the command the npm package puts on the PATH: `planCommand` decides which of `serve`, `sign-in`, `sign-out`, `tidy` and `session` an invocation asks for, and `bin.ts` loads only that command's module, each exporting `main(args)` and running nothing when loaded |
| `sessions.ts`; and `sessionOfFolder`, a read of the registry alone, for `pnpm tidy` | the session a host serves (`openSession`, ADR-0149): the folder's real path looked up in the registry under its lock, the registry written, the session's data directory made and its lock held (`sessionLockFile`); and `renameSession`, for `pnpm session rename` (`apps/pinetrie/scripts/session.ts`); and `sessionOfFolder`, a read of the registry alone, for `pnpm tidy` |
| `tidy.ts` | `pnpm tidy`'s shell (`apps/pinetrie/scripts/tidy.ts`, ADR-0155): `takeTidyLock`, the session store's own lock taken without waiting, so a host serving the folder refuses the tidy and a host starting during it is refused; the sizes it reports (`readRepoSizes`); and every line it prints, and the startup line, from values (`tidyWords`). What a tidy does is `@pinetrie/jj`'s `planTidy`. The folder is `invocation.ts`' `planTidyInvocation`, which reads one as `pnpm dev` does (`invokedFolder`) |
| `startup-lines.ts` | the words of what a starting host logs about its inputs: the project, the session (`sessionLines`), the store, each config file and what it refused (`reportLines`, in the setup page's words), the agent's model and where it came from or why there is none, the URL and invites, and the setup page's URL with no model; and the start's checklist, drawn (`checklistLines`) or a line per step (`endedLine`, `buildingLine`) |
| `start-checklist.ts` | a start's steps as values (§ Startup): `planStartSteps`, the cursor (`checklistAfter`), estimates (`stepEstimate`, `START_DEFAULTS`), what is remembered (`timesAfter`, `decodeStartTimes`), and the port a start reports through (`StartProgress`) |
| `start-terminal.ts` | the checklist on its way out: redrawn in place on a terminal, owning its writes while it draws (`terminalProgress`), else a line per step (`lineProgress`) |
| `host-refused.ts` | `HostRefused`, the one error a start throws as a refusal |
| `replace-file.ts` | a file of the host's own written whole, through a temporary file renamed over it: the session registry, a folder's stamps, the start's times |
| `settings.ts` | every setting the host reads, declared once (`SETTINGS`, ADR-0146) with the layers that may set it and how they combine; the project's copies as values (`laneAuthority`, `decodeAuthority`, `laneCopy`), `settleHost`, `folderReport` for a host without lane work, and the settled values as the deciding packages take them (`repoNames`, `iconSettings`, `titleSettings`, `sshChoice`, `storeSettings`, `listedFolders`). The lanes' store's settings (`lanes.store.*`) are the machine's and yours only: a system file's `max` is a ceiling (null limits nothing) and its `leaveFree` amounts are added to yours |
| `setup-record.ts` | `planSetupRecord`: the `pinetrie.setup` value, from the config's report and what the model setup loaded, who shapes a subscription's requests among it |
| `index.ts` | `startHost`: the store and the check of its schemas (`migrations/`), the Exchange (with its `resolve` for the documents clients create, `resolveDoc`), the documents and the records, then pi's scribe and setup, lane work and the agent, in that order (§ Startup), then the wiring below |
| `basics.ts` | `Basics` (the session, `pinetrie:live`, the documents, the places, log, ids, clock) and how a failure is logged (`failed`, which words the error with core's `errorText`) |
| `places.ts` | the one writer of the places document (ADR-0059, ADR-0048 step 6): `Places.change(cause, body)`, one change under its cause, whose `OpenChange` writes steps in one batch (`apply`, in an undo step when given one) or carries Kyneta's revert (`revert`), each followed by `rev` in a batch of its own; and the change's close as a value (`planClose`), carried out by `executeClose`: the texts of the text cards it removed, after their records (a client destroys its copy of a text only once it has seen both go, S64), then the cards' history and traces, the listeners, and the runs a take stops |
| `move-history.ts` | each person's history of moves per root (ADR-0066): `MoveHistories`, a shell over Kyneta's undo stacks |
| `provenance.ts` | each card's history and the traces left where someone else moved your card (ADR-0048 step 6): the port (`seen`, `sweep`, `onChanged`, `onTaken`), and the hooks a change's close reads and calls, which only `createPlaces` takes |
| `facts.ts` | `queueFact`: a fact of the host's queued as a card on its lane, in a change of the host's, then the lane's drain; a refused card is logged. The one way every module queues a fact |
| `shutdown.ts` | the order a host stops in (`planShutdown`): the agent, then the scribe, among its steps |
| `runs.ts` | a run from its start to its end (`createRuns`, `planRunEnd`), a Stop before pi starts (`cancel`), and the agent's `onStream` (`streamInto`); a run asks base news what it is told first, and its lane's stop has base news forget what was steered; a prompt's start is announced (`started`) |
| `first-work.ts` | a canvas moved from Topics to Active as an agent's run starts in it, once (`moveCanvasToActive`, ADR-0206) |
| `pinned.ts` | what a run reads of its thread's pinned cards (ADR-0048 step 5, S92): `readPinned` gathers, waits a bounded time for the sender's text (`waitFor`), and plans the cards entry |
| `canvas.ts` | what a run is told of its thread's canvas (ADR-0116): `readCanvasContext`, the canvas list and the cards pinned to the canvas (`planCanvasContext`), each written only when it differs from the newest of its kind on the lane's path, so an unchanged canvas keeps the prompt's cache (S92); `runs.ts` writes them between base news and the thread's pinned cards |
| `canvas-news.ts` | a card added to a running thread's canvas or taken from it, steered into its lane as a fact line (`planCanvasFacts`), heard from `Provenance.onChanged`; never a queued fact card, which would wait for the run's end |
| `base-news.ts` | what a thread is told of its base's new work (ADR-0080): `atStart`, a chat's run's behind entry; `baseChanged`, a steer into a running lane, at most once per base commit (`told`), heard from lane work's `onBaseChanged`; `runEnded` forgets what was steered. Made after the agent, whose lanes it steers |
| `split-call.ts` | `split_proposed_changes` (ADR-0080): a split card queued on the thread, popped when its run ends: pi calls it only during a run, so its step is queued before the run's end queues the drain, which the keeper runs after it |
| `queued-card-pop.ts` | popping a lane's queued cards to send them (ADR-0048, ADR-0083): `popNextQueuedCard` (`planQueuedPop`), and `drain`, which carries each out as `planCarry` decides: a fact appended (through the scribe at the thread's end for a thread with no lane, `lanelessSpot`), getting the latest, a split's run, a message sent (ADR-0108, ADR-0080); and `createWaits`, the drain's waits for its top card's text or for someone's typing in it to stop (ADR-0048 step 7) |
| `settle.ts` | what happens between runs: drains, then the upkeep (§ Roots: steps, leases and the upkeep) |
| `housekeeping.ts` | deleting images nothing shows (ADR-0042), retiring histories of moves (`sweepHistories`), deleting holds on queues nobody can use (`sweepHolds`, ADR-0048 step 7), and trashed cards past their week (`sweepTrash`); which of them a start and an upkeep run, in order (`planSweeps`), carried out in one keeper step by `sweepUnused` |
| `forward.ts` | `forward`: a call `startHost` hands to a module made before what carries it out, bound once that exists; a call before the bind is held, dropped or refused, as its site says (§ Startup) |
| `docs.ts` | `HostDocuments`: the documents the host always holds (the session's, `pinetrie:live`, the places) and the reads of the session that name a root; `planLoads`, the roots a starting host opens |
| `roots.ts` | every root's document (ADR-0162): `StepDocs`, a step's own, and `Lease`; pi's port; `planUpkeep` and the upkeep; `onOpened`, `onReleasing`, `onFirstLoad` (§ Roots: steps, leases and the upkeep) |
| `records.ts` | the host's writes of its records (ADR-0095): `createRecords`, the session's, which every module made at startup takes, and `createStepRecords`, a step's or a lease's, which writes a root's too; a write's home is in its type (`ValueWrite<H>`) |
| `migrations/` | the start's one plan for its store (`planStart`): each stored document's schema, checked before anything opens it, the migrations from a stored hash, and the one-time migrations the store's ledger lacks (`ledger.ts`) (§ The stored schemas, ADR-0096, ADR-0174) |
| `directory.ts` | each root's directory record, refreshed as its document changes: `startDirectory`, started with the records, and the startup rebuild of records that do not decode (`planRebuild`) |
| `cards.ts` | the card port (ADR-0048), about texts only: who wrote in a card, destroying one, loading and reading texts for the queue's pops and a run's pinned cards, waiting until a text holds a version (`whenHolds`, which an `AbortSignal` gives up), and the texts of given cards gathered for the sweeps; where the shell opens card documents |
| `seats.ts` | each connected seat's person (ADR-0037), written once as a `pinetrie.seat` record (started after `recover`), and unloading the histories of moves of a person with no seat left |
| `startup.ts` | `recover`: what a starting host does before it takes a command |
| `control.ts` | the command Line of each client seat (ADR-0007), and who its writer is: the principal its connection named, an email, so no command field can claim to be someone else (ADR-0037). The host is no writer: writers are the connected clients, and own no lanes, which belong to threads (ADR-0120) |
| `commands/` | one module per command: `send`, `board` (a move on the board, a change to its states: ADR-0122), `mark` (ADR-0045, ADR-0116), `lane` (stop, carry on, hold or release a queue, proposed changes: each finds its lane through `laneAt`), `cards` (a move, a reorder, unqueue all, an undo of moves, a command, a busy chat's card queued, a sent card spent, a paste, a thread's copy: ADR-0059, ADR-0066, ADR-0132); `index.ts` decodes, decides where it runs (`placeOfCommand`), clears it through the gate, and routes; every send, a `chat` command's, a popped queued card's (`sendPoppedQueuedCard`) or a spin-off's, is cleared too. `gate.ts`: `clear`, the gate's shell over `planGate` (`@pinetrie/rules`) |
| `http.ts` | the HTTP server: admission, the page (Vite or the built one), the websocket, blobs, proposed changes read, invites |
| `responses.ts` | every answer the host writes itself, as a pure `HttpAnswer` |
| `routes.ts` | what a request or an upgrade gets, pure: admission first (`planRequest`, `planUpgrade`), then which requests are the host's (`route`) |
| `admission.ts`, `policy.ts`, `lines.ts`, `blobs.ts`, `store.ts` | the invite key and links (ADR-0107; a blob, like the page, is admitted only from this host's own page on loopback, ADR-0042), the write policy, departed seats (a seat is fresh per page load, ADR-0037), the blob store (images, ADR-0042, and references' quotes as markdown, ADR-0126), the SQLite store, on `node:sqlite`, so with no native dependency (S22), which owns its file: it takes the file's lock, and a second connection, process or reader is refused (S47); `openStore` gives it with its blobs, its ledger and what each document stores beside its whole record (`storedSizes`) as one `OpenedStore`, which is what `startHost` takes |
| `machine/` | the machine lanes run on, watched (ADR-0210): `sensor.ts`, the one `MachineSensor`, composed from the runtime's raw reads (`runningLanes`, `machineSample`), the services' kills taken from the runtime's watch of Docker's events after those reads (so a sample whose read fails leaves them for the next), the `statfs` of the filesystem holding the store (`Found.machine`'s `storeVolume`: the lane VM's state directory on the Mac, the lanes directory on Linux) and the longest stall since the last sample, mapped by `planSample`; `sink.ts`, the `pinetrie.machine` record written in a step of the documents' keeper, only when it differs; `index.ts`, the watch of Docker's events opened and closed with the manager, the manager started in the start's `agent` step, its first sample queued and not awaited, and the timer (`MACHINE_SAMPLE_MS`, unref'd) that asks it for each sample; `records.ts`, what the disk upkeep reads of the documents (every root's revision records' entry snapshots, for the index's fill, each costed by the paths its turn changed, `recordedChange`; and the lanes that will run again, each with a record in no archived canvas); `importance.ts`, what bears on which lane matters most, gathered for `rankLanes` (`gatherLaneImportance`: a column's thread end in the lane's thread, read from its root's tree under a lease; the order runs started in, a count raised at each `beforeRun`, `createRunStarts`, never a clock; a held queue); `shell-calls.ts`, each lane's `bash` calls from the lane access's hook (`onShellStarted`): the program in flight, for the plan, and each call's duration, timed on the host after its gate, for the measurements; `measurements.ts`, the measurements' four tables and their export (ADR-0212); `repair.ts`, the lane VM's repair composed from `@pinetrie/vm` for the machine's executor (`laneVmRepairControls`): its locks as the proofs each step takes, the disk grown by the plan a start grows it by (`growData`), the repair boot's report mapped to what the machine keeps (`repairOutcome`), and the shared state read each sample (`laneVmRepairRead`) apart from the sensor, whose sample a stopped VM fails. The controls exist only for the lane VM and a host that manages (`lanes.manage`, from the host-only settings): with none, no path stops a VM. A host inside a lane, its observer relayed by the host outside (`Found.machine`'s `memorySource`), reads its own cgroup as the machine (`ownCgroupMachine`): its `memory.pressure`, its limit, and as available its limit less what its use is not inactive page cache (S329), from its own `/sys/fs/cgroup`, with lanehost's pure parsers, not through lanehost, whose role is a cgroup of its own; PSI is not namespaced, and the lane VM's whole is other threads' pressure too. `startHost`'s `machine` option gives a suite its own sensor over the host's (`wrapSensor`) and a shorter sample (`sampleEveryMs`), as it shortens `presenceDecay`; the manager has no test-only method. The manager is given the whole snapshot index and the runtime's `StoreControls` (`Found.machine`'s `store`: the store's listing, a snapshot's, a lane's and an inner project's deletion), and `lanes.manage` (`manage`, or `observe` for a machine something else keeps, which runs no upkeep). The disk upkeep is asked for at its start (not awaited: runs resume beside it), at each run's end once its container stopped (`containers.ts`), by an archive and a restore, when the health gains `room-low`, and by a backstop timer (`DISK_UPKEEP_EVERY_MS`, 15 minutes, unref'd); every ask is alike, and the step decides from what it finds. Lane work asks through forwards bound once the watch exists, held until then. `quiet` waits for the upkeep too. A host with no tools runs none. It closes in shutdown's `intake` step, before the documents' keeper closes, since its last write (`unsampled`) is a step there; on a start that throws, its closer runs before the keeper's |
| `work/` | lane containers and disks (§ Lane work: ADR-0032, ADR-0033, ADR-0034), through the project's adapter, whose kind it never names (ADR-0142) |
| `project.ts` | the project's adapter, chosen once by its kind (`projectAdapter`: an exhaustive switch, `assertNever` its default): jj's for a jj workspace, the folder's for any other folder; a folder lanes cannot serve (`projectDirWords`) is refused before any runtime is asked |
| `folder/` | a folder project's adapter, as it is built (§ A folder project's adapter): the project's folder's reads (`scan.ts`, `line.ts`) and watcher (`watch.ts`), its writes (`writes.ts`, `write.ts`), what is kept (`@pinetrie/folder`'s `planKeep`, carried out in `index.ts`), its reviews (`review.ts`), its records written (`record-writes.ts`), the only code that touches the project's folder (ADR-0142); it takes the runtime's disks (`LaneDisks`, or a `Pick` of it), and a whole runtime only where it runs steps (`history.ts`) |
| `watch-dir.ts` | one directory watched with `@parcel/watcher` (FSEvents on the Mac, inotify on Linux), its events handed on after a quiet window (`quietWindow`; 0 for the shared directories, 10 s for the project's folder), a dropped-events error at once |
| `jj/` | jj's adapter (`startJjProject`, § jj's adapter): each lane's proposed changes in your repo (ADR-0105), on the owner of your repo (§ Proposed changes), and the reviews and diffs a page reads of it (ADR-0047); accepted work's record and commands (`jj/accepted.ts`); each lane's fetch into your repo (`jj/fetch.ts`); splits (`jj/split.ts`) |
| `names.ts` | every thread's name (ADR-0039, ADR-0117): `ensure` for the lanes pi holds and the threads recorded, `reserve` for a thread a column opened before its first message (ADR-0057), on one queue |
| `banners.ts` | each thread's column banner (ADR-0050, ADR-0053): made as the thread is named, at reservation or creation, set by `set_banner`; every step a late one |
| `digests.ts` | each ask's digest (ADR-0106, ADR-0075), unless the config turns them off (ADR-0071); a live digest waits for someone reading the thread (presence, ADR-0024); every step a late one, and `writePendingRunEndReport`, the run-end report a stopping run writes before its end |
| `focuses.ts` | each thread's focus (ADR-0173): asked once its run's end has settled (`RunEndSettled`, from `Digests.ended`), from its asks and their headlines; every step a late one |
| `ask-model.ts` | one request to a model outside every thread with one of pine·trie's skills (`askModel`): the skill, the request, its tokens, the reply read and each refused part of it logged; digests, titles and focuses go through it |
| `relays.ts` | another thread's agent asked (ADR-0128): `ask` and `leave` (the tools' hooks), `relayMessage` (a person's chat that asks or invites), `relayCard` (an ask card popped), `deliver` (a relay into a thread, for these and the round) |
| `answers.ts` | what a relayed run sends back once it has ended (ADR-0128): its answer, placed by `delivery.ts`, the answers held for a busy asker, and the round, each a late step (`Answers.ended`, from `runs.onEnded`) |
| `delivery.ts` | where a host's message goes in a thread (`createDelivery`, by `planDelivery`): a run for one that wakes an idle lane, a steer into a running one, or an append; only a prompt wakes, since only a prompt starts a run. Shared by answers and ssh news |
| `ssh-news.ts` | each change to a lane's use of its owner's ssh, told to the lane (ADR-0178): heard from lane work's `onSshNews`, planned by `planSshNews`, delivered in a late step on the lane's thread |
| `threads-now.ts` | a thread as it is now, for the relays, the answers and the late steps: its reach, its tree, end and lane (`thread`, which opens only a live thread's root), and the names a message uses |
| `allowances.ts` | what agents talking spend (ADR-0128): the allowance a run spends, read from its prompt (`promptAllowance`), counted per request, written when it goes over and at a run's end, and the gate before each request |
| `later.ts` | `Later`: every write the host decides before a gap and makes after it (§ Late writes), its gate (`lateAway`), and a model request outside the keeper (`outside`) |
| `fakes.ts` | test support: `record<T>()`, `fakeLane`, `row`, `putValue` and `applyWrites` (each write to the document its target names, through the real `applyRecordWrites`), `writtenValues`, `basics` (one root, `ROOT_ID`, in `fakeDocuments`), `putLane`, `writeDirectory` |

## The documents' keeper

- **Every command but your repo's is a step on one keeper**, and so is every
  drain (`@pinetrie/keeper`, `packages/keeper/TECHNICAL.md`, keyed by
  `HostKey` in `basics.ts`). Where a command runs is decided, pure, by
  `placeOfCommand` (`commands/index.ts`, ADR-0065), which reads a table
  of every kind (`COMMAND_PLACE`), so a kind with no place does not
  compile: an action on proposed changes but a
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
  root's directory record is `once` (`root:<id>`). The upkeep is
  `later` ("upkeep", `roots.ts`): it starts only when no command, drain or
  refresh waits.
- **Each step is handed its documents** (`StepDocs`, the keeper's step
  context): the roots it reaches, revoked as it ends (§ Roots: steps,
  leases and the upkeep).
- **A failed step never stops the steps behind it,** and is logged
  (`[host] step failed: …`); its caller still gets the rejection. A step
  that ran over a second is logged too (`onSlow`), and so is a command or a
  drain that waited over one; upkeep's wait is not, since waiting is what
  upkeep does.
- **A stall of the event loop over half a second is logged** (`stalls.ts`):
  `[host] the event loop stalled for <n> ms: …`, at the first check after
  it, from the time the host serves until it stops. Anything awaited across
  a stall is timed that much longer, so this line tells a slow command
  (`[host] your repo: … ran <n> ms`) from a stalled host. Node samples the
  loop from a native timer (`monitorEventLoopDelay`), and a check reads it
  once a second. A sample is the time since the last one, so the sampling
  interval is taken off. The histogram is reset only after a stall, once,
  after every listener has heard it: a reset drops the sample that spans it
  (measured, Node 24), so a reset on every check would miss a stall that
  began just after one. The watch has one reader of the histogram and many
  listeners (`watchStalls`' `listen`): the log line is one, the machine's
  sample another, so no listener clears what another has not heard.
- **A stall names its CPU time, and one mostly off the CPU is a pause**
  (`stallWords`): a machine that sleeps stops every timer, and Node's
  histogram reads its sleep as a stall (Duane's host logged 1,042 s). The
  CPU time since the last check bounds the stall's own, since a check
  reports any stall before it; under a tenth of the stall, the line says
  the host was paused: the machine slept, or a synchronous call waited.
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

- **A run gathers, plans, then carries out its steps** (ADR-0197). It asks
  pi whether the lane holds an operation another process left open
  (`ThreadLaneHandle.isLeftOpen`), plans with `planRunSteps`, and after each
  step acts on `planAfterStep` (`packages/rules/TECHNICAL.md`). A prompt on
  a lane left open resumes that operation first, logged as
  `resumingLine`'s `before its new message`, then gathers what it is told
  (base news, canvas, pinned cards) from the tree the resume left, and
  runs. pi refuses a run on such a lane as busy, and would queue an append
  in the operation's inbox (S282), so the check comes first, whatever left
  the operation open and whatever order the root's first-load recovery and
  the run's step take. It rests on the host never starting a run on a lane
  it runs: the dispatcher, the drain and the relays gate on `readRunning`.
- **A prompt's run reads its pinned cards first** (`readPinned`,
  `pinned.ts`): a chat's, a popped queued card's, a resolution's, a split's
  and a carry-on's. It
  gathers the thread's pinned cards at the lane's tip (`pinnedContextCards`), loads
  their texts, waits for each as the chat's sender had it (`seen`, at most
  `PINNED_WAIT_MS`, 2 s), gathers again (a card may have been pinned or
  unpinned meanwhile), and plans against what the model last read on the
  path (`planPinnedContext`, over the texts it loaded). `runs.ts` only awaits it and
  passes the entry to `handle.run`; a failure is logged and the run goes
  without cards. A resume reads nothing: its prompt and entry were written
  when it began.
- **The wait is a window in which pi's `abort` reaches nothing**: the run is
  begun (its `begin` is written, so the lane is busy and the suites count
  it running),
  but pi has no run yet. `Runs.cancel(lane)` aborts a chat's wait; the run
  then appends the chat, as a refused run does, and ends. `handleStop`
  cancels first and asks pi to abort only when nothing was cancelled.
  A chat's run is stoppable in two phases (`runs.ts`): `pinned`, its
  pinned cards' wait and the gather before it, where `cancel` returns true;
  and `resuming`, its resume of a left-open operation, where `cancel` keeps
  the message all the same but returns false, so `handleStop` asks pi to
  abort the resume. The resume runs even after a Stop: until it ends, pi
  would refuse the kept message as busy. After pi's abort the lane is idle,
  and the message lands in the tree (S282). A
  land or stack start cannot be cancelled: it writes no prompt then, and
  `end()` would read the lane's previous one, and for a stack end an old
  split again. They carry no `seen`, so their window is as short as
  before. A carry-on's start cannot be cancelled either, for the same
  reason: a Stop in its window reaches nothing.
- **A prompt's run moves its canvas to Active as it begins**
  (`first-work.ts`, ADR-0206): `Runs.start` calls its `started` port in
  the step that starts the run, after `begin` and only for a prompt (a
  resume goes on with work begun before). `moveCanvasToActive` plans
  (`planMoveToActive`, `@pinetrie/rules`) from the places as that step
  left them and, only when there is a move, writes it as the host's own
  change, which runs its body at once, so nothing comes between the plan
  and the write; it leaves no trace and enters nobody's stack of moves.
  `startHost` tracks it on the keeper, so shutdown waits for it.
- **Gotcha: a canvas moves before its run reaches pi.** A run stopped in
  its pinned cards' wait, or one pi refuses, leaves its canvas in Active,
  and moved once, it stays.
- **A run that wrote its lane's prompt anew is logged** (ADR-0176): its
  outcome names the sections of pi's prompt it changed (`promptChanged`,
  `packages/pi/TECHNICAL.md`), and `promptChangedLine` words them:
  `[host] <thread>: the model's prompt changed: project_context`. A lane's
  first prompt changes nothing, and is not logged.

## A run's end

`planRunEnd` returns the order, from the prompt's role and whether pi's
harness closed under the run, and `runs.ts` carries it out: its `failable`
steps, a split's `split-ended` then `run-end-report-pending`; then its
`always` steps, `end-run` (or `left-running`), `lane-stopped`, `ended`. A resolution ends as any run does (ADR-0080, S104): what it left
conflicted is the proposed changes', and whether the agent asked is the tree's. A run touches no tools: every lane's list is the
same for every run (`packages/pi/TECHNICAL.md`, S85).

- **`end-run` comes before `lane-stopped` and `ended`.** It closes the lane's
  streams (ADR-0044: a stream stays open past its message's end) and clears
  its active run. `lane-stopped` is lane work's `runEnded`: the container
  stops, and the proposed changes are refreshed; then base news forgets what it
  steered into the lane, so the next run plans from the tree alone. `ended`
  drains the lane; a drain that ran before
  `end-run` could start the next run with the last one's reply still open.
- **The run-end report is pending before `end-run`** (ADR-0077,
  `writePendingRunEndReport`, the step `run-end-report-pending`): written
  after, a page would see the lane stopped beside the last run's report,
  and draw its arrival. Its `end` is the run's last entry from its
  asks, as at `ended`.
- **A failure in a `failable` step is logged as `run end failed`,** and
  every `always` step still runs.
- **An interrupted run leaves its lane marked running** (`left-running` in
  place of `end-run`, ADR-0197). A run or resume whose drive pi's harness
  closed under ends `interrupted` (`packages/pi/TECHNICAL.md`): pi keeps the
  operation open, as after a crash (S282). The lane's mark in
  `pinetrie:live` is cleared only when pi shows the operation closed, so the
  next host opens its root at startup (`planLoads`) and resumes it. The
  step logs `[host] run <id> left running for the next start`.
- **`ended` is one function, set once** in `startHost`: `settle`, banners, and the run-end report with the final digest, then the thread's focus once that has settled (`RunEndSettled`, ADR-0173). It breaks a cycle: a run's end
  drains, the drain may run an update, and an update may start a run.
  `runs.ts` imports neither the queue's pop nor the commands.
- **`ended` is given the run's prompt**, read at the start of `end()`,
  before any step. A listener uses it, never the lane's tip: `settle`'s
  drain is queued first, and pops a queued card or starts the next run
  before any step queued after it reads the lane. pi reports no prompt id,
  and the lookup gives the same answer as pi's own end tip (S71).

## The session's documents (`docs.ts`, `directory.ts`, ADR-0063)

- **`Basics.docs` holds what is always loaded** (`HostDocuments`): the
  session's, `pinetrie:live` and the places, and the session's reads that
  name a root (`rootOfLane`, `rootOfEntry`). A root's document is reached
  only through a step's documents or a lease (§ Roots: steps, leases and
  the upkeep).
- **The host is every document's authority** (`{ authority: "self" }`), so
  Kyneta loads a root it let go again when a client asks for it (S86).
  `resolveDoc` interprets a `root:` id the directory names, as an archived
  root a client previews, and rejects any other: only the host makes roots.
- **The directory follows each root's document** (`directory.ts`): a change
  to its entries, pi's values or its records queues one refresh, the
  keeper's `once` (`root:<id>`), absorbed by one already queued, which writes
  `readRootRecord` with `setIfChanged`. It follows every root through
  `onOpened`, and refreshes each as it starts to follow it, so a record
  stored before a field was added (ADR-0077) is rewritten. As the upkeep
  lets a root go it is written once more, from the document as it leaves:
  a change after the last refresh is not lost. `ROOT` is derived, so its
  shape changes with no migration: a root a thread's record names whose
  record does not decode, and which is not loaded, is loaded in a step at
  startup, and the upkeep lets it go (`planRebuild`).
- **A compaction replaces a document's stored records with what it holds
  now** (the upkeep's), which also trims a `json` document's in-memory op
  log (ADR-0023). The places are Yjs (ADR-0066): their storage is
  compacted, and nothing in memory is trimmed (S90). A client's command
  Line is stored too but not compacted: Kyneta cannot compact a replica of
  a document another peer writes, which its pruning should do upstream
  (S25). A card's text is Yjs, which Kyneta cannot compact live (S24).

## Roots: steps, leases and the upkeep (`roots.ts`, ADR-0162)

- **A root is reached only through a step's documents or a lease.** The
  documents' keeper hands each step a `StepDocs` (the keeper's step
  context, `packages/keeper/TECHNICAL.md`), revoked as the step ends: a
  call after throws `StepEnded`. A plan takes the handles its step loaded.
  Work off the keeper (lane work, which a step may await; a description's
  read) takes a `Lease` from `LeaseBasics.leases` and disposes of it with
  `await using`. Only `index.ts` makes the store (`createRoots`); a test
  reads the sources and fails on any other (`roots.test.ts`).
- **A run holds its root by a lease**, taken in `Runs.start`, which takes
  its step's `StepDocs` and so runs only in a step, and released after the
  run's `ended` has run. What reads a running lane's root (its stream, its
  pinned cards, its canvas's context, its allowance, its pending run-end report, base
  news, `save_blob`) reads `RunDocs.docOf`, whose null is "no run". The
  leases say what must stay in memory; which lanes run is
  `pinetrie:live`'s.
- **pi opens a root only if a step or a lease holds it.** Its port
  (`Roots.pi`) refuses any other root with `NotHeld`, the one check made at
  run time, since pi's calls cross its package boundary. The scribe asks
  once per root and keeps the session; that stays sound because the
  upkeep runs the scribe's `release` before it lets the root go.
- **One upkeep reconciles storage and memory** (`planUpkeep`, the keeper's
  `later("upkeep")`, queued by `queueUpkeepOn`). Of the loaded roots
  settles named, every root it lets go and, after a settle, the session's
  documents, it compacts those due (below); runs each released root's
  `onReleasing` listeners (the scribe's `release`, the directory's last
  write); lets go of every loaded root no lease and no tab holds; destroys
  each empty scratch document in a root no lane runs in; and watches each
  root a tab holds until none does. A load, a lease's release, a settle and
  a change to a watched root's tabs each queue it. A failed compaction is
  logged and the root let go all the same: Kyneta unloads it only once the
  store holds every write, so letting go needs no compaction. Only the
  upkeep unloads a root and its scratch document; a test reads the sources
  and fails on any other `exchange.unload`, the migrations' and the stacks
  of moves' aside.
- **A document is compacted only when it is due** (`dueCompactions` over
  `planUpkeep`'s candidates, `isCompactionDue`, ADR-0188): once what it stores beyond its newest whole record outweighs
  that record in bytes, or counts more than a thousand records. A
  compaction reads every stored record, takes them into the replica and
  rewrites the document, all on the event loop (the store is synchronous),
  and costs with the records it reads (S263: about 1.4 s for a root of
  1,512 records). The upkeep reads each candidate's sizes first, from the
  store's own table (`storedSizes`, `store.ts`: one query per document, a
  whole record told by its payload's first characters, no payload parsed).
  Only the candidates' sizes are read. Kyneta's first write of a document
  is a whole record too. A store that cannot say (one in memory,
  `sizes: null`) has each candidate compacted.
  The candidates are built from roots' ids and the session's three, so a
  scratch document is never compacted.
- **Each compaction is timed**, and one longer than half a second is
  logged (`compactionLine`): `[host] compacted <doc> (<n> records, <n> KB)
  in <n> ms`, the records and bytes as the store said before it.
- **A root's scratch document** (`scratch:<RootId>`, `ScratchDoc`) holds
  pi's pending state that belongs to one operation: a streaming reply's
  frames and a running tool's checkpoints (`packages/pi/TECHNICAL.md`, "pi's
  pending state"). Its life:
  - **Loaded with its root when the store holds one** (`exchange.open`,
    which never makes one), and the root's `ready` waits for both: pi is
    never handed a root whose stored scratch document has not arrived, so
    recovery after a crash reads it.
  - **Made by pi's first pending write** (`pi.makeScratch`), which resolves
    once it has hydrated: Kyneta refuses a write before.
  - **Destroyed when it is empty and no lane runs in its root**
    (`planScratchDestroys`; the running lanes from `pinetrie:live`, through
    `rootsOfLanes`), whether the root stays or is let go. A run's lane
    leaves `pinetrie:live` before its settle queues the upkeep, so the run
    just ended keeps none. It is decided and done after the upkeep's last
    await, with none in between, so nothing changes under the decision.
    One that is not empty (a run a crash ended) is unloaded with its root,
    for the next run there to recover.
  - **Never compacted, never shared**: the policy refuses it to every tab
    and takes no write of a client's to it (`policy.ts`), and its kind is
    registered for the start's check of stored schemas (`SCHEMA_OF`).
- **`PINETRIE_ROOT_TRACE=<file>` logs how roots are used** (`root-trace.ts`),
  one JSON object a line: each use (through a step, a lease or a tab's
  ask), whether it loaded the root, and the host code that asked; each
  lease's end; and each upkeep that compacts or lets go, with the roots a
  tab holds. It is for replaying offline what a policy for keeping roots
  would cost. Off, nothing is computed for it: the trace is an optional
  call, whose arguments, the caller's stack among them, are not evaluated.
- **What follows, by construction:** L1, a root a step loaded stays loaded
  until the step ends (only the upkeep unloads, and it is a step of the
  same keeper); L2, a leased root stays loaded while its lease lives (it is
  counted as it is taken, and the upkeep decides each unload again after
  its last await); L3, with the keeper idle, no lease held and no tab
  holding a root, no root is loaded (every load and release queues the
  upkeep). `roots.model.test.ts` runs every sequence of three events (a
  step, a lease, a release, a tab's ask, its sync, its drop, an idle wait) and
  checks each after every event.
- **A root a tab asked for is followed** (`exchange.documents`'
  `doc-promoted` or `doc-created`) once the directory names it: a tab
  announces the root it mints before its first send, and loading that one
  would have the directory record it, so the send would find its id in use.
  It is counted as loaded, and kept while a tab holds it: unloading one a
  tab holds makes the tab ask again, and doing that at every load never
  ends (S216). A tab that lets a root go destroys its copy before it stops
  wanting it (`packages/session/TECHNICAL.md`), so the host hears it. A
  root with no message is not recorded by the directory: a step may load a
  tab's new root before its first send.
- **A starting host opens only the roots of the lanes `pinetrie:live`
  names as running** (`planLoads`), read before `recover` clears them, and
  `recover` resumes the interrupted lanes among them. A lane is still
  marked when the last host's run in it crashed or was cut off by a stop
  (ADR-0197). A root's first load in a host's life queues `recoverRoot` as
  a step of its own: its interrupted lanes resumed, records of a type no
  spec declares deleted, malformed lanes logged. It skips a lane this host
  is running, since pi's inspection would wait behind its drive; the step
  that loaded the root may have started that run, which resumes an
  operation left open itself (§ A run's start).
- **Archiving lets go of no root itself**: the upkeep does, as for any
  root. Its close unloads the canvas's stacks of moves (`unloadCanvas`), which
  keep their own lifetime (§ Moves' history). Restoring opens nothing.
- **The suites read a root synchronously** through `rootsRead`
  (`Roots.lastRead`): each root this host has loaded, by its newest
  handle. A handle Kyneta has let go reads its last value, and only the
  host writes a root, while it is loaded, so that value is the stored one.
  Only a suite's host keeps them (`keepRootsRead`): a handle kept keeps its
  root's last value in memory, which is what letting a root go saves.

- **A command names its root and its canvas** (`Command.root`,
  `Command.canvas`, ADR-0063, ADR-0116): a chat writes in its root, and a
  chat at the root starts it, under the root and canvas ids the sender's tab
  minted, refused `root-id-in-use` or `canvas-id-in-use` when the session
  holds either already; a branch elsewhere names a canvas the session holds.
  The host's `CanvasIndex` is `canvasesNow(basics)` (`canvases.ts`), from the
  places and the threads' records, built once per command by the
  dispatcher (`commands/index.ts`), which hands it to the gate and
  every card command; a drain, a title and proposed changes each build their own,
  once a step. Only an undo reads it again, after its revert wrote.

## The stored schemas (`migrations/`, ADR-0096, ADR-0174)

A document opened under a changed schema keeps a dropped field's data only
until the next compaction (S120), and the host compacts at startup. So
`startHost` checks every stored document's schema before its first `get`,
reading the store once, planning once, then acting:

- **Gather.** `readStored` reads each document's stored schema hash
  through the `Store` (`listDocIds`, `currentMeta`), before anything is
  deleted, and the ledger gives the names of the one-time migrations the
  store has run (`MigrationLedger.ran`).
- **Plan.** **`planStart`** (pure; `planStoredStart` binds the build's
  registries, `storedKind` and `SCHEMA_OF`, `policy.ts`, which `resolve`
  uses too) decides everything the start does to the store:
  - **The ledger's part** (`planLedger`): a store with nothing stored is
    new, and records every carried and retired name and runs none. A store
    in use whose ledger lacks a retired name is refused, naming each. Else
    the carried one-time migrations the ledger lacks are due, and a ledger
    name the build neither carries nor retired is logged
    (`unknownMigrationsLine`): a newer build ran it.
  - **The stored command Lines** are deleted: each belongs to a client
    seat that cannot return (`lines.ts`).
  - **Each due `StoreMigration`** names, from the ids the ones before it
    left, the documents nothing writes any more.
  - **`planOpen`**, over what is kept, compares each stored hash with the
    hash of the schema its kind opens with: open as it is, run the
    migrations registered from a stored hash, or refuse, naming the
    document and both hashes. A stack of moves has Kyneta's own schema and
    is skipped; any other id no schema of ours opens is logged and left
    alone. It does not see what a store migration deletes.
  - **Every refusal comes before anything is deleted**, so a refused store
    is as it was. `refusalLine` words both kinds.
- **Act.** **`prepareStore`** records a new store's names, deletes the
  Lines, then each store migration's documents, after one `backup` before
  the first that deletes anything, recording each due store migration's
  name after its deletes, one that deleted nothing too. **`migrate`** then
  runs on the host's Exchange: every migration's reads first, then, if
  every stored record loaded, its writes; then the flush, then the names
  of the due record migrations, written or not, then it compacts and
  unloads what it opened. Before a migration that moves data it copies a
  file store (`backup`, `VACUUM INTO` on the store's connection, to
  `<file>.before-<migration>`). Kyneta reports a record it could not load
  only as a `console.warn`, so `migrate` watches for that warning while it
  reads; one stops it before it writes or records. A read-only open leaves
  a stored hash as it was (S120), so a stopped migration leaves the store
  to be planned the same way next time.
- **The ledger** (`migrations/ledger.ts`, ADR-0174) is `pinetrie_migrations`
  (`name`, `ran`), a table in the store's file on the store's connection,
  as `pinetrie_blobs` is; `backup` copies it. A host on an in-memory store
  keeps it in memory.
- **The machine's measurements** (`machine/measurements.ts`,
  `@pinetrie/machine`'s `MachineMeasurements`, ADR-0212) are four tables
  on the store's connection: `pinetrie_machine_samples` (each sample's
  rung, pressure, memory, its source, the kernel's refaults and stall time
  since the last, lanes running, the mode), `pinetrie_machine_lane_samples`
  (a running lane's memory in MiB and its program, only when changed),
  `pinetrie_machine_shell_calls` (a `bash` call's lane, program, duration
  and how it ended) and `pinetrie_machine_decisions` (a treatment changed,
  or a shadow decision, with the pressure and memory then). Each row is
  stamped with the host's clock, which no planner reads; rows older than
  `MEASUREMENTS_KEPT_DAYS` go at the manager's trim, in both modes. No
  command's arguments or output are kept. `backup` copies them; a host on
  an in-memory store keeps them in memory (`memoryMachineMeasurements`).
- **The snapshot index** (`snapshot-index.ts`, `@pinetrie/machine`'s
  `SnapshotIndex`, ADR-0210) is `pinetrie_snapshots` (`snapshot`, `lane`,
  `changed`, `used`, `branched`, `state`) and a one-row
  `pinetrie_snapshots_meta` (`complete`), on the store's connection. A
  store serves one folder, and the project's lock one host, so its rows
  carry no project. A host on an in-memory store keeps the same index over
  a database of its own in memory (`memorySnapshotIndex`), which the tests
  use too. A name is recorded only once its work is in the
  file: after `exchange.flush()` for a record migration, since before the
  flush Kyneta has not appended the write (S240), and after the deletes for
  a store migration, since `Store.delete` commits before it resolves. A
  host that dies between the work and the row runs the migration again,
  which finds nothing to do. Hash migrations are not in the ledger: a
  document's stored hash already says which schema wrote it.
- **Gotcha: a power cut on macOS can keep a row and lose its write.**
  SQLite's default sync there does not flush the drive's cache, so a power
  cut during the start that runs a migration can skip it for good. The
  risk is accepted (ADR-0174).
- **One file per migration**, named `NNNN-slug.ts`. The numbering starts
  again at `0001` with the ledger (ADR-0174): the migrations numbered
  before it were all deleted, and their history is in their ADRs. A name is
  permanent: the ledger keys a migration by it, so a renamed one runs again
  on every store (`migrationNameClash` checks the build's names are
  distinct).
- **A hash migration is deleted once Duane's store has passed it**; a
  store still on its hash is then refused. A change that moves no data is a
  migration with no `run`: registering it is the acknowledgement.
- **A one-time migration is deleted when its author chooses**: its file and
  mutations go, and its name moves to `RETIRED_MIGRATIONS`, so a store that
  never ran it is refused instead of opened in the old shape.
- **Each stored schema's hash is pinned** (`migrations/index.test.ts`):
  a change to one fails that test until a migration from the old hash is
  registered, so no schema changes by accident.
- **A renamed field is read from a snapshot under the old schema.** A Yjs
  document keys each field by an identity hash, not its name, so the
  current schema reads a stored row's old field as nothing; a migration
  reads it from `createDoc` over `exportEntirety`, opened under the old
  schema.
- **A change to a record's contents moves no hash**: records are JSON in a
  document's `records`, and so does a change to the values of the places'
  rows, whose fields stay. A `RecordMigration` (`RECORD_MIGRATIONS`) runs
  on a store whose ledger lacks it: `migrate` runs each one's reads with
  the hash migrations', and it returns a write only when what it read is
  in the old shape, so a run again after a crash finds nothing to do. It
  writes under the document's current schema, so its hash stays. The
  backup is taken after the reads, before the first write. One that reads
  every root (as one built on `recordDocs` over the roots does) loads them
  all, once per store.
- **Registered now**, none retired:
  - `0001-reply-diagnostics` (ADR-0176): each stored reply's list of the
    thinking Anthropic dropped becomes its count, by the rule a new reply
    is stored by (`countedDiagnostics`, `@pinetrie/pi`). It reads every
    root's entries raw and writes only the rows that change, never an
    entry's `content`, id or parent; over its own output it plans nothing
    (`planCountedDiagnostics`).
  - `0002-image-versions` registers the places document's new hash: its
    card record gains `versions`, which a stored record without it reads as
    "" (ADR-0182). It moves no data.
  - `0003-one-margin` (ADR-0182) rewrites each comment's place from its
    entry's id and thread to the entry's printed address, in every places
    row, live or trashed, and every place a card's history or a trace
    stores (`marginFieldsNow`, `planMarginRows`, `planMarginEvents`). An
    address holds `/`, an entry's id never does, so over its own output it
    plans nothing. A Kyneta undo of a comment's move made before it still
    writes the old row back.
  - `0004-card-titles` (ADR-0182) moves each `pinetrie.note-column` record
    to `pinetrie.card-title` under the same id, deleting the old
    (`planCardTitles`).
  - ADR-0172's renames: `0005-accepted-working-copy` and
    `0006-proposed-working-copy-edits` rename accepted work's `yours` and
    each proposed changes record's `yourEdits`, which an old record would
    otherwise keep, undecoded, until the host's next observation, or for
    good where the lane's proposed changes have ended; `0007-land-merged`
    renames each land message's `details.yours` to `merged`, which
    `baseKnown` reads; `0008-turn-disk-private` renames each turn record's
    `disk.local` to `disk.private`; `0009-access-answers` renames each
    access record's `approved` to `allowed`, and `refused` with `revoked`
    to `denied` with `takenBack`; `0010-ssh-fact-words` renames each ssh
    fact's news `refused` to `denied` and `revoked` to `taken-back`, and
    `0011-carry-on-ssh-allowed` each carry-on's reason `ssh-approved` to
    `ssh-allowed`, `content` untouched in both; and the rest of the
    plain-words renames: `0012`–`0015` (*get the latest*: a lane's base,
    accepted work's preview, a folder state, a card's command), `0016`–`0019`
    (*unfinished work*: a base, accepted work's list, history messages and
    queued facts), `0020`–`0022` (*allowance*: its records' namespace,
    relays, answers and ask cards, and facts), `0023-incoming` (each
    `pinetrie.heard` message's type) and `0024` (*trash*: a trashed card's
    place, in the places rows, its history and its trace).
  - `0025-run-end-report` (ADR-0186) moves each run-end report from
    `pinetrie.runEndReport` to `pinetrie.run-end-report`, its report's
    `modelSaid` respelled `model-said` and its urgency `needs-you` or
    `worth-a-read` (`runEndReportNow`), read raw: the old shape no longer
    decodes.
  - `0026-card-ticked` registers the places document's new hash: its card
    record gains `ticked`, a column's box, which a stored record without it
    reads as "", unticked (ADR-0198). It moves no data.
  - `0027-canvas-state-changed` registers the places document's new hash:
    its card record gains `stateChanged`, which a stored record without it
    reads as "", so every canvas starts as one an agent's first run moves
    to Active (ADR-0206). It moves no data.
  - `0028-workflow-marks` (ADR-0206) marks the stored workflow's states:
    Topics on the open state named Topics, else the first; Active on the
    open state named Active, if it is another (`workflowMarksNow`), read
    raw, since a workflow with no Topics no longer decodes. A workflow with
    any mark is left alone. It must run before `recover`: an undecodable
    workflow reads as none, and `planWorkflowSeed` would write a new
    default whose state ids no canvas is in.
- **A migration that only reshapes one namespace's records,** record by
  record, is a pure rewrite over `rewriteRecords` (`migrations/rewrite.ts`,
  over `recordDocs`, which any record migration reads a home's documents
  with), which reads every document the namespace lives in before it
  writes any. `renamedFields` is the rewrite that renames top-level
  fields. Given a `to`, it moves every record there, rewritten or as
  stored, and deletes it from the old namespace in the same batch, so no
  run leaves a record in both, and over its own output the old namespace is
  empty. A migration names an old spelling or word on purpose, so its file
  and its test are in `OLD_SHAPES` (`scripts/sources.ts`), which the words
  and tag checks both read.
- **A migration that only reshapes one kind of history message** is a pure
  rewrite of its stored `details` over `rewriteHistory`
  (`planHistoryRewrites`), which reads every root before it writes any and
  never touches `content`, what the model read.

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
  words that are a blob (`cardTextSource`) count as referenced. It keeps
  each referenced original's fitted copy too: a draft names the original,
  and its message will show the copy.
- **A known opportunity, not work:** the sweep could order blobs by a
  use counter, the highest so far plus one, as the snapshot index orders
  its rows (`snapshot-index.ts`), rather than by the clock, so a store on
  a clock behind or ahead would sweep alike.
- **The sweep reads the host's clock, and so do the blobs** (ADR-0139):
  `startHost`'s `now` is `Basics.now`, and the clock of the blobs it opens
  (`openStore`'s `now`) or keeps in memory. A caller that opens its own
  store (an `OpenedStore`) must open it on the same clock: a store behind
  the host's stamps each blob as old, and the next sweep deletes it, though
  nothing has had its `BLOB_GRACE_MS`. A suite moves the clock instead of waiting out the
  grace (`suiteClock`, `clockedStore`).
- **A message's links are quoted for the model** (`linkedQuotes`,
  `withQuotes`): `sendMessage` gathers each past referent its text links to
  from the root it is in, and the chat's content quotes it under the text,
  frozen as sent.
- **A message's shares are read with it** (ADR-0151): `sendMessage` reads
  each blob its text names (`SendReach.named`) with its ref, size, fitted
  copy and bytes; `planSendMessage` reads which hold a location and quotes a text
  file under the message up to `shares.quoteBytes`, and refuses a send that
  names a blob no longer stored.
- **A send is planned in phases** (`commands/send.ts`, ADR-0193): whether
  its root may be opened (`planSendRoot`); its root read, what it reaches
  (`planSendReach`: its thread, the command its first word names, the blobs
  it shares); the command expanded by pi and the blobs read; then the send
  whole (`planSendMessage`: the message, the thread it opens, its quotes, and
  whether it relays), which `executeSend` carries out. A refusal before
  anything is written is a `SendRefusal`, worded by `sendRefusal`.
- **`save_blob`'s hook** (`save-blob.ts`) reads the lane's path to its root
  (`ancestry` from its tip), and gives the bytes of a blob some message
  there named (`readableBlobs`, `planSaveBlob`). It never writes: the tool
  writes through its environment, so the helper counts the write as the
  agent's (S207).

## Startup

**A host with tools listens only once its lanes work** (ADR-0191): lane
work's setup makes them ready before it returns (`startSetup`, `setup.ts`),
so the agent, `recover` and the runs it resumes come after, and the server
listens last. A preparation that fails is a `HostRefused`.

**A start is a checklist of steps** (`start-checklist.ts`, drawn by
`start-terminal.ts`, worded by `startup-lines.ts`). `planStartSteps` lists
every step of this start before any runs: the lane machine (with tools),
the store, the project, the model, the roots, lane work's setup, then with
tools the lane images, the lane runtime, lanehost, the observer and the
base snapshot, then the agent, and the server.

- **One step runs at a time, so the list is a cursor** (`Checklist`): the
  steps ended, the one running or failed, those waiting. Each `begin` ends
  the step before it; `startHost` ends the last, or fails the running one,
  in one place. A `begin` past a waiting step marks it as never run, so a
  planned step the code skips shows.
- **A build lands on the step running** (`StartProgress.building`): the
  lane VM's launcher and image (`leaseVm`'s `building`), every image
  Docker builds (`dockerRuntime`'s `building`), the runtime's extraction
  and the base snapshot's making. A step that built says so; one that could
  have and did not says it is up to date. A build with no step running (a
  tag another host removed, rebuilt later) is a line of its own.
- **Estimates are the last start's** (`stepEstimate`): each step's
  duration, kept apart for a start in which it built, in the session's
  `start-times.json` (`SessionFiles.startTimes`), written once the start
  ends or fails; a failed step keeps its old times. A step never measured
  takes `START_DEFAULTS`, a `Record` of every step.
- **On a terminal it is redrawn in place; piped, it is a line per step**
  (`startProgress` picks by `isTTY` once). While it draws, the terminal
  form owns stdout's and stderr's `write`: anything written, Vite's and
  Kyneta's included, erases the checklist, goes through, and the checklist
  is drawn below it. Only `redrawText` makes escape codes. A host given no
  `progress` (every suite) gets the line form over its `log`.

After `recover`, `sweepUnused` runs a start's sweeps (`planSweeps`) in one
keeper step: `sweepHistories` retires the histories of moves no one will
undo again (§ Moves' history), those of a root the directory does not name
among them; `sweepHolds` deletes the holds on queues whose lane no root
holds or whose root is archived (ADR-0048 step 7); then the trash and the
traces. Each runs again in the upkeep after a settle, which sweeps the
images too: `recover`'s settle queues the first.

`recover` runs, in order: the clear of `pinetrie:live` (`planClear`: no
stream survives a process), a new store's default workflow
(`planWorkflowSeed`), the deletion of the records of a type no spec
declares in the session (`planUndeclaredSweep`, ADR-0100, so a renamed
record leaves nothing behind), the deletion of
the proposed changes, accepted-work and base records of another kind than the
project's (`planKindSweep`, ADR-0150: caches of the project as it was
before; a folder's `STATE` and `CONFLICT` records are kept whatever the
kind), `ensureNames` (ADR-0039), `recoverRoot` for each root opened, in
one step (its undeclared records deleted, its stored lane names that fail
`isThreadId` logged, since no reader is given them, and each interrupted
lane resumed before anything waiting for it, S36 item 18, whether a
crash or a stop left it), `planStartup`
over the queued cards and those lanes, the
project and commands records that changed in one write (`setIfChanged`),
the sweep of what no one will type in again: empty cards, card documents
with no record, and seat records no stored text names, all of them in one
write (`sweepTexts`: the cards in one change of the host's, which destroys
their texts and deletes their histories, then the documents no record
names), then traces older than 30 days and histories a crash left with no
card (`provenance.sweep`, which each run's end's settle runs too), and last
`settle` for the lanes with cards queued:
its upkeep is `later`, so it runs after every write above, and after
any refresh they queued. Every other root is recovered by `recoverRoot`
as it first loads (§ Roots: steps, leases and the upkeep).

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
- **The registry is written whole, under its lock** (`sessions.ts`,
  ADR-0211): `sessions.json.lock` is an `@pinetrie/lock` lock, waited for
  and said once (`registryWaitWords`), with no timeout; the kernel frees
  it with its holder, so no dead holder's lock is taken over and no two
  takers race. What must run under it takes its proof (`RegistryLocked`):
  writing the registry, trying a session's lock, dropping a session's
  directories. The write is `sessions.json.tmp` renamed over the registry.
- **A served session holds its lock for the host's life**
  (`sessionLockFile`, the file `host.pid`, a name kept from when it held
  only a pid). Each session the plan may pick or drop has its lock tried
  once, before the plan: one another host holds is `served`, which the
  plan refuses, naming the pid its holder wrote, so a second host on a
  session stops before it opens anything. Every hold but the opened
  session's is released after, a refusal's too. A rename holds the
  session's lock while it moves the directories, the file moving with
  them, and removes nothing: a removed lock file is a free lock (S327). A
  host whose session lock is lost shuts down (`sessionLockLostWords`):
  `server.ts` alone does this, and no suite runs it, so the path is
  checked only by hand; a test needs a harness for a real `server.ts`
  process.
- **A session's directories are removed with `rmdir`,** never a
  recursive delete: when an attach replaces a folder's own empty session,
  a file written since it was found empty refuses the attach, and stays.
- **`anthropic.subscription` is a flag only your file sets**
  (`SUBSCRIPTION_SETTING`, `@pinetrie/rules`' key, which the setup words
  name too), true by default; the machine's file narrows it, so its `false`
  wins over yours, and a project's is refused, since it runs code on the
  host (ADR-0192). `startHost` passes it on the configured model choice,
  the one that loads the shipped `pi-anthropic-auth`
  (`packages/pi/TECHNICAL.md`).
- **A starting host says what it read** (`startup-lines.ts`). `server.ts`
  logs the project, the session (found, attached and where it was, or
  new) and the store, `startHost` each config file (with
  `(none)` when missing, `(not read)` when broken) and each refusal, then
  who shapes a Claude subscription's requests, and the warning when it is
  signed in and nothing does (`subscriptionLines`, ADR-0192), then
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
  and the proposed changes, all or none) is null. Nothing
  asks a lane's access then.
- **Commands are taken only after `recover`.** `Control.listen` is made
  earlier, and `startControl` registers `onReceive` after `recover`. Earlier,
  a new message could run before an interrupted lane resumed, and jump a
  queued card.
- **pi is made in three parts, each when what it needs exists**
  (ADR-0092, `packages/pi/TECHNICAL.md`), and every module is given values,
  never a function that returns one:
  1. the documents and the roots' store (`createRoots`), then the host's
     records (`createRecords`, ADR-0095), which every module that writes a
     session record takes
     (`Pick<Records, "writeValues">`), then the cards' texts, provenance and
     the writer of the places (`createPlaces`), which every module that
     writes a card takes (`placesWriter`), then the scribe;
  2. the project and its lanes' runtime (`findProject`, `work/runtime.ts`,
     before the store opens, so a refusal leaves nothing to close), then
     pi's setup (`loadPiSetup`), which loads from its root and reads no
     document; the title-model and banner logs follow it;
  3. the documents' keeper, with the roots' step context, the roots
     `planLoads` names, opened in one step, the directory,
     banners, digests, titles, names and the split call, each
     with the records and the setup;
  4. lane work, with them, which returns once its lanes are ready, the
     observer connected (`Ready` is a value, ADR-0191);
  5. the agent, last, with lane work's `access` and `hooks`, banners'
     `request` and digests' `step`; then base news, which steers its lanes
     and joins lane work's `onBaseChanged`, the runs, the delivery, the
     answers, ssh news, which joins lane work's `onSshNews`, the commands
     and the drain.

  A base change announced before base news joins is lost harmlessly: it
  steers only a running lane, and no lane runs before `recover`. The
  commands and the queue's drain still refer to each other (a command asks
  for a drain, a drain sends through the commands), as closures that run
  only once both exist.

- **Five calls cross the order above, each a `forward` bound once what
  carries it out exists** (`forward.ts`). Each site chooses what a call
  before its bind does:
  - the roots' upkeep, due from the first load, before the keeper and the
    sweeps exist: dropped, since `recover`'s settle queues an upkeep after
    every load before it. Held, it would run before `recover` and let go of
    the roots it opened for it.
  - a root's first load, recovered by `recoverRoot` once the agent and the
    runs exist: held, and made at the bind, after `recover`, which
    recovered the roots it opened itself.
  - `Later`'s drain, made before the commands it sends through: dropped,
    since its fact stays queued and `recover`'s settle drains every lane
    with cards queued. Held, a drain would send before `recover`, which no
    command may (below).
  - the agent's `ask` and `leave`, before the relays, which start runs over
    the agent, and its `put_image`, which acts through the commands: refused,
    since only a run calls them, and none runs before the relays and the
    commands exist.

- **The runtime is Docker** (`work/runtime.ts`, ADR-0130): the lane VM's on
  the Mac and the host's own on Linux (`planRuntime`). On the Mac, a host
  whose lane VM image is missing builds it as it leases (ADR-0147,
  `packages/vm/TECHNICAL.md`), saying so first; it takes about 20 s.
  - **A host with tools that cannot run lanes does not start** (ADR-0102):
    `projectAdapter` (`project.ts`) and `findProject` return the refusal as
    a value, worded with its fix, and `startHost` throws it as
    `HostRefused` (`host-refused.ts`); `server.ts` prints it and exits 1.
    So does a preparation of the lanes that fails (an image that does not
    build or has no git, the runtime's extraction, the slot, the observer,
    the base snapshot), worded with its error.
  - **A start that throws closes what it opened** (`startHost`): each part
    is pushed on an `AsyncDisposableStack` as it opens (the ssh directory,
    the lease, the store, the exchange with the roots, the scribe, the
    keeper, the agent), disposed in reverse on a throw. The store is the
    exchange's to close once the exchange is made; the agent's closing
    closes the keeper first, as `planShutdown` does. Once `startHost` has
    returned, only `shutdown()` closes anything. The refusals: the
    project's, asked first, before any runtime (`ProjectDirRefusal`, worded
    by `projectDirWords`: no such directory, your home directory or the
    file system's root, a jj repo with no git directory beside it), and
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
    queue, a new lease's reset among its canvases. Nothing
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
it out, each step but `server` in its own `try`: `intake` (seats, control), `close` (the documents' keeper, whose upkeep still finishes, and the owner of your repo, which stops its watch and drops its upkeep not yet started), `quiet`, `agent` (every harness),
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
- **The session's lock goes after `shutdown()`** (`server.ts`): its
  `releaseLock`, also when lanes refuse to start, after the start closed
  what it opened.
- **Only the first signal shuts down** (`server.ts`). It takes the SIGINT
  and SIGTERM listeners off, so a second Ctrl-C gets Node's default action
  and ends the process, even while `shutdown()` hangs.

- **The queues close before `quiet`.** `quiet` waits only for what is queued
  when it looks. A step started after it (proposed changes refresh marked by an
  observed move or a lane's fetch, a drain from a command) writes to a
  closing agent and document: its jj steps land and its record is lost
  (S73). A watch event after `close` finds the owner closed.
- **Closing the agent ends running runs interrupted.** pi's harness seals
  every lane, so a drive in flight rejects with `HarnessClosed`, which pi's
  boundary turns into `interrupted`, and `runs.ts`' `end` runs its steps
  with `left-running` in place of `end-run`: the lane stays marked, and the
  next start opens its root and resumes it (ADR-0197, S282). Its other
  steps queue a refresh and a `settle`, which the closed queues refuse.
- **A chat still waiting on its pinned cards at the stop is lost.** Its run
  has no operation in pi yet, so nothing resumes it. Its later call to pi
  meets a harness over the session the close ended, which faults (S282), so
  the run fails, and its message is not kept.

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
  lane records and the project's kind, and plans: a canvas the command
  writes in archived (`writesIn`); then, read only when the plan asks for
  them (`read`), the roots a branch forks in, so a command the archive
  refuses opens none; then a thread someone holds or trashed, "put it on
  a canvas first"; then a run that would start on a lane of another kind
  than the project's (`ERR.FOREIGN_LANE`). The refusal is worded in
  interface (`gateRefusal`), since only the person answered reads it. The dispatcher clears each decoded command once and
  carries out the `Cleared<Intent>`; a popped queued card and a spin-off's
  first message are cleared as `Send`s (`send`). `sendMessage` takes only a
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
  getting the latest conflict and split, a relay's delivery (`planRelay` refuses an
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
- **A copy** (`copyThread`, `commands/cards.ts`): `planThreadCopy` over the
  source's record and tree, and the card titles; the copy's `THREAD`
  record and its source's title first, then its card, then its name
  (`names.ensure`). Its first send is a branch at its fork:
  `sendMessage` refuses a branch naming a recorded thread anywhere else, and
  writes no record or card for it.
- **A thread is opened before its first send** (ADR-0126, `open-thread`
  below), so its first send writes only its entry; a branch at the root in
  a canvas the session holds is refused unless its thread was opened there,
  in that root: a new canvas's, or a new root's made past a canvas's last
  column (ADR-0138). A branch naming a thread no column opened (a script's) is
  opened with its send (ADR-0116, ADR-0117): `planMessage`'s decision names
  the thread it writes in (`thread`), and for a branch what its card needs
  (`starts`), and `planSendMessage`, over the cards read after the send's last
  await, plans its opening (`planThreadOpen`): the thread's record, its card just after the thread
  it forks from on its canvas, and for a new canvas its card on the
  board (ADR-0126), at the end of the state the chat names
  (`Command.state`, a board column's ＋), else of Topics.
  `executeSend` writes that before the message and reads nothing for it.
- **A move on the board** (`commands/board.ts`): `planBoardMove` over the
  workflow and the places; a move within open states writes the canvas's
  card (`placeCanvas`, the card commands': a move in its mover's history
  outside any canvas, a reorder in none, with its card's history) and
  answers `moved`; one that crosses the archive's edge gathers the canvas's
  roots' documents (its step's `StepDocs` loads each) and
  `planArchive`s the crossing first. A refusal is a card move's,
  `unmoved`, saying where the card is and who put it there. An undo of
  moves whose step crossed the archive's edge is refused `archived`
  (`crossesArchive`), before Kyneta reverts anything. The crossing's
  teardown (`work/archive.ts`) reports a lane whose removal fails and goes
  on: one disk left behind is waste, while a teardown stopped there would
  leave every lane after it, its history and its snapshots. **A change to the states** (`handleWorkflow`) is one
  keeper step, `planWorkflowChange` over the workflow and the cards, which
  returns the workflow's write.
- **A message sent from a card spends it** (ADR-0048): `sendMessage` names the
  card's other writers as contributors, through the card port, and spends
  nothing. The dispatcher's `send` case spends the card when the answer
  takes its text (`spendsCard`: `appended` or `started`): the record goes,
  then the text, and the reply carries the places' `rev`, its trace naming
  the message the send wrote (found by the send's id). A popped card's
  text goes as the pop's change closes, since the pop removed its record;
  one written back keeps it. The command's text is what is sent: the text
  its sender saw.
- **A chat carries its sender's pinned versions** (`pinned`, each card
  pinned at the sender's thread end with its text version): `executeSend`
  passes them to `start` for a `run` or `create-and-run`, and the run waits
  for them. A popped queued card's chat (`sendOfPoppedQueuedCard`), in
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
  send) records nothing another change wrote meanwhile, such as an allowance's
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
  rethrown. A caller that voids a change catches it (`allowances.ts`'s stop,
  `failed`): a voided async function that rejects ends the process
  (`packages/keeper/TECHNICAL.md`).
- **`move` and `set-command` are handoffs** (`commands/cards.ts`): gather
  the places and whether the lane runs, plan (`planCardMove`, or
  `planSetCommand`), then write. A move, a paste, images put, a version, a
  reorder and a width each read their facts once (`cardFacts`), plan whole
  (`@pinetrie/rules`' `card-commands.ts`), and are carried out by one
  function (`carryPlan`): the history's stack the plan names loaded, the
  steps as one change, the drains, then the records written after it. Trashing's history is the
  host's to name (ADR-0066, ADR-0116): `Trashes` is the canvases now and the
  `here` the `move` carries, the canvas its sender is on. A move's list is accepted
  whole or refused by its first refusal (`planMoves`): a keep's cards are
  one command. An accepted move answers `moved` with its `rev`; a refusal
  answers `unmoved` with its code, where the card is now, who put it there,
  and the current `rev`. A move that leaves a card queued on a lane that is
  not running queues the lane's drain, a voided `keeper.once`
  (`drain:<lane>`) behind the move's own step.
- **Every change records its provenance as it closes** (`planClose`): the
  cards' history and the traces (`planProvenance` over the touched cards),
  in one `writeValues`. In `commands/cards.ts`, `carryPlan` is the one path
  for every card command's plan (`CardPlan`, `@pinetrie/rules`' card
  plans), each with its cause: a move, a busy chat's queue, a spend, a
  command set on a card (which changes no place, so records nothing). It
  takes only the lists a plan stamped (`Planned`), so the shell can neither
  build a plan nor edit one, and a history left out does not compile
  (ADR-0193). `undoMove` runs in phases (`planUndoReach`, the spun threads'
  trees read, `planUndo`), carries Kyneta's revert through `revert`, in one
  change with the threads it lifts (`deleteRoot`), and answers with
  `planUndoAnswer`, which takes the revert `planUndo` let through. A spin-off's thread card and its card's move to
  the trash are one change, its sender's. A thread's card placed by its
  first send (`executeSend`) is its sender's change, so `canvas-news.ts`
  tells the canvas's running threads, as for an opened or copied thread. The
  drain makes each pop one change of the host's (`queued-card-pop.ts`), with
  `popNextQueuedCard` still synchronous (S69). The presence the close reads
  is `readReading`'s pairs: a placer with a column open at the card's end
  saw it go.
- **`picture` sets the sender's picture** (`commands/picture.ts`,
  ADR-0098): `planPicture` over the blob's reference, read without its
  bytes, returns its write. A picture wider or taller than `PICTURE_MOST`
  is fitted by `fitImage` (`prepareImage` with the box the plan names,
  `@pinetrie/pi`), kept as a blob of its own, and that copy is set
  (`planFittedPicture`); the original is left to the sweep,
  which keeps only pictures that are set (`readReferencedBlobs`). The fit
  runs inside the command's keeper step: an upload is already fitted to
  2000×2000, so it takes milliseconds, and the browser's 256 picture is
  never fitted at all.
- **`traces-seen` deletes the sender's own traces**, ignoring any other
  id, and answers `seen`. A client sends it for the traces a column drew.
- **`undo-move` undoes or redoes the sender's newest move in a canvas, or,
  naming none, in their history outside any canvas** (§ Moves' history). It answers `undone` with each card it moved and its
  place now, `unmoved` (shaped as a refused move) when someone moved a card
  since, or `nothing`. An undo first reads the cards its step moves
  (`MoveHistories.top`, S139): one a thread's record says it was spun from
  lifts that thread back (`planLiftRoot`) only while it holds its first
  message alone, with
  no lane and no other card; else it answers `unmoved` `replied`, naming
  who wrote second, and reverts nothing. A lift deletes the thread after
  the revert (`deleteRoot`, `planRootDelete`): its directory record, its
  thread's, its canvas's record, board place and title, any card in it or on
  the canvas, its document (`HostDocuments.destroy`, which tells
  every peer), and the canvas's stacks, unloaded for the startup sweep to
  retire. A redo after a lift moves the card back to the trash, its thread
  deleted: trashing it.
- **`spin-off` makes a text card a thread** (ADR-0111, ADR-0126,
  `spinOff`), in one keeper step, in phases: the card's text loaded whole,
  `planCardSpinOff` (refused for a card that is no text card, a blank card,
  a root or thread id in use, or as `planMove` refuses the move), then the
  thread's records (its own,
  spun from the card, and its new canvas's), a chat at the root of the new
  root its tab minted (`sendMessage`, cleared as every send is, never asking
  the agent, the card's writers its contributors), then, once the chat took the card's text, the
  thread's card on its canvas and the card's move to its sender's
  trash, in the history of the canvas it leaves, or from an inventory the
  new canvas's; a chat that took nothing deletes the records again (the
  plan's `unwrite`). The
  answer is the chat's: `appended`, with the first message's id.
- **`open-thread` opens a thread before its first entry** (ADR-0126,
  `openThread`), in one keeper step: a branch's root's tree loaded (a new
  root has none: a new canvas's, or one in a canvas the session holds, ADR-0138),
  `planThreadOpening`, then its record, its card and the canvas re-ranked for
  it (and a new canvas's card on the board), then its name
  (`names.ensure`). No entry is written. A move that takes a new canvas's only
  thread to a trash before its first send sends its emptied canvas's card
  to the closer's trash in the same step (`planCardMove` decides it), in their history outside any canvas, so the undo key
  on no canvas brings both back.
- **`branch-out` is a press on an agent's proposal** (ADR-0157,
  `branchOut`), in one keeper step: the root's tree, the thread records
  and which lanes run gathered with no await before the first write;
  `planProposalPress` (`@pinetrie/rules`), which reads the asks and the
  proposing lane's running run from them; then every branch's records
  and cards carried as one opening (`carryPlan`, as `open-thread`'s is:
  records first, one places change of the presser's, names); for
  Start, each branch's message cleared and sent in order through `send`,
  as a spin-off's is; then the press's fact (`queueFact`). A refused send
  is logged and leaves its thread opened, unsent. The host writes no
  draft: Open's composers start from the proposal on the page, and Send K
  is the page's ordinary sends.
- **A person's documents are clients' documents the host only keeps**
  (ADR-0059, ADR-0077, ADR-0122): their inventory, their attention and
  their list. `resolveDoc` names a `<kind>:<writer>` id's kind, and the host
  interprets it as `InventoryDoc`, `AttentionDoc` or `OpenDoc`; the policy shares it only with the
  peers whose principal is that writer (`holdsPersonDoc`), and who may
  write it is the protocol's (`writersPolicy`, below). Kyneta fires
  `resolve` only for a peer `canShare` grants (S76), so nobody else can
  create someone's document. The host never writes one: it decides only
  whose inventory a card is in, and refuses a card past its last slot without
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

- **One Kyneta undo stack per person and canvas**, `moves:<writer>:<CanvasId>`
  (ADR-0116), and one per person outside any canvas, `moves:<writer>`
  (ADR-0126): a `MoveHistoryScope`. Key `moves`, scope the places document, made on first use
  and kept in the store. Kyneta undoes only its own runtime's writes, and
  only the host writes `places`, so the stacks are the host's: `policy.ts`
  shares them with no one and rejects one a client announces, and
  `writersPolicy` gives them to the host alone.
- **Which history a move enters is its plan's** (`movesHistory`, inside
  `@pinetrie/rules`' card plans), and the shell loads the stack the plan
  names: the canvas the
  card goes to, else the one it leaves, read from its record; trashing's,
  the canvas it leaves, else, from an inventory, the canvas its sender is on
  (`here`), else, on none, its sender's history outside any canvas; a
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
- **Retired 7 days after their canvas is archived** (`planHistorySweep`,
  `ARCHIVED_HISTORY_MS`), at startup and after each run's end; and at
  startup only, those of a canvas the session does not hold (a new canvas's,
  deleted as it closed unsent). A person's history outside any canvas is
  never retired. The stored ids come from the store's listing by `moves:`;
  `retire` destroys a stack loaded or not (S91).
- **Unloaded when nobody can use them:** a person's when their last seat
  leaves (the seats step, `idleWriters`), a canvas's when it is archived
  (`unloadCanvas`, in its close's last step). The next move loads one
  again (S91). The upkeep does not unload them: whether a stack loaded
  again still refuses the undo of a move the host overtook meanwhile is
  not measured (ADR-0162).
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
  wait whose card leaves the queue, popped, unqueued or trashed, is given
  up (`givenUp`), so it neither stays subscribed nor drains; the places are
  watched only while a wait is out.
- **What a popped card comes to is decided first** (`planCarry`,
  ADR-0080), then carried out (`carryOut`): a fact is appended to the
  thread; getting the latest runs `prepareUpdate`, then sends the text; a split
  starts the split's own run, its text the brief; a message is sent; a card
  with no text and no command is trashed. A queued reference's quote is
  read from its blob before the pop (`queuedQuotes`) and sent as a
  message; one whose blob is missing is skipped, logged, and the drain goes
  on (ADR-0126). getting the latest's `prepareUpdate`:
  clean, the update is written, then the text, if any, is sent;
  conflicted, the resolution run carries the text; nothing new, the text
  alone; refused, the card goes back. The text is sent through
  `sendPoppedQueuedCard` in mode `queue`, cleared by the gate, as its queuer (`by`), with the card's other
  writers as contributors. A card with no text starts no run.
- **Getting the latest holds its step through the lane's start and merge,** a
  queued card's (`getLatestThenSend`) and a chat's got the latest first
  (`getLatestFirst`, `commands/send.ts`) alike, so every command and drain
  waits for them. That is what keeps a later message to the lane after the
  merge's entry and the text it carries: let go between the merge and
  its settle, the step would have to mark the lane busy and every command
  to it would have to queue behind the mark. Its lanehost calls are each
  bounded instead: a start reads its disk, and lists no snapshot
  (`decideLaneStart`, `packages/lanes/TECHNICAL.md`), since a listing that
  stats every snapshot held a drain for 10 s (S247). A run's own start
  (`beforeRun`) is queued on the lane and awaited by no step.
- **A card the host could not send goes back below the line, whole**
  (`planUnsent`): a note in the note column nearest its thread, made in the
  same step when its canvas has none (ADR-0116), saying why, and never queued
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
- **`executeSend` still checks where a new lane begins and asks pi for the
  lane.** Both are ports that may refuse, not facts to gather. The begin is
  checked first (`checkBegin`), so a refused send creates no lane.
- **The new lane's id is its thread's** (ADR-0117): `planMessage` names it from
  where the send goes, and neither the host nor pi makes one. A thread's
  first message is preceded by its `THREAD` record, written in
  `executeSend`.
- **`reserve` is answered `reserved`** whether it named the id or the id
  had a name already, so a column may send it again; an id pi holds is
  refused `lane-id-in-use`.
- **Stop queues who pressed it before it aborts** (ADR-0106, ADR-0126):
  `planStop` (`@pinetrie/rules`) gives the fact card naming the running
  ask's stopper, unless one is queued or appended already, and
  `handleStop` writes it (with its history, a host write), then asks pi to
  abort, in one step. So the fact is queued when the run ends, and the
  first press is the one named. With a message card queued it holds the
  queue first (`holdOnStop`, ADR-0048 step 7, its write returned by
  `planStop`); the run's end, a drain on
  the same keeper, appends the stop's fact, which goes before the cards,
  and pops nothing else. The run's end report names the stopper from the
  queued fact (`endedOutcome`).
- **`queue-hold` holds or releases a thread's queue** (`handleQueueHold`,
  `planQueueHold`): it answers how the queue is now, `held` or `released`,
  whether it wrote or the queue was already so. A release asks for the lane's drain: nothing else
  would pop what waited.
- **`queue-card` queues a card and changes its queue's hold in one step**
  (`queueCard`, `planCardQueue`, ADR-0113): the hold is written first, then
  the move carried as `move` carries one, so its drain finds the queue held
  or released as planned. The move is in the sender's history; the hold is
  not, so an undo takes the card back and leaves the hold. One with no
  `from` makes the card in the queue with its command (`targetId` on the
  wire), in no history, as any creation; one that moves a card that exists
  writes the command with the move (ADR-0203).
- **Trashed cards are swept** (`sweepTrash`, `housekeeping.ts`): a card past
  its `trashDeadline`, and every card on a surface it owns, loses its
  record, then its text and its history, in one change of the host's, at
  startup and in `settle`'s sweep. A deleted thread's lanes of
  their own go as an archive's do (`planLanesGone`, through
  `work.teardown`, off the documents' keeper), which withdraws their
  proposed changes; the thread's record stays, since its entries name it.
- **`reorder` and `unqueue-all` are moves of their own** (`commands/cards.ts`).
  A reorder is written in the sender's history of its place's root
  (`planCardReorder`), through `carryPlan`, and drains nothing. Unqueue all plans
  its moves from the queue as it is (`planUnqueueAll`) and hands them to
  `move`, so it is one step one undo reverses; with nothing queued it
  answers `nothing`.
- **A command on proposed changes leave a fact** (ADR-0080): `actOnProposedChanges`
  answers first, then writes the action's fact as a queued fact card in a late
  step of its own (`Later.step`, through `queueFact`), with its history
  (cause `host`, as for every fact and the split card `split_proposed_changes`
  queues), and asks for the lane's drain. An idle
  lane appends it at once; a running one when its run ends, in order with
  the cards already queued. The client draws it as a quiet row, and nobody
  moves it.
- **A chat on a thread with no work of its own is got the latest first**
  (ADR-0080): `planMessage`'s `get-latest-first` runs `prepareUpdate` with a run
  to follow (`follows: "run"`), then sends the chat with `upToDate`, so it
  does not loop (`getLatestFirst`, `commands/send.ts`).
- **Resume is `carry-on`** (ADR-0082): `handleCarryOn` starts a run whose
  prompt is `planCarryOn`'s carry-on message, or answers its refusal. It is
  one step on the documents' keeper, as a split is, so a second press finds
  the lane busy and is refused.

## Late writes (`later.ts`)

An archived canvas is read-only, and a command is refused there by the gate
(`planGate`). The host's own writes that it decides before a gap and makes
after it are refused by `Later`'s: a model request's answer, a step a run's
end queues, an action on proposed changes' fact, an allowance a round's request spent. A
root record written through `Records` after an archive let its root go
opened it again for good, and one written after `docs.destroy` made the
document again (S198); a fact queued in an archived canvas left it holding
queued cards, which `planArchive` refuses.

- **`Later.step(scope, what, plan)` is the one way to write late.** Its
  step gathers the places and the archive, asks `lateAway` of the thread or
  the canvas (a title's) it writes into, and on a refusal logs `[host]
  <thread>: <what> not written: <why>` (`awayWords`) and stops. Else
  `plan` reads the documents as they are now and returns a `LateWrite`,
  which `Later` carries out: its records (the step's `StepDocs.records`,
  which write a root's too), then each fact,
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
- **A late step loads its thread's root once the gate lets it through**,
  then plans; the plan reads through the step's `StepDocs`, never a handle
  read before the gap. A refused step loads nothing, so a late step opens
  no archived root and makes no destroyed one again.
- **`Later.outside`** asks a model outside the keeper, tracked so `quiet`
  waits for it, then plans its answer as a `step`; a null answer writes
  nothing. With `held`, a key is in a set while the request is out, for the
  caller's plan to read (`bannerDue`, `planDigest`'s `inFlight`). A failure
  goes to `failed`, never to the caller.
- **The modules whose work is late hold no write port and no keeper**:
  `digests.ts`, `focuses.ts`, `titles.ts`, `banners.ts` and `answers.ts` take `Later`,
  and no `Records`, places writer or keeper, so every step they take is a
  late one. `answers.ts` keeps pi's ports for an answer's delivery, which
  it makes only in an `after`; that much is held by its tests. `allowances.ts`
  keeps its keeper, `Records` and places writer for what is exempt below,
  and its `allowance-spent` fact is a `Later.step`.
- **Exempt, each with its reason** (the list is closed):
  - commands, and the sends made for one: `planGate`, through `clear`;
  - the archive's own steps (`commands/board.ts`): they write about the
    archived canvas on purpose, its pending run-end reports among them (below);
  - upkeep: the directory's refresh and rebuild, the sweeps
    (`housekeeping.ts`, the trash, holds, histories, provenance), names,
    seats, the compaction, startup;
  - what happens inside a running lane, whose canvas cannot be archived
    (`planArchive` refuses `running`): `allowances`' `stopNow` in pi's gate,
    `split-call.ts`, `canvas-news.ts`, `base-news.ts`,
    `writePendingRunEndReport`, `runs.ts`;
  - an allowance's own record (`ALLOWANCE`), written when it goes over whatever
    became of its thread, so a restored canvas's agents cannot spend it
    again;
  - the drain: a popped card's send is cleared by `planGate` (`writesIn`'s
    `queue` case), its `away` is `threadCardHolding`, and no fact is queued in an
    archived canvas;
  - `relays.ts`' `ask`, `leave`, `relayMessage`, `relayCard` and `deliver`:
    each reads both threads' reach and refuses with `unreachableRefusal`
    in the step that writes;
  - proposed changes' description (`describe.ts`, for either kind of project):
    each adapter's settle writes only while its proposed changes are the one asked
    about (`planDescribeSettle`, or folder proposed changes' start and tip), and an
    archive's teardown withdraws its threads' proposed changes;
  - a turn's tail (`work/turns.ts`): its revision, fetch and snapshot after
    a run ends. Dropping it would lose a revision a restore needs; whether
    an archive must wait for it (`pendingRecords`, as a fork does) is not
    decided.

  Every places write, exempt or not, goes through `Places.change`.
- **An archive settles what it cuts off.** A run's end the gate refuses
  would leave its end report `pending` in the archive for good, so the
  archive's record step writes `unclassified` over each pending report of
  the canvas's threads (`planArchive`'s `runEndReports`,
  `unclassifiedPending`),
  as a starting host does.

## Digests and run-end reports (`digests.ts`, ADR-0106, ADR-0077, ADR-0166)

- **Always made.** The config's `digests` (`enabled`) turns off live
  digests and the final digest; a run's end still asks for its urgency.
- **A run's end is one request** (`planRunEndReport`, over `planRunEnded`):
  a failed or stopped run's
  end report is written from its facts and only a due digest is asked for;
  an answered run asks for its urgency line, with the final digest when
  `planDigest` gives one, and for a short ask the urgency line alone. The
  request's last line says which (`URGENCY_ALONE`, `URGENCY_THEN_DIGEST`),
  and the scripted model answers it (`packages/pi/scripted.ts`).
- **One settle, one write** (`runEndedToWrite`): the run-end report and the
  digest together. A failed request still settles, so a report asked for is
  `unclassified`, never left pending; a reply for a run whose stored
  report the next run's end has replaced writes no report. A failed
  request writes no digest, as before.
- **The lane keys the run-end report and nothing else.** `ended` takes it from
  `runs.onEnded`, and reads the run's last entry from its asks: the lane's
  tip may already be past the run (below). It is also the scope of every
  late step `digests.ts` takes, a live digest's (`step(lane, at)`) and a
  run's end's, so none lands in a thread archived meanwhile.
- **A starting host** writes `unclassified` over each run-end report still pending
  (`planStartup`), unless its lane is resumed.
- **Asked on events, each naming an entry**: the tip the lane's `turnDone`
  hook is given (wrapped in `startHost` after lane work records the turn),
  and the prompt each run's end is given. The ask is `runPrompt` that entry,
  which never changes: entries are written once (ADR-0004). No step reads
  a lane's tip. At a run's end the tip is already past the ask: a plain
  queued card popped there would lose the ask its final digest, and a next
  run with work would take it, which then refuses that run every later
  digest.
- **`planLiveDigest` decides** in one step, from the tree, the stored
  digests, the requests out, and presence: the host holds the presence
  document and gives the plan its `reading` ends (S70); the plan reads the
  turn's ask from the tree.
- **Only the ask goes out**: its message, worded from its prompt entry so a
  land or stack ask is named too, its run's messages read up from the run's
  last entry, newest first within the budget, its last word, and the last
  digest. No agent reads the answer.
- **The reply is read in `request`, as a title's is** (`titles.ts`):
  `parseEndReply` there, and each refused half logged ("the model's digest is
  not one", "the model's urgency line is not one"). The answer's `plan` gets
  the parsed reply, never raw model text. A live digest writes what `digestToWrite`
  returns; a run's end, what `runEndedToWrite` returns.
- A missing `ask-digest` skill is logged, and settles as a failed request.
- **A run's end settles with what it wrote** (`RunEndSettled`): `ended`
  resolves once its reply is written or its request failed, with the ask's
  final digest. It keeps `later.outside`'s promise and waits for it after
  its step, never inside it: the settle is a step of its own on the same
  keeper. Only `digests.ts` makes the value, so the focus step, which takes
  it, cannot run before the final headline is written.

## Focuses (`focuses.ts`, ADR-0173)

- **Asked after every run's end, digests on.** `Focuses.ended` takes the
  `RunEndSettled` the run's end resolved to, plans with `planFocus` from the
  thread's asks, the root's digests and the settled run's own, and asks
  outside the keeper with `askModel` and the `thread-focus` skill. The
  answer writes what `focusToWrite` decides, as a late write.
- **No request is held per thread.** A run that ends while another run's
  focus is asked asks too: `focusToWrite` keeps the newer ask's, and
  skipping it would leave the focus a phase behind.
- **Its tokens count to the ask** (`allowances.spendFor`), as a digest's do.

## Agents talking (`relays.ts`, `answers.ts`, `allowances.ts`, ADR-0128)

- **A relay is a run in the asked thread.** `deliver` gathers both
  threads as they are now and plans (`planRelayDelivery`, over `planRelay`
  and `planDelivery`): it starts the run with the incoming entry first
  (`RunStart.incoming`), or makes the ask card the plan gave on a busy lane
  and asks for its drain. Every step is one keeper
  step; the `ask` hook's too, as `split-call.ts` is.
- **Whose agents a send may name is every open canvas's named threads**
  (`readReachableAgents`, over `reachableAgents`), wherever it is sent, so
  a branch's first message, whose thread has no card yet, names them too.
- **Reach is read before any root is opened.** Each step gathers both
  threads' `threadReach` from the session and the places, and refuses one
  out of reach (`unreachableRefusal`) before `threadsNow`, which opens a
  root only for a live thread (`threads-now.ts`): an archived canvas's root
  stays let go.
  `planRelay` and `planRelayAnswer` take the reaches too, so an ask card
  whose asker was archived since is refused, and an answer for it becomes
  an `undelivered` fact in the answering thread, as an answer held for its
  asker's run does (`planHeldAnswer`). The round is two plans across the
  model's request: whether to ask and about whom (`planRoundAsk`), then
  what its reply decides (`planRoundNext`).
- **A person's chat is relayed after it is written** (`relayMessage`, queued
  by `sendMessage`, not awaited inside its step): it finds the chat by its
  send's id, sets its allowance, and relays each member it asks.
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
  scribe (`lanelessSpot`, the drain's), since only a lane appends; a
  person's message to one is written through the scribe too (S21).
- **The allowance is read from the run's prompt** (`promptAllowance`): a
  relay's or an answer's names it, a person's message is its own, and only
  a run an agent started spends. Its count is kept in memory and written
  when it crosses the limit (with a `allowance-spent` fact in the thread that
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
  (`set_banner` answers `no-thread`). A thread named for a column before
  its first message is opened in no canvas, and takes one. A missing
  `column-banner` skill is logged.
- **A thread is due one as it is named for its lane** (`createNames`'
  `onNamed`): as a column about to create its lane asks for its name
  (ADR-0057), or as a lane is created. A chat's thread is named and
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

- **Planned inside the command that asks**: `executeSend`'s `create-and-run`
  calls `laneStarted` after `prepareLane`, so the new lane's record is
  among the root's, and a `retitle` command calls `asked`. Both are steps
  on the documents' keeper already, so `titles.ts` gathers and plans
  (`planTitling`) without a step of its own, and only the request goes out.
- **The prompt is given, not read**: the run writes it after `executeSend`
  returns, so `laneStarted` takes its author and text from the chat's
  details. The title is settled as the canvas's mark (ADR-0116), keyed by
  the canvas, so nothing waits for the root's first entry.
- **The answer is planned again**: it is a late write on the canvas, so an
  archived canvas takes nothing, and an unasked title gives way to any mark
  written meanwhile (`titleStillWanted`). `planMark` writes it, so an unchanged title writes
  nothing.
- **Only an unasked request is `held`**: a person's Auto-update goes out
  even while an unasked one is out for the same canvas.
- A missing `tab-title` skill, or a reply `replyTitle` refuses, is logged, and
  nothing is written.

## HTTP

- **Admission comes first**, for a request and for an upgrade. Nothing
  reaches the page, the blobs, a review's reads (`/review/…`) or the
  Exchange without it.
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
  stop `/@vite/client` from connecting, and without `server.ws.server`
  (`hmr.server` before Vite 8) Vite listens on port 24678. Behind a tunnel that socket hangs, and Firefox,
  which opens one WebSocket to a host at a time, held `/ws` behind it (S112).
  Vite's own host check is off (`allowedHosts: true`): admission decides.
- **The machine's measurements are a `GET /machine/measurements?days=N`**
  (`routes.ts`, 1 to `MEASUREMENTS_KEPT_DAYS`, all of them by default),
  admitted as every request is: JSON lines, the first naming the backend
  and the memory's source, then every row of the four tables, each naming
  its table.
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
| `adapter.ts` | `ProjectAdapter`, which carries its `kind`: opened by setup where it reads your repo's names, with the runtime, a folder project's `FolderDisks`, the session's lane files and the records, before anything else reads the project (`OpenProject`: `kind`, `fileAt`, `prepareShared`, `identity`, `acceptedNow`, whose checkout is bound to its read, or none for a folder), then started once lane work has its registry and its lanes are ready, with `keepStates` (`StartedProject`: the `Destination`, each lane's `history` from its record, refused for a lane of another kind, and `Splits`). The registry and the containers it is started with are bound late: neither is asked for before startup ends |
| `destination.ts` | `Destination`: accepted work and proposed changes as any kind has them: a file at a point (`fileAt`), where a new lane begins (`begin`), what the base that got the latest is now (`baseNow`), an archive's lanes moved (`lanesMoved`), the proposed changes' acts (`ProposedChangesActs`), setup and publish (`AcceptedActs`), `quiet` and `close` |
| `setup.ts` | `openProject`: the project opened through its adapter, with your repo's names settled from your files and the working copy's `pinetrie.json`, before anything else reads it, and its lane configs, before pi's setup. `Setup`, all of it or none: the opened project, the lanes' ssh, the shared directories, the default-image check (the default image carries a browser, ADR-0041, and python3, ADR-0064), its lanes made ready before it returns, each a step of the start (`prepare`: the images, the runtime, the slot served, the observer connected, the base snapshot; `ready`, a value), `specOf`, the granted host paths (planned at its start, from the roots of the commands pi's setup loaded, none inside the project and none holding pine·trie's own directories, ADR-0036), and the base snapshot's refreshes |
| `config.ts` | `pinetrie.json` as a fact of a state (ADR-0135, ADR-0146): accepted work's copy read at accepted work (`Destination.fileAt`) at startup and when the base moves (`readAccepted`), decoded by the host's table and settled with the start layers, its shared directories (the settled `lanes.shared`) prepared again, and put in force (`takeAccepted`, `onTaken`) once what it names is shared; a lane's own copy and the copy it started on, read at its tip and its start before its container starts (`readLane`), so `specOf` and the prompt's facts use the lane's config; the note on a write of the file (`configNote`, the `configWritten` hook): what it changes, and each key not taken. A lane with no commit in your repo yet runs with accepted work's |
| `shared.ts` | the shared files' lineages (`pinetrie.shared`, ADR-0135), one recorder for every lane and the watcher, so none reads and writes a lineage at once: a turn's accesses of shared files (`classifyWritesOnQueue` hands them over), based on what the lane last read, numbered and flagged (`planSharedLineages`) after the turn's queued step, since the lineages are every lane's; the watcher's stamps (`seen`); a whole directory's scan (`scanned`), whose missing files' lineages go once every version is older than the host's start (`planGoneLineages`); and a thread deleted from the trash, which leaves every lineage it read (`forgetReaders`, from `sweepTrash`). An earlier turn found concurrent after its rival is learnt has its revision record rewritten; one whose record is not written yet keeps what it says |
| `shared-watch.ts` | your writes to the shared directories as they are made (S169): each directory of accepted work's watched (`watch-dir.ts`, with no quiet window), each file an event names stat'ed into the stamp a lane would read, and handed to `shared.ts`. A scan at each start, and after a dropped-events error, finds what changed unseen, and what is gone. A listing that fails throws, so it never reads as every file gone; only a missing directory lists none. A delete event lets nothing go: the next scan does. It follows accepted work's list (`LaneConfigs.onShared`). Lanes' writes come by here too, and are claimed when their turns are recorded |
| `registry.ts` | `LaneRegistry`: each lane's handle, its record, whether it is a lane of its own; the only module that touches the handles; `withHistory`, the one way to a lane's `LaneHistory`, which queues its function on the lane's queue with the history, the handle and the lane's record; refused, with nothing queued, for a lane with no record, no copy of its own, no fork record, or a history the adapter does not keep; each lane's link registers it with `Ready`'s observer (`laneLinkOpener`), so no lane is observed before the observer is |
| `containers.ts` | `access` (its prompt's facts from the lane's grants, `laneFacts`, pure), a container's start (`decideContainerStart`, `@pinetrie/lanes`': the container's plan, then the start from the lane's fork record, which reads, only when the container must be made, its disk, and with that gone its revision records' snapshots and `keptSnapshot`, then each snapshot newest first until one is there (`factsOf`); the start's steps, from its plan alone, which makes a nested lane's data root and a folder lane's states directory before the container (ADR-0205); a fork owed runs `create.ts`'s fork; after a restore from a snapshot, the history's `afterRestore`, for jj `pre-rename:`, since a snapshot made before the rename holds the old names (S114); run from a queued step, which hands it the history; every start loses stale outputs, `removeStaleOutputs`), `beforeRun`, `runEnded` |
| `inner-docker-data-roots.ts` | the host's one `InnerDockerDataRoots` (ADR-0169), in memory: which nested lane's container stopped last after a run, and which run end each lane's inner Docker data root is as of. `containers.ts` names a lane the last in the step that stops it at its run's end, after the stop, so it is stopped when others clone it; a start or a fork asks where a data root comes from, and records it once its plan's steps ran (a start's says so: its `dataRoot`). After a host's start there is no last run's lane until a run ends |
| `turns.ts` | pi's `turnDone`, in two phases (`@pinetrie/rules`' `planTurn`, from the tree; then `planTurnRevision`, which takes the `TurnToCommit` only `planTurn` makes): the turn's revision (`recordTurn`), its classes and snapshot (`disk.ts`), its whole-disk diff, and what follows its commit (`follow`, for jj its fetch), fired once the snapshot step is queued (`queueTurnEnd`); the turn records still being written (`pendingRecords`). A revision is titled by its message's first line, else what its first call is for (`revisionTitle`, `callPurpose` from `@pinetrie/interface`): its intent (ADR-0173), "Run the unit tests", else its words (ADR-0114: `shell pnpm test`, not `bash …`). A lane is fetched into your repo only after a turn that commits, so a lane that never changed a file has no `tip@pinetrie-<lane>`, no refresh and no `pinetrie.base` until it gets the latest (a clean merge is fetched) |
| `create.ts` | a new lane: `checkBegin`; its record, its fork owed, and its name (`prepareLane`, one for hosts with and without lanes, writing `planLaneRecords`; its `history` the kind of the disk it will clone, `sourceHistory`); its fork, which the lane's start runs (`fork`: where it begins read from its thread's record, `forkEntry`; `forkFacts` waits for `pendingRecords`; `forkSource` refuses a disk of another kind than the record's, thrown with `foreignLaneWords`; `planFork`'s steps through `executeFork`; then one write, `forkEnd` over `@pinetrie/rules`' `planForkEnd`) |
| `update.ts` | an update (`withLaneStarted`, then one queued step, `@pinetrie/rules`' `planGetLatest` and `planSettle`, then `applySettle`, which fires the merge's `follow` after `recordUpdate`), whose message says what the merge's stale outputs removed; `getLatestInRun`, the agent's `catch_up`, in two phases around the merge (`planLatestInRun`, then `planLatestInRunAnswer`, which takes the `LatestInRun` only the first makes); `askedAboutConflict`, which asks the lane's history for conflicts in its copy |
| `archive.ts` | a close's or a reopen's teardown (`planArchive`'s), off the documents' keeper; its lanes' history moved in the destination (`lanesMoved`); an archive's entries' snapshots marked to delete, never deleted here (`UpkeepAsks`: the disk upkeep deletes them, so a crash leaves them marked, never lost track of), and a restore's lanes' marks undone, each a step on the machine manager's keeper |
| `shares.ts` | what lanes may mount and reach, shared into the lane VM's slots and granted: the decision (`planShareAndGrant`) and, on the Mac, its state behind one queue (`createShares`: a share, a new lease's reset, the extra slots' close) |
| `runtime.ts` | the one place that picks the runtime, from the project as startup found it (`ProjectDir`): gathers, plans (`planRuntime`), and builds the `LaneRuntime` lanes of their own get (`Setup.runtime`), wiring `@pinetrie/vm`'s lease to `@pinetrie/docker` on the Mac |
| `ssh.ts` | lanes' ssh (ADR-0140): what the host reads of the person's and the service folder's (`ssh/` in pine·trie's config directory) ssh files, from `lanes.ssh` as settled (`sshChoice`), the lanes' files, the service agent and the host's socket (`@pinetrie/ssh`), what each lane is given (`attachedFor`, `holdsFor`), and the owner's answers, which it follows in `pinetrie.access` |

- **State lives where it changes.** What startup found is `Setup`'s, fixed
  after it. Each lane's handle is the registry's. Each coordination set is
  owned by the module that writes it, behind a function: `turns`' pending
  records, `base-news`' steers told, the last run's lane
  (`inner-docker-data-roots.ts`).
- **One `turns` and one `updates`.** `index.ts` makes each once and builds
  pi's `hooks` from them, so a fork waits on the records this `turnDone`
  adds. A second instance would have its own set, and the fork would wait
  on the empty one.
- **The queues a lane's work crosses:** its own `LaneQueue` (the start and
  the fork it runs, each turn's commit and snapshot, the bundle, the stop and trim),
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
- **A lane VM whose disk is full at its boot is repaired at the start**
  (`runtime.ts`' `vmFound`, ADR-0210): a first lease that fails as
  `DiskFullAtBoot` runs the machine package's executor with the host's
  repair controls, before anything else, as a build the checklist words
  (`vm-disk-repair`, its `[repair]` lines its progress), then leases again.
  A repair that fails, one a recorded failure refuses, or an observing host
  refuses the start, saying why and what would let it try again. A host
  that manages makes the repair boot ready at its start, beside the lanes
  (`ensureRepairBoot`), and its close waits for it. While another host
  starts the VM or repairs its disk, the start waits on the repair lock
  and says which (`vmStartWaitWords`).
- **A lane waits for memory at its gate and at its start** (ADR-0212,
  `memory-holds.ts`). The gate is the lane's queue going idle, then the
  machine letting it make a tool call (`waitUntilAllowed`), then its
  channel; the whole wait, the queue's included, settles on the call's
  abort (`settledOrAborted`), since a call can wait behind a held start. A
  run's start waits for the machine in its queue step (`holdStart`), so its
  first tool call waits behind it while the model thinks its first reply.
  Only that far: the run's turn (`turnDone`) queues behind the held start
  and pi's loop awaits it, so from the first reply's end the whole run
  waits for room. And pi's abort waits on that turn: so a Stop abandons the held start before it aborts
  (`runs.ts`' `cancel`, `abandonStart`), as do the run's end and the host's
  close; an abandoned start starts nothing and is no failure, so the queue
  does not break. The containers reach `waitUntilAllowed` through a binding
  made once the machine is watched, letting every lane through before then
  and on a host that watches none.
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
  2. the snapshot, which so holds the registry its outputs are kept by,
     taken under its index row (`takeIndexedSnapshot`,
     `work/snapshot-taking.ts`, the only caller of the index's `reserve`,
     `markTaken` and `markNotTaken`; an update's merge takes its snapshot
     through it too): the row reserved first, then the snapshot, then the
     row marked taken, which gives the `IndexedSnapshot` the record is
     written with (`writeRevision` takes a `RevisionToWrite`). A snapshot
     that fails marks its row not taken. An index write that fails skips
     the snapshot, or leaves it unnamed, and is told to the machine
     (`snapshot-skipped`), so branching at that turn starts from the one
     before, and the health says so. A use of a snapshot is recorded where
     it is read: the turn's diff from the one before, a fork's source
     (branched, before its clone), a container's restore;
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
  says what goes as removals, exactly their paths are deleted, and the
  registry rewritten. A failure is reported and the step goes on: a stale
  output is a rebuild the agent misses, not a broken lane.
- **Getting the latest tells what it removed** (`update.ts`, ADR-0184):
  `removeStaleOutputs` returns its removals, they join the merge's facts
  (`SettleFacts.removed`, required, so both the agent's `catch_up` and
  your get-latest carry them), and `planSettle` words them into the
  update or land message. A failed removal tells nothing. A container
  start's removals are not told: no message carries them.
- **Every grant is told to the lane, or left out by name** (`laneFacts`,
  `containers.ts`): its `grants` literal `satisfies` a record of
  `LaneGrants`' keys, so a new grant fails `tsc` until the lane's facts say
  what its agent is told of it. Host ports are left out, since whether
  `$PINETRIE_HOST` is set depends on the runtime's target. `tsc` also
  refuses a key pi's facts lack only while the literal stays inline in the
  returned facts.
- **An update is one step on the lane's `LaneQueue`** (`updateOnQueue`):
  the copy found ready (`readyToMerge`, whose `ReadyCopy` alone `merge`
  takes), the lane's base from its own history, accepted work and the unfinished work
  from the destination (`baseNow`), `planUpdateFrom`, then `merge`: the
  edits committed and, for jj, `mergeUpdate`
  (which first joins each accepted thread commit the lane holds to its source, ADR-0079), so nothing
  changes the lane between what is read and what is merged. Before the
  merge, `planGetLatest` settles the floor a resolution's prompt must fit
  (ADR-0084), from the resolve-conflicts skill, read before the step, and
  the card's text: getting the latest whose smallest prompt would not fit is refused
  with the lane untouched, since a merge left without a prompt is one no
  later getting the latest merges again (S106). Then
  `planSettle`, pure, decides what the thread gets, the land message
  included, and `applySettle` writes it, then fires what follows the merge
  (`MergeDone.follow`): the adapter's own, which lane work never reads. For
  jj, `planFetch` decides what is fetched: a clean merge, and a move to
  accepted work with nothing to merge, whose mark your repo would otherwise
  learn of only at a later fetch (`packages/jj/TECHNICAL.md`, A lane's
  repo).
- **Getting the latest from the thread a thread branched from** (ADR-0072) is the
  same step: the card's command picks the rule. Its facts come from the
  lane's root document, not your repo (`parentNow`, with whether the
  parent's lane runs from `pinetrie:live`), and `planParentUpdate` decides;
  the parent's newest commit is fetched by id into the lane like accepted work's.
  A resolution's prompt names the incoming side as that thread's work.
- **An update stops the lane it started** (`withLaneStarted`), whatever it
  comes to, unless a run follows: a resolution, or the chat a quiet
  getting the latest goes before (`follows: "run"`). That run's end stops it.
- **The agent's `catch_up` merges during its run** (`getLatestInRun`,
  ADR-0080, S103): the same `updateOnQueue`, with no start or stop of the
  lane and nothing appended: the tool's result is the update, and the
  turn's record names the merge (`turnMerged`). It is refused unless the
  call is its turn's only one and there is something new. Every time it gets the latest,
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
- **A lane's fork is a record, owed from the send until its last step**
  (`pinetrie.lane-fork`, ADR-0167). The send writes it with `LANE` and
  queues nothing; the lane's start forks it when owed, from the top, so a
  fork a host stopped part way runs again (S226). A fork that fails breaks
  the lane's queue, and the next `beforeRun` resets it and starts the lane
  again, still owed: retrying needs no code of its own.
- **A fork's state is read in the step, never when it was queued.**
  `withHistory` checks only that the record exists, which never changes
  once written; a step queued while another forks would otherwise carry
  "owed" and fork the lane twice.

## Lanes' ssh (`work/ssh.ts`, ADR-0140, ADR-0170, ADR-0178)

- **Its socket's path comes first:** `prepareSshDir` makes its directory
  before the runtime is found, since the Mac's lease names the socket
  (`hostSocketIn`); it listens only once setup has read the configs, before
  any lane is made. Docker binds it as a lane is made, and the launcher
  connects to it for each of a lane's connections.
- **A lane is given ssh only if it holds an identity:** a usable service
  key, or the person's own, which your config grants, or the project
  does and the lane's own config keeps (`laneMayAsk`). Its agent is told
  the same, and the hosts your identity may sign for (`holdsFor`).
- **Two rounds at start** (ADR-0170): the files are read and the combined
  config written, which `ssh -G` needs; then each name your
  `lanes.ssh.hosts` allows is resolved to the name ssh checks its key
  under, before the lane's files are planned. A name with no key in your
  `known_hosts` is said in the log.
- **The record is the one truth, and no signature waits on it**
  (ADR-0178). The relay's `mayUsePersonal` is answered at once
  (`planPersonalSign`): an allowed lane signs, any other is refused, and
  a lane that never asked writes `waiting` as it is refused. The
  `ssh-access` command only writes the record.
- **Each change to the record is news, once** (`planAccessChange`,
  `LaneSsh.onNews`, lane work's `onSshNews`): asked, allowed, denied or
  taken back. It is read from the record, not from whoever wrote it, so two
  signatures that both wrote `waiting` make one change and one piece of
  news. A take-back closes the lane's connections through the host
  (`host.cut`), and containers run `KILL_SSH` in it.
- **Ssh news reaches the lane** (`ssh-news.ts`, made after the agent,
  beside base news): a late step on the lane's thread, so a thread out of
  reach is skipped, placed by the delivery an answer uses (`delivery.ts`).
  A request, a denial and a take-back are ssh facts, steered into a running
  lane or appended; an allowance is its owner's carry-on, which wakes an
  idle lane (`planSshNews`).
- **A signature refused for a host outside your allowed ones** is written
  to the lane's record (`planAccessOutside`) and logged, once each time
  its host or key changes, so a lane that retries writes nothing
  (ADR-0170).
- **A starting host keeps every request** (`recover`,
  `planAccessRecovery`): no signature waited on one, so a stop lost
  nothing. It clears a refusal for a host outside, since your allowed
  hosts are read again then.
- **Shutdown** is part of lane work's close (`"work"`): the socket and the
  service agent closed, and the socket's directory removed.
- **No suite reads the person's ssh:** `startHost`'s `ssh` names the
  folder and agent, and the harness gives every suite host an empty one
  and none (`suiteSshPlaces`).

## jj's adapter (`jj/`)

- **`startJjProject` takes a jj project alone** (`JjProjectDir`,
  `Extract<ProjectDir, { kind: "jj" }>`, `project.test.ts`). Opened, it
  takes your repo's names as settled (`repoNames`, from your files and the
  working copy's `pinetrie.json`), starts the owner of your repo, and
  reads files at a point (`readRepoFile`, `@pinetrie/jj`). Started, it makes accepted work
  (`jj/accepted.ts`), the proposed changes (`jj/proposed/`), the fetches (`jj/fetch.ts`)
  and the splits (`jj/split.ts`), and each lane's history (`jjLaneHistory`),
  whose `follow` is the lane's fetch into your repo.
- **Each jj or git command on your repo over half a second is logged**
  (`onSlowCommand`, `slowCommand`): `[host] your repo: <command> ran <n>
  ms`, its arguments as its caller gave them, cut to a line. The owner's
  `slow` names the step, and where its time went (`slowStepLine`): each
  part of 1 ms or more, the rest, and its jj and git commands, whose time
  is inside the parts. A refresh's parts are its `gather`, `message facts`,
  `base record`, `read`, `record` and `repair` (`jj/proposed/refresh.ts`),
  beside the owner's own.
- **A starting host says when a tidy is due** (ADR-0155): one pinned read of
  your whole op log (`readOpLog`), tracked and never awaited, so the start
  does not wait for it; when its oldest operation is more than twice the
  window old (`planTidyHint`), one log line naming `pnpm tidy`
  (`tidyWords`). A read that fails says nothing.
- **A lane's fetch reaches the lane through `withHistory`** (`jj/fetch.ts`),
  as anything on a lane's history does, and its import is the owner's.
- **A split's prompt, and its end** (`jj/split.ts`, `finishSplit`, which
  moves the lane back to its tip even when a step before it throws: left on
  the stack, the lane refuses every time it gets the latest).

## A folder project's adapter (`folder/`)

- **Only `folder/` touches the project's folder** (ADR-0142); `@pinetrie/folder`
  decides for it, and lanehost's disks role does the copying.
- **The adapter decides nothing it can hand to `@pinetrie/folder`**
  (ADR-0193): a lane's states are read once (`laneStates`), and what a
  read, a turn, getting the latest, a resolution, a write's commit or a
  concurrent save records is the package's (`FolderRecords`:
  `planStateRecords`, `planGetLatestRecords`, `planResolve`). The record
  specs are `@pinetrie/rules`', which the package does not declare, so
  `record-writes.ts`' `recordWrites` is the one place those records become
  writes. A write's journal is written by the write itself, before each
  step it names (`write.ts`). What still calls two of the package's
  functions in a row does so across I/O the first asks for: a read's
  then a merge's gathers (`merge.ts`, `review.ts`), the shown merge made
  between its plan and its records, a concurrent save read in.
- **The project's one queue** (`createQueue` in `index.ts`): the folder's
  reads run on it, and so does every time it gets the latest over a virtual base, from
  making the base to deleting it. A virtual base is named by its bases, so
  two lanes merging the same bases share its snapshot; one at a time,
  neither deletes it under the other. Such getting the latest reads no folder on
  the queue (its `from` was read before), so it never waits on itself.
- **A read** (`line.ts`, one at a time on the project's queue): gather (the last
  read's stamps, from the session's `folder-stamps.json`; the scan,
  `scan.ts`), plan (`@pinetrie/folder`'s `planLineRead`), execute (lanehost's `read-in` into a
  new state, `line-<uuidv7>`, its parent accepted work's newest). A read
  whose paths moved during their copy is read again, five times at most;
  nothing changed makes no state, but the first read of the project's folder makes one
  even of an empty folder. With no stamps kept, a read copies every path
  into an empty disk, so nothing deleted since lingers. The stamps are
  written only once the state's record is, so a lost write costs one
  whole read, never a wrong one.
- **The scan** (`scan.ts`) walks by `lstat`, reads each directory's
  `.gitignore` as it enters it, and never enters an ignored directory: what
  is source is the lanes' own rule (`ignoredPaths` with `laneIgnores`).
  Symlinks are stamped by their target, never followed.
- **The watcher** (`watch.ts`) reads the project's folder once it has been quiet for
  10 s after a change to a source path (`isSourceChange`); a change only
  ignored paths saw reads nothing, and a dropped-events error reads at once.
  Every read waits for lanehost (`ProjectParts.ready`): the watcher's go
  through `acceptedMoved`, which setup runs once lanes can.
- **A lane's history** (`history.ts`) is states of the graph: its start
  (`startRecords`, its parent the state its disk was restored from, whose
  write it returns for the fork's end to write with the fork record; the
  states directory's `start` op runs before, harmlessly again in a fork
  run again), each turn
  (snapshotted after the lane's `sync`, then diffed against the lane's
  newest: no state when no source path changed), each time it gets the latest (the path
  merge, `merge.ts`, on the graph's base, `virtual-base.ts` merging several
  first; two parents; `planLaneMerge` decides whether there is anything to
  merge, and over which base). Getting the latest whose base's snapshot is missing is
  refused (`MergedOf`'s `refused`), before it makes anything, with words
  the card and the agent's `catch_up` show; a virtual base no record names
  is deleted once merged over. What differs between two states is `changes.ts`'s
  one answer: the disk's diff, made or gone directories read as their
  files, files rewritten alike dropped, source paths alone. A conflict is a
  `CONFLICT` record and its three versions in the lane's states directory;
  `resolve` writes the version chosen and closes it.
  `follow` is always null: nothing is fetched.
- **The destination** (`index.ts`): `begin` and `baseNow` read the project's
  folder first, so getting the latest merges its newest state; unfinished work is refused. Each run's
  end builds the lane's proposed changes and base records (`folder/proposed.ts`) and describes
  the proposed changes with the host's describer (`describe.ts`, jj's too); accepted
  work moving rebuilds every folder lane's. A squash is refused
  (`not-a-stack`). Accepted work's acts are by kind (`Destination`'s
  `accepted`: jj's `act`, a folder's `restore`), so the command handler
  refuses a setup or publish to a folder project, and a restore to a jj
  one, in one place (`commands/lane.ts`).
- **Proposed changes are the shown merge** (`folder/proposed.ts`,
  ADR-0159; planned by `@pinetrie/folder`'s `planShownMerge`, then
  `planFolderRecords` once the merge is made): the lane's tip merged onto accepted work's newest
  (`mergeToState`, `merge.ts`, shared with getting the latest), made on the
  project's queue whenever either moves, on a scratch disk
  (`withScratch`, `scratch.ts`, which a virtual base and a restore's
  snapshot use too), snapshotted as `shownMergeId` and not made again while
  kept; the one it replaces goes unless an accept made it a state. A
  conflicted one keeps git's markers. The record's files are accepted
  work's newest → the shown merge, and the base's forecast the lane's tip
  → the shown merge: what getting the latest would change in the lane.
- **Every folder review is one reader** (`readFolderReview`,
  `folder/review.ts`): open proposed changes, asked as `start..tip`, read
  `start` → the shown merge; two states accepted work keeps (a history
  entry, a restore's preview) and a conflict's base and side read as they
  are, each span found by `planReviewRead` (`readableSpan`). Its rows are
  `planFolderReview`'s, a move found from the pairs of equal size whose
  bytes `same-content` proves equal. A file's diff is lanehost's `file-diff`;
  a side's bytes stream from its state's snapshot (`fileOut`, through the
  disks role's `file-out.ts`), typed by `path-facts`' `content`, never by a
  name, and served by `bytesResponse` (`responses.ts`): an image as its
  type, anything else an attachment, every one `nosniff` and sandboxed, as
  a blob is.
- **An accept and a restore are one executor** (`writeStateNow`,
  `folder/writes.ts`): each gathers and plans (`planAccept`,
  `planRestore`), then writes its state's content (`writeContent`) by the
  steps below. A restore's own snapshot is made at its commit, from its
  content on a scratch disk, before its `STATE` record: a step recovery's
  finish finds done or does, so a restore stopped after its last link has
  its snapshot made at the next start. A restore calls `moved`, as any
  read of the project's folder does.
- **An accept is one step on the project's queue** (`folder/writes.ts`):
  the project's folder read inline (`FolderLine`'s `readNow`, since a
  queued read would wait behind the step forever), so every save before
  the press is a state and refuses an accept of what was shown before it;
  the writes planned (`@pinetrie/folder`'s `accept.ts`); a staging
  directory `.pinetrie-accept-<uuid>` at the folder's root, whose
  case-folding a probe file answers; the shown merge's regular files
  streamed into it by `tarOut` and extracted by the system's `tar`
  (bsdtar on the Mac, GNU tar on Linux), then checked; the journal
  (`FOLDER_WRITE_JOURNAL`) written; each path's check, move aside into
  `.pinetrie-aside-<uuid>/`, check by inode, size and mtime (a rename
  changes ctime) and `link(2)` or `symlink(2)`, which fail where anything
  stands (`write.ts`). Only with every path linked (`AllLinked`, which
  only `write.ts` makes) is the accept's state recorded, the staging
  directory dropped (unlinking a staged file moves its target's ctime),
  and the folder's stamps written as the read's with each written path
  stamped anew, so the next read answers current. A check or link that
  fails puts every path back and refuses `folder-moved`, naming the path;
  what the folder cannot hold refuses `folder-cannot-hold` before
  anything is written.
- **The line's first read recovers, and a quiet read checks asides**
  (`line.ts`): before it, each open journal is finished or put back and
  a startup line says which; a staging directory no open journal names
  goes. A read the watcher sets off checks the asides ended journals kept
  first: an unchanged one is dropped, a written-through one read into a
  concurrent save (`ReadPath`'s `source`) on its `keptOn`. A write into an
  aside is a source change to the watcher (`isSourceChange`), since it
  lands nowhere else; the accept's own read leaves asides alone, being
  never quiet. The scan never enters either reserved name at the root
  (`FOLDER_RESERVED`).
- **What is kept is said once** (`planKeep`, `keep.ts`): from one
  `liveStates` call and one listing of the project's snapshots
  (`LaneDisks.snapshots`), the states whose snapshots exist and the live
  set keeps not go, and accepted work's line states and concurrent saves
  that are kept and exist are its record's `kept`, newest first: what the
  history lists and a restore may write. `refreshKept` (`folder/index.ts`)
  is that record's one writer: it writes `{ newest, kept, at }` when they
  changed, then deletes what goes, one call at a time, so an earlier
  gather never writes over a later. It runs at start, at each run's end,
  and on every move of accepted work, since `folder.history.states`'
  window moves with it. Every `STATE` record stays. It is the one
  listing of every snapshot, which stats each (S247): it needs them all to
  find the ones nothing keeps, and nobody waits on it, since it runs
  tracked, off the documents' keeper.
- **A person's choice of a conflict's version is a resolution, as the
  agent's is** (`LaneWork.resolve`, `work/index.ts`): refused while the
  thread runs or for a lane not the host's own (`planResolveCommand`);
  else the conflict closed by the history's `resolve`, which records a
  `resolve` state. Its snapshot is the disks role's, with no `sync` in
  the lane's container, which may be stopped: a btrfs snapshot holds
  what its kernel wrote, flushed or not (S225). The agent's own
  resolution, in its run, syncs first, as every turn does. Then the
  proposed changes are rebuilt (`act(lane, "refresh")`, its fact dropped),
  and the `resolved` fact is queued on the thread.

## Proposed changes (`jj/proposed/`)

- **Every step on proposed changes runs on the owner of your repo** (`@pinetrie/jj`,
  `packages/jj/TECHNICAL.md`, ADR-0065), since a take once waited behind
  every refresh queued before it (S89). An action on proposed changes, a `line`
  command, a split's span and its end, and moving lanes' refs are owner
  commands; a refresh is upkeep, `later("refresh:<lane>")`, and accepted work's
  record `later("line")`. So a command waits for at most the one step
  running, however many refreshes are marked, and a lane marked many times
  before its refresh starts refreshes once.
- **What marks a lane** (`@pinetrie/jj`'s `planMarks`, pure, from the owner's `onMoved`): a
  move of accepted work or unfinished work, or the first observation (`all`), marks the
  line's record, every named lane whose root is not archived, and every
  open record; your `@` alone
  (`workingCopy`, jjui and your editor) marks no lane: one `later("shared")` step
  rewrites each open record's `workingCopyEdits` (its files that `@` changes,
  `planWorkingCopyEdits`) and
  accepted work's record from its own facts (`acceptedFacts`); a lane's
  ref (a fetch's import) marks that lane; proposed bookmark the lane its
  thread names. A run's end marks its lane, then describes it. A refresh
  that wrote is observed, and refreshes the lanes it moved once more: that
  one reads, plans `none`, and writes nothing, so it ends there. The record
  is only a hint of where to look: it is how proposed changes you abandoned by hand
  is built again. A bookmark of yours that no proposed changes depend on moves
  nothing. Every named lane, not only those with proposed changes, so each lane's
  `pinetrie.base` follows accepted work, and with it what getting the latest would
  change. Not an archived root's lanes: they have no base to follow
  (`gatherRefresh` gives them none), and their refresh only withdraws proposed changes. What could still hold one marks such a lane anyway: its ref or its
  proposed bookmark (the first observation reports every bookmark as moved),
  or an open record. That is safe because an untraced start, or what jj cannot say,
  builds nothing (ADR-0067): a thread accepted before proposed changes carried
  `Pinetrie-Source` is not proposed again (S97).
- **Reads are pinned and never queued:** a page's review or diff
  (`ProposedChanges.read`), a description's gather, and lane work's reads of your
  repo run at the head the owner last observed (`owner.read`). Proposed changes
  acceptance gathers in its own command, unpinned, so it acts on the repo as it is.
- **The host decides nothing and runs no jj on proposed changes.** Each step is a
  gather (`@pinetrie/jj`: `gatherRefresh`, `gatherProposedChanges`, `gatherAcceptance`,
  `gatherStack`, `gatherDescribe`), a decision (`@pinetrie/rules`: `planRefresh`,
  `planAcceptance`, `planRebuild`, `planStackEnded`, `planDescribeSettle`),
  a translation into steps (`@pinetrie/jj`: `buildEffects`, `proposedChangesEffects`,
  `acceptanceEffects`, `rebuildEffects`, `describeEffects`), and `executeProposedChanges` (`execute.ts`),
  which carries out every action over ports: the lane's base record first,
  when it differs from the page's, then the steps, then what comes after
  (`ProposedChangesEffects.after`). So the rules are tested as values in the two
  packages, what the host writes is tested over `record<T>()`, and
  `packages/jj/repo-*.test.ts` prove the reads and steps against real jj.
- **What only the documents know is read here, first** (`state.ts`,
  `ProposedChangesDocs`): the thread's name, whether its root is archived (from its
  board place, `readArchived`, never from the lane's tip being missing: a tip missing
  for one import, S78, must not withdraw live proposed changes), the last getting the latest
  read (`pinetrie.base`, a memo `readGetLatest` keeps at the same tip and base
  commit, never read to decide), the lane's tip entry and the unfinished work line.
  **The tip and the unfinished work line are read only after a decision to build or
  rebuild** (`isBuild`), both under one lease (`messageFacts`): reading them
  loads the lane's root, which the upkeep then lets go, and
  every lane is refreshed at a start and whenever accepted work moves,
  most deciding nothing that writes a message. `refresh.test.ts` counts
  the leases.
  Everything else is read from your repo (ADR-0104), and where proposed changes
  sit is decided once there (`ProposedChangesPlace`): unfinished work gone moves nothing and
  writes only its base record; an untraced start builds nothing, so squash,
  refresh, describe and a split's span refuse it, while an acceptance, a
  bookmark move, can still accept proposed changes you edited there.
- **The records are written from the repo after each step**
  (`ProposedChangesRecords`): proposed changes' from the read made before planning when the
  step ran no steps (the common `none` reads nothing more; a `mark`, which
  moves only the host's version of the proposed changes, reads it again), else from a new
  read; `withdraw` and `forget` remove it; an acceptance writes it marked
  accepted (`acceptedAs`).
  Each write is skipped when it changes nothing, and the records are read
  only for that. A base record that changed is reported (`baseChanged`), so a
  running thread whose base now has news is told (`base-news.ts`,
  ADR-0080); the report queues a keeper step, never awaited from the owner's
  command, which would wait on itself.
- `refresh.ts` carries out a refresh and a rebuild, and gives the ports;
  `describe.ts` gathers by a pinned read, asks the model outside the owner,
  one request per lane at a time (`describing`), and writes in an owner
  command; `act.ts` and `stack.ts` are the actions and a split's stack;
  an action is planned once (`@pinetrie/rules`' `planProposedAct`, which
  returns its fact).
- **A root archived or restored moves its lanes' refs in an owner
  command** (`ProposedChanges.moveLanes`, called by `work/archive.ts`), then marks
  each lane: an archived thread's proposed changes are withdrawn, a restored one's built
  again (ADR-0061).
- **An acceptance names the proposed changes it was shown** (`ProposedChangesSeen`, ADR-0065): the
  ledger its record carried, and whether it conflicted, which the page's
  session client reads from the record as it sends (`proposedChangesSeen`).
  `planAcceptance` refuses `offer_changed` when the ledger now differs (its source, or its
  start as a set), or the proposed changes conflict now and did not then. A rebase
  onto a moved target and your edit keep the ledger, and are accepted.
- **An acceptance names its destination** (`planAcceptance`): one of
  `acceptanceDestinations`, and refused (`bad-destination`) unless the bookmark is
  at or below the proposed changes' bottom's parent, read in the same command
  (`gatherAcceptance`). jj's
  refusal of a backwards move is the second guard (S77 item 1).
- **Setup and publish** (`jj/accepted.ts`, created by the adapter's start beside
  the proposed changes, which rewrite its record when the owner observes accepted work or
  your `@` move): decided by `@pinetrie/rules` (`planAcceptedAction`), its steps
  `@pinetrie/jj`'s. `setup` creates accepted work's bookmark at your `@-` and
  writes `immutable_heads()` and `revsets.log` to the repo's config, the
  text the publish button's setup showed (`planSetup`). A publish
  (ADR-0076, ADR-0090) is two rounds of gather, plan and execute in one command: the
  getting the latest (`planPublishGetLatest`, as you, only with `publish.catchUp` on
  and only when the working copy is behind), then the record read again, with
  the operation that got the latest from `SharedFacts.op`, decided by
  `planPublishFinish`, which takes the `PublishTicket` only
  `planAcceptedAction` makes, into the move (`planPublishMove`) or getting the latest's
  undo (`planGetLatestUndo`) and a worded refusal. A move jj refuses after a
  getting the latest runs the undo and rethrows: the one branch that is not a plan's
  value. The record's preview runs `git merge-tree` on your repo (the
  step's `git`). Setup and publish are anyone's, on any host: what a
  publish does is `publish.catchUp` (`RepoConfig`, carried on the record),
  never the bind or the invite key (ADR-0099).
- **The base snapshot follows accepted work** (`jj/index.ts`): the owner's
  `Moved.onto` refreshes it (`acceptedMoved`, then `refreshBaseSoon`), so setup, an accept, an
  accepting publish and a move made in jj outside pine·trie all reach it
  by one path. An acceptance into unfinished work does not, since the snapshot is
  accepted work's.
- **Shutdown closes the owner** (`LaneWork.destination.close`, the `close` step): it
  refuses every step from then on and stops its watch; `quiet` waits for
  what it holds (`LaneWork.quiet`).

## Testing the shell

- **Test a decision as a value** where the shell has one: `planRunEnd`,
  `planInvites`, the responses, `planSettle`, `planInvocation`,
  `storeChoice`, the startup lines' words (`startup-lines.ts`), `isHeld`,
  `planStart` (the store's start), and `planStartup` (`@pinetrie/rules`).
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
  written: `expect(writtenValues(records.calls)).toEqual([deleteRecord(MARK, entry)])`.
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
    run's end compacts; it serves only after `recover`;
  - `migrations/index.ts`'s `prepareStore`: stale command Lines are deleted
    at start;
  - `http.ts`: the request and upgrade handlers carry out a plan's refusal;
  - `packages/rules/message.ts`'s `attributed`: the model is told who spoke, which
    shows that pi's conversion sends `content`;
- **Tests in subdirectories run**: `vitest.config.mjs` includes
  `apps/*/host/**/*.test.ts`.
- **The acceptance is the suites'.** `e2e` and `e2e:browser` check the
  wiring; their mutations are in `scripts/mutations/app.ts`, and this
  directory's unit mutations in `scripts/mutations/host.ts`. The suites' own
  gotchas, and what their waits cost, are in `apps/pinetrie/e2e/TECHNICAL.md`.
