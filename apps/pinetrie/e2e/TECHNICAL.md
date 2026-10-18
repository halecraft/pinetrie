# `apps/pinetrie/e2e` — technical notes

The end-to-end suites, each a directory of scenarios:

| suite | runner | scenarios | package script |
|---|---|---|---|
| `host` | `e2e.ts` | `host/*.scenario.ts` | `pnpm run e2e`; `e2e:live` runs `live` alone |
| `lanes` | `lanes.ts` | `lanes/*.scenario.ts` | `pnpm run e2e:lanes` |
| `observer` | `observer.ts` | `observer/*.scenario.ts` | `pnpm run e2e:observer` |
| `browser` | `browser.ts` | `browser/*.scenario.ts` | `pnpm run e2e:browser` |

They share `checks.ts` (recording a check, and stopping at one),
`scenario.ts` (choosing, skipping and running scenarios), `harness.ts`
(waiting, `idleNow`, a host's clock a suite moves, `suiteClock`, throwaway
projects, joining a host through `@pinetrie/session`'s
`connectSession`, a host with no tools and `withHost`, positions and
starts, the scripted model), `gate.ts` (a tool command a scenario holds
and feeds), `lane-hosts.ts` (why the
suites' runtime cannot run here, `runtimeProblem`; hosts with tools,
`LaneHosts`; a section's host with accepted work set up, `sectionHost`; a
lane's shell, `inLane`; `cleanUp`) and `lane-runtime.ts` (the suites'
runtime's CLI, and a lane's container and disks read and removed through
lanehost's one-shot command in the project's `disks` role container, as
the host does: ADR-0129). A suite's own helpers are beside its scenarios:
`host/support.ts` (among them `clockedStore`), `lanes/support.ts`,
`browser/page.ts`.

## Scenarios

- **The observer's suite boots a QEMU guest on the lane VM's own kernel**
  (`observer/support.ts`): the pinned `linux-virt`'s kernel, unpacked in
  Node (`pinnedKernel`, ADR-0147), and an initramfs of busybox, the loader
  and the workloads, built by the observer Containerfile's `suite` stage in
  the suites' Docker. QEMU emulates (a lane has no KVM): a run takes about
  35 s, and its timings mean nothing. It needs `qemu-system-aarch64` and an
  arm64 Docker, and caches the kernel's package and `Image` under
  `node_modules/.cache`.
- **A scenario's own lane VM on the Mac** (`ownVm`, `lanes/support.ts`): a
  state directory under `/tmp/` whose `images/`, `bin/` and `builder/` it
  may share with the person's, and whose launcher stops 2 s after its last
  lease. The `contract` scenario shares all three and a data disk kept
  between runs; `vm-image` shares the binaries and the pinned downloads,
  and builds its image from nothing (ADR-0147), so it stops its launcher
  itself: a lease that failed leaves it holding a connection.
- **A failure a check is about is caught into the check.** A mutation is
  killed only when its expected check fails (`scripts/mutate.ts`); a
  thrown error is not one. `vm-image` catches a failed build and a failed
  lease into their checks for that reason. Its guest (`packages/lanehost/observer/suite/init`)
  runs each case as a numbered run in a lane's PID namespace, each lane
  its own namespace, all in one cgroup, one lane inside another, and prints
  what the loader said; the scenario checks it, decoding with lanehost's
  codec. The guest's background processes close the loader's command
  pipe, or the loader never sees its end.
- **The guest checks the kernel and the loader, not the policy:** which
  candidate a registration takes, ancestry, ownership and lifecycle are
  the machine role's planners', proved by unit tests.
- **In a lane, a host is observed through its helper:** the host outside
  relays the observer, so `e2e:lanes` runs in a lane once that host runs
  this code. A host outside that relays nothing leaves no socket, and the
  inner host refuses lanes: the scenarios with tools, and all of
  `e2e:lanes`, skip with its words.

