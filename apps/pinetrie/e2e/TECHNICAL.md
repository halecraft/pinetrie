# `apps/pinetrie/e2e` — technical notes

The end-to-end suites, each a directory of scenarios:

| suite | runner | scenarios | package script |
|---|---|---|---|
| `host` | `e2e.ts` | `host/*.scenario.ts` | `pnpm run e2e`; `e2e:live` runs `live` alone |
| `lanes` | `lanes.ts` | `lanes/*.scenario.ts` | `pnpm run e2e:lanes` |
| `browser` | `browser.ts` | `browser/*.scenario.ts` | `pnpm run e2e:browser` |

They share `checks.ts` (recording a check, and stopping at one),
`scenario.ts` (choosing, skipping and running scenarios), `harness.ts`
(waiting, `idleNow`, throwaway projects, joining a host through `@pinetrie/session`'s
`connectSession`, a host with no tools and `withHost`, positions and
starts, the scripted model), `lane-hosts.ts` (why the
suites' runtime cannot run here, `runtimeProblem`; hosts with tools,
`LaneHosts`; a section's host with accepted work set up, `sectionHost`; a
lane's shell, `inLane`; `cleanUp`) and `lane-runtime.ts` (the suites'
runtime's CLI, and a lane's container and disks read and removed as that
runtime keeps them). A suite's own helpers are beside its scenarios:
`host/support.ts`, `lanes/support.ts`, `browser/page.ts`.

## Scenarios

- **A host reads the suites' user config, not the person's.**
  `startSuiteHost` (`harness.ts`) and `LaneHosts` pass `SUITE_CONFIG`,
  which turns the automatic title off (ADR-0074), unless a scenario names
  its own file; one that writes its own spreads `SUITE_CONFIG` into it.
  `startHost` without a `userConfig` would read
  `~/.config/pinetrie/config.json`.
- **Lanes run on Docker** (ADR-0103): on the Mac against the lane VM, on
  Linux against the host's Docker, and inside a pine·trie lane granted
  `lanes.nested` against the lane's rootless Docker, its lanes in
  `/var/lib/pinetrie-lanes`.
- **In a lane, on its rootless Docker** (2026-10-08, the default image
  already built in the inner Docker; its first build adds about a minute):
  `pnpm run e2e` took 58 s (54 passed, `live` skipped), `pnpm run
  e2e:lanes` 134 s (64 passed; the Mac's network checks and ssh skipped)
  and `pnpm run e2e:browser` 223 s (177 passed). `pnpm run verify` runs
  the first two.
- **In a nested lane, inner lanes write as uid 1000,** the rootless user:
  each throwaway project is opened to others' search (`committedProject`),
  and only the paths lanes write are handed to that user
  (`ownForInnerLanes`), never a repository, which git then refuses to the
  host. A lane's writes there are uid 1000's (`lanesWriteAs`).
- **Every agent with tools works in real lanes** (ADR-0102). A scenario
  whose agent has tools declares `lanes: true` (`Scenario`, `scenario.ts`):
  the runner asks `runtimeProblem` once per suite, skips the scenario with
  its words where the runtime cannot run, and otherwise gives it
  `LaneHosts`, the only way to a host with tools. `startSuiteHost` takes
  no project with tools, so a scenario cannot start lanes without saying
  so. A host with lanes starts its root threads at accepted work
  (ADR-0104): `sectionHost` sets it up; a scenario starting its own with
  `LaneHosts.startHost` calls `setUpAccepted`, and removes its lanes'
  containers and disks at its end (`cleanUp`).
- **What an agent's tool writes is in its lane, not the project:** a check
  reads it there (`inLane`, under `/workspace`) or through the lane's
  revision.

- **A scenario is one file, and one run against its own host.** It depends
  on no other scenario: what it needs it makes, through the session (`join`)
  wherever making it through the UI is not what it checks. Its name is its
  file's stem.
- **`PINETRIE_SCENARIO=a,b` runs only those**, in name order. An unknown name
  exits 2. A suite mutation sets it (`scripts/mutate.ts`, `SUITES`), so a
  mutant runs one scenario, and stops at its check (`PINETRIE_STOP_AT`).
- **A scenario that cannot run here says why, and is skipped**
  (`scenarioProblem`): for one with `lanes: true`, `runtimeProblem()` gives
  the host's own reason the suites' runtime cannot give lanes their own
  here (`findProject` on a throwaway project); then its own `needs`, as
  `live`'s `PINETRIE_LIVE`. A skip is neither a pass nor a fail.
- **A scenario that throws fails under its name** (`ERROR name · message`),
  and the next one runs.

## Checks, and their proofs

- **A check is `check(label, condition, detail?)`.** The label is a string
  literal, unique in its file; what a run found goes in `detail`, printed
  after it (`PASS label · detail`). Only scenario files call `check(`.
- **Every check is a mutation's `expect`, and every suite mutation's
  `expect` is a check in the scenario it names** (`scripts/proofs.ts`,
  enforced by `scripts/mutations.test.ts`). A check no mutation proves yet is
  listed in `scripts/unproven.ts`, a list that only shrinks.
- **A check stays only while it proves what a unit test cannot:** the
  stack's (pi, Kyneta, the store, a restart, a websocket, `startHost`'s
  wiring), or the browser's (focus and the caret, geometry, CSS, scrolling,
  render counts, the device's storage, a reload). A rule decided in a pure
  function is proven by its unit test (`packages/interface/TECHNICAL.md`,
  "Views decide, intents act"), and its suite check is deleted. To tell
  which: write the deliberate bug, and run it `--against` the unit tests
  (`AGENTS.md`, Gates).
