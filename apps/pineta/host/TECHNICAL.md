# The host's shell: technical notes

The host gathers facts, calls the pure decisions in the packages
(`@pineta/marginalia`, `@pineta/reads`, `@pineta/schema`, `@pineta/lanes`),
and carries them out. This directory is that imperative shell. Each module
does one thing and takes its dependencies as a parameter; `index.ts` alone
wires them.

## Where things are

| module | owns |
|---|---|
| `index.ts` | `startHost`: the store, the Exchange, the documents, lane work and the agent, then the wiring below |
| `basics.ts` | `Basics` (doc, log, ids, clock) and how a failure is logged (`messageOf`, `failed`) |
| `queue.ts` | `createSerial`: the one serial executor |
| `runs.ts` | a run from its start to its end (`createRuns`, `planRunEnd`), and the agent's `onStream` (`streamInto`) |
| `outbox.ts` | `drain`: an idle lane's held messages and updates, oldest first |
| `settle.ts` | what happens between runs: drain, then compact and sweep |
| `housekeeping.ts` | compacting the session, and deleting images nothing shows |
| `notes.ts` | each note's text, held, and each edit attributed |
| `startup.ts` | `recover`: what a starting host does before it takes a command |
| `control.ts` | the command Line of each client seat, and who its writer is |
| `commands/` | one module per command: `chat`, `note`, `archive`, `mark`, `lane` (stop, update, offer); `index.ts` decodes, checks the archive, routes |
| `http.ts` | the HTTP server: admission, Vite, the websocket, blobs, offer reads, invites |
| `responses.ts` | every answer the host writes itself, as a pure `HttpAnswer` |
| `routes.ts` | what a request or an upgrade gets, pure: admission first (`planRequest`, `planUpgrade`), then which requests are the host's (`route`) |
| `hot-reload.ts` | Vite's hot updates, held while a direct lane in the project runs |
| `admission.ts`, `policy.ts`, `lines.ts`, `blobs.ts`, `store.ts` | the invite key and links, the write policy, departed seats, the image store, the SQLite store |
| `work.ts`, `offers.ts` | lane containers and disks, and each lane's offer in your repo |
| `fakes.ts` | test support: `record<T>()`, `fakeLane`, `row`, `putValue`, `putNote`, `basics` |

## One serial executor

- **Every command, drain step and note record is a step on one `Serial`**
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
records written only when changed, and every note's text held.

- **Commands are taken only after `recover`.** `Control.listen` is made
  earlier, and `startControl` registers `onReceive` after `recover`. Earlier,
  a new message could run before an interrupted lane resumed, and jump a
  held one.
- **The agent and lane work are made in a cycle.** Lane work is made first
  and reads the agent lazily (`theAgent()`), because the agent is made with
  lane work's `access` and `hooks`. That is the only lazy read: every module
  made after the agent is given the agent.

## Commands

- **A command's id is its send's id.** The column that sent a chat finds its
  message by it (`TreeIndex.bySend`).
- **The archive gate is in the dispatcher** (`refuseInArchive`). A sent
  draft is checked there as a `note` command, so `sendChat` has no gate of its
  own, and `commands/note.ts` calls `sendChat`, never the dispatcher.
- **`executeChat` still checks a new lane's directory and asks pi for the
  lane.** Both are ports that may refuse, not facts to gather. The directory
  is checked first, so a refused send creates no lane.

## HTTP

- **Admission comes first**, for a request and for an upgrade. Nothing
  reaches Vite, the blobs, an offer's reads or the Exchange without it.
- **Every answer the host writes itself is a `responses.ts` value**, written
  by one `send`. A blob, a review and a diff are cached for a year
  (`IMMUTABLE`: each is named by what it holds); a refusal is never stored.

## Testing the shell

- **Test a decision as a value** where the shell has one: `planRunEnd`,
  `planInvites`, `draftSent`, the responses, and marginalia's `planStartup`.
- **Otherwise, drive a module with `record<T>()`** for exactly the port it
  takes, and a real `newSessionDoc()`. A method the test did not give throws,
  naming itself, so a module that touches an undeclared port fails at once.
  `fakeLane` holds a run open until the test finishes it. `row` and
  `writeEntry` put entries in the document, `putValue` a pi value (a work
  record, an archive record, a held item, a participant's name), `putNote` a
  note's record, and `writeLaneTip` a lane's tip; a running lane is
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
  - `notes.ts`: a note's edit is credited to its seat's person, from Kyneta's
    Yjs `clientID`s;
  - `marginalia/chat.ts`'s `attributed`: the model is told who spoke, which
    shows that pi's conversion sends `content`;
  - `work.ts` and `offers.ts`: until they are split, their rules are proven
    in `e2e:lanes` (and one in `e2e`).
- **Tests in subdirectories run**: `vitest.config.mjs` includes
  `apps/*/host/**/*.test.ts`.
- **The integration is the suites'.** `e2e` and `e2e:browser` check the
  wiring; their mutations are in `scripts/mutations/app.ts`, and this
  directory's unit mutations in `scripts/mutations/host.ts`.