- **A host reads the suites' places, not the person's** (ADR-0146).
  `startSuiteHost` (`harness.ts`) and `LaneHosts` pass `suitePlaces()`: one
  config directory and one data directory per suite process, no system
  file, an empty environment, and `SUITE_CONFIG` as the user's
  `pinetrie.json`, which turns the automatic title off (ADR-0074). A
  scenario that needs its own writes it through `suitePlaces({ user })`,
  spreading `SUITE_CONFIG` into it, and the fixture packages
  (`FIXTURE_PACKAGES`) are listed that way. pi's agent directory is bound
  once per process to the suite's config directory (`suiteBinding`), so
  every host in the process agrees. `e2e:live` alone passes the person's
  real data directory, so its named model finds the credential `pnpm
  sign-in cerebras` stored, or `CEREBRAS_API_KEY`. Nor the person's ssh:
  every suite host gets an empty `~/.ssh` and no agent (`suiteSshPlaces`),
  unless a scenario passes its own, as `lanes/ssh` does (ADR-0140), with a
  config directory of its own for its service keys.
- **Lanes run on Docker** (ADR-0130): on the Mac against the lane VM, on
  Linux against the host's Docker, and inside a pine·trie lane granted
  `lanes.nested` against the lane's rootless Docker, its lanes in
  `/var/lib/pinetrie-lanes`.