- **The budget** (`scripts/budget.ts`, `scripts/budget.test.ts`): the host
  and lanes scenarios together are at most ⌊√n⌋ of the n unit tests, and
  the browser's at most ⌊√n⌋ of those. A scenario, like a `test()`, holds
  many checks; only scenarios count.
- **Numbered docs** (`scripts/numbering.ts`, `scripts/numbering.test.ts`): no
  two files in `docs/findings` or `docs/adrs`, their `archive/` folders
  included, share a number, and each title carries its file's number. Two
  lanes taking one number merge without a conflict, so the test fails in
  the first `pnpm test` after both land, not in either lane.
- **The record** (`scripts/record.ts`, `scripts/record.test.ts`,
  `docs/adrs/README.md`): every ADR's and spike's header is as `pnpm run
  record` would write it (back links, a superseded status, each file in its
  folder or `archive/`), and `recordGaps` finds nothing: no header that
  fails to parse, no unknown or uncited Area, no id naming no record, no
  cited record path that is missing, no code citing a superseded ADR. The
  ADRs over the amendment limit are exactly `scripts/unconsolidated.ts`. It
  runs in `pnpm test` because each rule is a fact about the tree, read in
  milliseconds. An ADR added in the older prose Status format fails it
  until its header is converted, by whoever resolves the landing that
  brings it; an ADR that amends another fails it in its own lane until
  `pnpm run record` writes the back link; and a landing that merges two
  lanes' generated fields fails it until whoever resolves it runs `pnpm
  run record`. `node scripts/record.ts` writes nothing
  while any header fails to parse: a record that drops out of the plan
  would take the spikes it rests on to the archive with it.

## What a run costs

- **A wait costs once per run, and once more per mutant whose check comes
  after it in its scenario.** S65 measures where the time went before the
  suites were scenarios; S94, after.
- **A wait must be able to end early.** A fixed `sleep`, or a `waitFor`
  whose condition cannot hold, costs its whole length every run. A negative
  check, which shows that nothing arrives, has to wait: wait as briefly as
  the rule it checks allows.
- **A browser check stays only while it proves what only a browser shows:**
  focus and the caret, geometry, CSS, scrolling, render counts, a real
  Kyneta round trip, the device's storage. A rule decided in a pure
  function is proven by its unit test (`packages/interface/TECHNICAL.md`,
  "Views decide, intents act"), and the browser check for it is deleted. Keep
  the actions a later step depends on, and the waits that let it start.

## Reading a session of roots (ADR-0063)

- **`held(x)` is what a host or a client holds**: the session's document,
  `pinetrie:live` and the roots it has open. `treeOf`, `entriesOf`,
  `rootRecordsOf`, `lanesOf`, `laneNamesOf`, `tipIn` and `entryMessageIn`
  read across them, as one.
- **A scenario's client holds every root** (`holdEvery`, in `join`), and its
  `chat` and `mark` wait until it holds the root of the entry they name
  (`rootHeldWithin`): a page holds only its tabs' roots, and writes only
  where it reads. On a timeout they send anyway, and the session's refusal
  (`NO_ROOT`) comes back as their answer, not a throw.
- **A card's place at an entry names its root.** On the host it is
  `rootHolding`. From a client, a card is made with `composeAt`, which waits
  until the client's copy has the entry (`waitForRootHolding`), then makes
  the card in that root. Never name a root from a client's copy without
  that wait: a client gets a run's entries after the host goes idle, so a
  step that names a root right after an idle wait races sync. In a lane the
  client lost that race every time, by about 10 ms (`tools`, step 6).
- **The host's `docs.rootOfEntry` is another lookup**
  (`apps/pinetrie/host/docs.ts`): the root whose *root entry* is the entry,
  not the root holding it. A card's root is `rootHolding`'s.
- **A thread's task can arrive after its first message**: the card that
  puts the thread on its task's canvas is in the places document, the
  message in its root's, and Kyneta keeps no order between documents. The
  harness's `chat` (a branch at an entry) and `mark` wait for the entry's
  task (`taskAt`) before they name it (ADR-0116).
- **A scenario queues and unqueues through the harness** (`queueCard`,
  `unqueueCard`), as a column's plan does: each finds the card as its client
  draws it, builds the move with core's `moveOf` (onto its lane's thread),
  and sends it with `moveCard`. Each throws if the card is not
  where it expects. An offer action and a line action are `client.offer`
  and `client.line`, which the session tracks (`acting`); anything else
  that moves no card is `client.request({ kind, … })`, one of core's
  `Intent`s.

## Gotchas

- **An idle wait checks the queue as well as the runs** (`idleNow`): a
  card queued while a run goes is popped only when it ends, so "no run" alone
  can return between a run's end and the pop. A card a client has just
  queued may not have reached the host yet, so a step that queues waits for
  what the pop makes (a message, a resolution's prompt) before it waits
  for idle.
- **A card queued for the restart in `host/tools` is queued under a run
  that is only the document's record** (`beginRun`, `@pinetrie/schema/fixtures`). Queued on an idle lane,
  the move's drain would pop it before the restart; the record is what a
  stopping host leaves, and the next host's startup clears it, then pops
  the card.
- **The places are the host's alone** (ADR-0059): read them through
  `RunningHost.places` (`readPlaces`), and move cards through a session's
  port. A session's write to the places, or to the session, throws
  `NotAWriterError` (`writersPolicy`): the checks that try it catch that.
  The places one joins a throwaway session, so a mutant that lets the write
  through forks no session the scenario goes on to use (S76).
- **An inventory is checked from a second session of the same person**
  (`host/cards`): `join(ch, "ada", …)` again is Ada from another seat, and
  her inventory reaches it through the host. Another person's view is the
  same document opened from their exchange, which keeps its own write.
  The repair waits `STEADY_MS` before placing or clearing (S79), so a check
  that reads slots another session wrote waits that long or more.
- **A person's history of moves is the host's, per root** (ADR-0066), so
  `join(ch, "ada", …)` again undoes Ada's moves, and after a restart too.
  An undo key may follow a move at once: the host records it as it applies
  it.

- **`lateFor(docId, ms)` is a client whose writes to one document arrive
  late** (`harness.ts`): a WebSocket that sends every frame naming the
  document's id `ms` later, in order, passed to `join` as `WebSocket`. Kyneta
  keeps no order between documents (S96), but on one connection a text
  usually beats the command behind it, so a check that the host waits for a
  text (`host/cards`, a pinned card's) needs it late every time. If Kyneta's
  frames stop carrying a document's id as bytes, nothing is delayed, and the
  mutation "a run does not wait for its pinned cards' text" survives.

- **`slowToLoad` delays one document's first `loadAll`**, by
  `LATE_LOAD_MS` (`host/support.ts`): the exchange's hydration, and
  nothing else (the `tools` and `cards` restarts). Not its first
  `currentMeta`: the startup reads every document's before the exchange
  opens (`readStored`, ADR-0096), which would take the delay. A host that
  wrote to the session before it loaded would throw: Kyneta refuses a
  write to a document still loading. If Kyneta's hydration stops calling
  `loadAll` first, nothing is delayed, and the mutation "the host serves
  before it has recovered" survives.
- **A nested lane's inner Docker starts afresh with its container**
  (`pinetrie-inner-docker`, `packages/lanes/image/Containerfile`): `/run`
  outlives a stopped container, so the script clears `/run/user/1000` first;
  a pid file left from before the stop named a pid another process now held,
  and the daemon refused to start (seen 2026-10-08). A lane made from an
  image before that fix needs it by hand: remove `/run/user/1000`, then run
  `pinetrie-inner-docker` in the background.
- **A browser scenario closes its pages before its host stops, but
  `banner`.** A page holds Vite's HMR socket, and `banner` shuts its host
  down with its page still open, to check that the host stops anyway
  (S98). A host's `shutdown()` runs once, so its `finally` calling it again
  waits for that same shutdown.
- **Presence outlives a closed page by its decay.** The browser's `page`
  closes a second tab of Ada's before a second window follows her; until
  that tab's entries decay, her avatar's menu offers its thread too, so the
  scenario waits for one seat of hers before it goes on.
- **`waitForSelector` waits for a visible element by default**, and so does
  the browser suite's `appears`. An element CSS hides, or one with no
  height, such as `.working-line`, never resolves it. Wait for something visible,
  or pass `state: "attached"` when being in the page is what counts.
- **The browser suite swallows timeouts**, through its `appears` helpers
  and `.catch(() => null)`: a mutant must fail at its check, and `judge`
  (`scripts/mutate.ts`) counts a thrown error as ELSEWHERE. A step a mutant
  can break returns early rather than waiting for what will not come
  (`rename` in `page`).
- **A page that opens a column's pane is 1440 pixels wide**
  (`PANE_VIEWPORT`, `browser/page.ts`): `images`' and `tools`' pages. The
  pane goes beside the thread only where the strip holds the thread and
  40rem (ADR-0087), and at Playwright's default 1280 your full list leaves
  the strip short of that, so the pane would cover the page, a dialog
  outside `${col(0)}` that the checks would not find.
- **A scenario's paths are one directory deeper than its runner's.**
  `import.meta.dirname` in a scenario is its suite's directory
  (`../../../../packages/pi/fixtures`).