- **In a lane, on its rootless Docker** (2026-10-08, the default image
  already built in the inner Docker; its first build adds about a minute):
  `pnpm run e2e` took 58 s (54 passed, `live` skipped), `pnpm run
  e2e:lanes` 134 s (64 passed; the Mac's network checks and ssh skipped)
  and `pnpm run e2e:browser` 223 s (177 passed). `pnpm run verify` runs
  the first two.
- **A lane builds the lane image from its own checkout,** tagged by its
  inputs: `packages/lanes/image/Containerfile`, the files it copies in
  (its `daemon.json`), the host's jj version and the app's Playwright
  version (`planImages`). Its inner Docker is shared by cloning: at a run's
  start a nested lane takes a copy of the project's nested lane that ran
  last (ADR-0169). So a change to any of those inputs gives a new tag that
  each nested lane builds, about 3 minutes of build steps from cold
  (S232), once it reaches that lane; while some lanes have the change and
  some do not, each takes the other's copy at its next run and builds its
  own version again. Such changes are better made together, in one thread,
  than in many at once.
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

### The decisions each scenario checks

A scenario's code names no decision; the ones whose behaviour it checks are
here, so a superseded ADR leads to the scenarios to revisit.

| scenario | decisions |
|---|---|
| `host/admission` | the invite key, off loopback, for a request and an upgrade (ADR-0107), and Vite's HMR socket on the host's own port, behind admission (S112) |
| `host/agents` | an agent invited into another canvas's thread, its budget (ADR-0128) |
| `host/banners`, `browser/banner` | a thread's banner (ADR-0050, ADR-0053), drawn before its first message (ADR-0057) |
| `host/board` | the board (ADR-0122), the archive (ADR-0029), a root's title (ADR-0045), a canvas as a card (ADR-0116, ADR-0126) |
| `host/cards` | cards and their queue, pinned cards, traces and a held queue (ADR-0048; what the agent reads of pinned cards, S92), undo per card (ADR-0052; a spent card's copy, S64), the places' one owner (ADR-0059, S76), moves' history per person and root (ADR-0066, S91), a thread's card in an inventory (ADR-0117, ADR-0124), paste (ADR-0132), a note column on the canvas (ADR-0126) |
| `host/chat` | people and the agent in one tree (ADR-0018), who a message is for and whether the agent is asked (ADR-0021), and a host whose config names no model (ADR-0146) |
| `host/commands`, `lanes/commands` | your pi skills and prompts as commands, at `/mnt/host` in a lane (ADR-0036); what a lane is told of itself (ADR-0121), which names no bookmark, since a rename would change the prompt and drop the agent's earlier thinking (S85) |
| `host/images`, `browser/images`, `images.ts` | a pasted image as a blob (ADR-0042), kept while a card shows it (ADR-0048); the pane (ADR-0078), the list's icons (ADR-0088), your picture (ADR-0098), copy and paste (ADR-0132; the clipboard in headless Chromium, S68) |
| `host/tool-images`, `browser/images` | a tool's image as a blob (ADR-0051); pi's pending entry holds its bytes until a compaction (S93) |
| `host/live` | the one scenario on a real model (ADR-0041): an image read (ADR-0042), a square banner (ADR-0053) |
| `host/page` | the built page served without Vite (ADR-0148) |
| `host/presence` | presence per open column (ADR-0024) |
| `host/titles` | a root titled by a model (ADR-0074), its canvas's title (ADR-0116) |
| `host/tools` | the host (ADR-0107), a lane's own copy (ADR-0034), compaction (ADR-0023, ADR-0063), Stop as a fact (ADR-0106, ADR-0126), Resume (ADR-0082) |
| `lanes/catch-up` | catching up mid-run (ADR-0080, S103), a publish that accepts (ADR-0099) and moves main (ADR-0090) |
| `lanes/contract` | the Docker runtime (ADR-0130), lanehost's roles and diffs (ADR-0129), the Mac's fence (S136), the images a host keeps (ADR-0169) |
| `lanes/folder` | a folder project: its lanes, proposed changes, catch-ups and their conflicts (ADR-0142), and a folder lane refused once the folder is a jj repo (ADR-0150) |
| `lanes/images` | the default image's browser (ADR-0041) |
| `lanes/proposal` | an agent's proposal of branches, Start's lanes, order and messages, and its fact (ADR-0157, S218) |
| `lanes/main` | lane containers (ADR-0034), proposed changes (ADR-0105), thread names (ADR-0039), the review (ADR-0047), accepted work (ADR-0104), publish (ADR-0090), the repo's owner (ADR-0065), commands on a thread (ADR-0080); a lane's jj config for its own repo (S50), an agent's own commit (S56) |
| `lanes/recipe` | derived state rebuilt from its key (ADR-0131) |
| `lanes/shared` | shared directories (ADR-0035) |
| `lanes/ssh` | a lane's ssh through its host: service identities, the owner's approval, the broker and a revoke (ADR-0140, S174) |
| `lanes/vm-image` | the lane VM's image built on the Mac in a VM of its own, and booted (ADR-0147), its Docker's cache capped (ADR-0169) |
| `observer/kernel` | the observer that attributes a lane's file calls to its runs, on the lane VM's own kernel (ADR-0135; S172, S176) |
| `browser/page` | who you are (ADR-0037) and your profile (ADR-0098); a canvas of columns, their folds and moves (ADR-0116, ADR-0134, ADR-0137); the sidebar (ADR-0030, ADR-0122), the board and its archive (ADR-0029, ADR-0122), the inbox (ADR-0091); the dock's queue (ADR-0113); cards, your inventory and undo (ADR-0048, ADR-0052, ADR-0127); copy, cut and paste (ADR-0132); the rail's outline of a column (ADR-0058); a second window's presence (ADR-0024); what a reload keeps (ADR-0027) |
| `browser/tools` | asks (ADR-0106), where a new thread starts (ADR-0104), lanes for every agent (ADR-0102), search (ADR-0101), commands (ADR-0036), tool rows (ADR-0114, ADR-0123, S142), the dock's queue (ADR-0113), the header and the work strip (ADR-0039, ADR-0040, ADR-0105), the review (ADR-0047; render counts, S54), the board's work (ADR-0091), the rail's capsules (ADR-0031), digests (ADR-0071), threads and their tracks (ADR-0117, ADR-0125), your list (ADR-0030), a proposal's card, Open and Send (ADR-0157); a column's height and width while its agent works (S35, S37), following past a pick (S33) |

The helpers rest on these too: a start's modes (`START_AGENT`, which
sends `@agent ` before its text as a new canvas's box holds it, and
`START_CHAT`, ADR-0164), and a message found by what a scenario typed after
that prefill (`idOfText`, `laneHolding`); a lane starts from your committed `@-`, so a
project's files are committed (`committedProject`, ADR-0032); a person is
their email, so each scenario joins on a domain of its own (`join`,
ADR-0037); the suites' scripted model and the browser in the lane's image
(ADR-0041); a thread named by its card (ADR-0117); a command on a card
(`lanes/support.ts`, ADR-0108), and a command button's card made empty in
the queue (ADR-0113); a card's ⋯ (`page.ts`, ADR-0111).

## Checks, and their proofs

- **A check is `check(label, condition, detail?)`.** The label is a string
  literal, unique in its file; what a run found goes in `detail`, printed
  after it (`PASS label · detail`). Only scenario files call `check(`.
- **Every check is a mutation's `expect`, and every suite mutation's
  `expect` is a check in the scenario it names** (`scripts/proofs.ts`,
  enforced by `scripts/mutations.test.ts`). A check no mutation proves yet is
  listed in `scripts/unproven.ts`, a list that only shrinks.
- **A unit mutation's `expect` is in the full name of a test its command
  runs** (`unitExpectGaps`, `scripts/proofs.ts`), checked against
  `vitest list` by `pnpm run proofs:unit`, a step of `pnpm run verify`.
  Its collection takes seconds, so it is not a unit test. A test renamed
  without its mutations once left 33 of them naming nothing.
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
  cited record path that is missing, and no code file that names a
  decision by its id. It runs in `pnpm test` because each rule is a fact
  about the tree, read in milliseconds. An ADR added in the older prose Status format fails it
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
- **A wait must be able to end early: a scenario waits for a state, never
  for time** (ADR-0139). A fixed `sleep`, or a `waitFor` whose condition
  cannot hold, costs its whole length every run, and guesses.
  - **What stood in for time has a seam.** A host's clock is `startHost`'s
    `now`, which a scenario moves (`suiteClock`, `advance`). A tool
    command the page must watch runs behind a gate. A reply is held
    (`ScriptedModel.hold`) and released a delta at a time.
  - **A negative check waits on a barrier.** A read of what a client must
    not receive waits for its copy to settle (`whenSettled`, from
    `@kyneta/exchange`): the host has answered for it by then. A write the
    client refused (`refusedWrite`) was never sent, so there is nothing to
    wait for.
  - **The fixed waits left are listed** in `FIXED_WAITS`
    (`scripts/budget.ts`), each with its reason, and `budget.test.ts`
    fails when a scenario holds more, or fewer. What is left there is a
    process whose death a check reads, or a Kyneta bug. A deadline on a wait
    for a state is no fixed wait: bound it with `waitFor`, not a
    `setTimeout`.
- **A check reads a state, a count or a result, never a duration**
  (ADR-0152), in a scenario as in a unit test. What a limit on time stood
  for is modelled instead: a configuration as a planned value, a
  complexity as counted steps (`collectionSteps`,
  `@pinetrie/core/fixtures`), a kill as the call's result. A cost worth
  knowing is a spike's measurement. `budget.test.ts` fails on a clock
  reading subtracted in any test or scenario.
- **A browser check stays only while it proves what only a browser shows:**
  focus and the caret, geometry, CSS, scrolling, render counts, a real
  Kyneta round trip, the device's storage. A rule decided in a pure
  function is proven by its unit test (`packages/interface/TECHNICAL.md`,
  "Views decide, intents act"), and the browser check for it is deleted. Keep
  the actions a later step depends on, and the waits that let it start.

## Reading a session of roots (ADR-0063)

- **`held(x)` is what a host or a client holds**: the session's document,
  `pinetrie:live` and the roots it has open. A quiet host holds no root
  (ADR-0162), so on the host it is every root it has loaded in its life, as
  it last held each (`rootsRead`, kept because a suite's host starts with
  `keepRootsRead`): a handle the host let go reads its last value. A root a restarted host has not loaded yet is not among them.
  `heldTree`, `heldEntries`, `heldRootRecords`, `heldLanes`, `heldLaneNames`, `tipIn`
  and `entryMessageIn` read across them, as one. What is loaded now is
  `rootsLoaded`.
- **A scenario's client holds every root** (`holdEvery`, in `join`), and its
  `send` and `mark` wait until it holds the root of the entry they name
  (`rootHeldWithin`): a page holds only its tabs' roots, and writes only
  where it reads. On a timeout they send anyway, and the session's refusal
  (`NO_ROOT`) comes back as their answer, not a throw.
- **A card's place at an entry names its root.** On the host it is
  `rootHolding`. From a client, a card is made with `composeCard`, which waits
  until the client's copy has the entry (`waitForRootHolding`), then makes
  the card in that root. Never name a root from a client's copy without
  that wait: a client gets a run's entries after the host goes idle, so a
  step that names a root right after an idle wait races sync. In a lane the
  client lost that race every time, by about 10 ms (`tools`, step 6).
- **The host's `docs.rootOfEntry` is another lookup**
  (`apps/pinetrie/host/docs.ts`): the root whose *root entry* is the entry,
  not the root holding it. A card's root is `rootHolding`'s.
- **A thread's canvas can arrive after its first message**: the card that
  puts the thread on its canvas is in the places document, the
  message in its root's, and Kyneta keeps no order between documents. The
  harness's `send` (a branch at an entry) and `mark` wait for the entry's
  canvas (`entryCanvas`) before they name it (ADR-0116).
- **A scenario queues and unqueues through the harness** (`queueCard`,
  `unqueueCard`), as a column's plan does: each finds the card as its client
  draws it, builds the move with core's `cardMove` (onto its lane's thread),
  and sends it with `moveCard`. Each throws if the card is not
  where it expects. An action on proposed changes and a line action are `client.proposed`
  and `client.line`, which the session tracks (`acting`); anything else
  that moves no card is `client.request({ kind, … })`, one of core's
  `Intent`s.

## Gotchas

- **A gate is a FIFO in the lane's `/tmp`** (`gate.ts`). Its command
  (`gateCommand`) makes the FIFO, holds it open for reading and writing so a
  feed never blocks, and prints each line it reads until `gateClose`'s end
  line. A gate is a value with a FIFO of its own (`newGate`), so no feed
  meets a stale one; `gateFeed` waits in the lane for the FIFO, and is run
  with `inLaneQuiet`. With no FIFO by its last try, a feed fails and writes
  nothing: a file left at the FIFO's path would make the command's
  `mkfifo` fail, and nothing it was fed would stream. Each feed is a
  `docker exec`: feed together the lines a step does not read between. A
  gated row is found by its gate's label, which its command shows
  (`pinetrie-gate-<label>`). Stop kills a gate's command as it kills any.
- **A suite's host runs in the suite's own process, so nothing in the
  suites runs a child process synchronously** (`command.ts`; `biome.json`
  refuses `node:child_process`'s synchronous calls in `apps/pinetrie/e2e`,
  its unit tests aside). A synchronous call stops the host for as long as
  the command runs, and a command that waits on that host never ends: a
  gate's feed, run with a synchronous `docker exec`, held Node while it
  waited for its FIFO, the host could not start the run that makes it, and
  the feed timed out. `cli`, `inLane`, `inLaneQuiet`, the lanehost reads,
  and the suites' `jj` and `sh` all return promises.
- **A suite's clock and its blob store's are one** (`clockedStore`,
  `host/support.ts`). A store left on the real clock behind a host moved
  ahead stamps every blob a day old, and the sweep deletes it, a fresh
  paste included.
- **Playwright's `page.clock` is never installed.** It replaces
  `requestAnimationFrame`, `performance` and `Event.timeStamp` as well as
  the timers, and the browser checks read geometry in real frames (S168).

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
