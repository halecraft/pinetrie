# `apps/pineta/e2e` — technical notes

The end-to-end suites, each a directory of scenarios:

| suite | runner | scenarios | package script |
|---|---|---|---|
| `host` | `e2e.ts` | `host/*.scenario.ts` | `pnpm run e2e`; `e2e:live` runs `live` alone |
| `lanes` | `lanes.ts` | `lanes/*.scenario.ts` | `pnpm run e2e:lanes` |
| `browser` | `browser.ts` | `browser/*.scenario.ts` | `pnpm run e2e:browser` |

They share `checks.ts` (recording a check, and stopping at one),
`scenario.ts` (choosing, skipping and running scenarios) and `harness.ts`
(waiting, `idleNow`, throwaway projects, joining a host, `withHost`, the scripted model,
`containerProblem`). A suite's own helpers are beside its scenarios:
`host/support.ts`, `lanes/support.ts`, `browser/page.ts`.

## Scenarios

- **A scenario is one file, and one run against its own host.** It depends
  on no other scenario: what it needs it makes, through the session (`join`)
  wherever making it through the UI is not what it checks. Its name is its
  file's stem.
- **`PINETA_SCENARIO=a,b` runs only those**, in name order. An unknown name
  exits 2. A suite mutation sets it (`scripts/mutate.ts`, `SUITES`), so a
  mutant runs one scenario, and stops at its check (`PINETA_STOP_AT`).
- **A scenario that cannot run here says why, and is skipped** (`needs`):
  `containerProblem()` gives the host's own reason `container` is unusable
  (`prepareHost`, `planHost`), and `live` needs `PINETA_LIVE`. Inside the
  browser's `tools`, the offer and review checks are each `skip`ped with the
  host's project record's reason when its lanes work directly. A skip is
  neither a pass nor a fail.
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
  function is proven by its unit test (`packages/client/TECHNICAL.md`,
  "Views decide, intents act"), and its suite check is deleted. To tell
  which: write the deliberate bug, and run it `--against` the unit tests
  (`AGENTS.md`, Gates).
- **The budget** (`scripts/budget.ts`, `scripts/budget.test.ts`): the host
  and lanes scenarios together are at most ⌊√n⌋ of the n unit tests, and
  the browser's at most ⌊√n⌋ of those. A scenario, like a `test()`, holds
  many checks; only scenarios count.
- **Numbered docs** (`scripts/numbering.ts`, `scripts/numbering.test.ts`): no
  two files in `docs/findings` or `docs/adrs` share a number, and each
  title carries its file's number. Two lanes taking one number merge
  without a conflict, so the test fails in the first `pnpm test` after both
  land, not in either lane.

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
  function is proven by its unit test (`packages/client/TECHNICAL.md`,
  "Views decide, intents act"), and the browser check for it is deleted. Keep
  the actions a later step depends on, and the waits that let it start.

## Reading a session of roots (ADR-0063)

- **`held(x)` is what a host or a client holds**: the session's document,
  `pineta:live` and the roots it has open. `treeOf`, `entriesOf`,
  `rootRecordsOf`, `lanesOf`, `laneNamesOf`, `tipIn` and `entryMessageIn`
  read across them, as one.
- **A scenario's client holds every root** (`holdEvery`, in `join`), and its
  `chat` and `mark` wait until it holds the root of the entry they name: a
  page holds only its tabs' roots, and writes only where it reads.
- **A card's place at an entry names its root** (`rootAt`), from the host or
  a client.
- **A scenario queues and unqueues through the harness** (`queueCard`,
  `unqueueCard`), as a column's plan does: each finds the card as its client
  draws it, builds the move with core's `moveOf` (into its lane's root,
  `queueRoot`), and sends it with `moveCard`. Each throws if the card is not
  where it expects. An offer action and a line action are `client.offer`
  and `client.line`, which the session tracks (`acting`); anything else
  that moves no card is `client.request({ kind, … })`, one of core's
  `Intent`s.

## Gotchas

- **An idle wait checks the queue as well as the runs** (`idleNow`): a
  card queued while a run goes is taken only when it ends, so "no run" alone
  can return between a run's end and the take. A card a client has just
  queued may not have reached the host yet, so a step that queues waits for
  what the take makes (a message, a landing) before it waits for idle.
- **A card queued for the restart in `host/tools` is queued under a run
  that is only the document's record** (`beginRun`). Queued on an idle lane,
  the move's drain would take it before the restart; the record is what a
  stopping host leaves, and the next host's startup clears it, then takes
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

- **`slowToLoad` delays one document's first `currentMeta`**, by
  `LATE_LOAD_MS` (`host/support.ts`). Kyneta's `#hydrate` reads
  `currentMeta` before `loadAll`, so this delays that document's first load
  and nothing else (the `tools` and `cards` restarts). If Kyneta's hydration
  stops reading `currentMeta`, nothing is delayed, and the mutations "the
  host does not wait for its stored session" and "the host serves before it
  has recovered" survive.
- **Presence outlives a closed page by its decay.** The browser's `page`
  closes a second tab of Ada's before a second window follows her; until
  that tab's entries decay, her avatar's menu offers its thread too, so the
  scenario waits for one seat of hers before it goes on.
- **`waitForSelector` waits for a visible element by default**, and so does
  the browser suite's `appears`. An element CSS hides, such as a closed tool
  row's `.tool-label-whole`, never resolves it. Wait for something visible,
  or pass `state: "attached"` when being in the page is what counts.
- **The browser suite swallows timeouts**, through its `appears` helpers
  and `.catch(() => null)`: a mutant must fail at its check, and `judge`
  (`scripts/mutate.ts`) counts a thrown error as ELSEWHERE. A step a mutant
  can break returns early rather than waiting for what will not come
  (`rename` in `page`).
- **A scenario's paths are one directory deeper than its runner's.**
  `import.meta.dirname` in a scenario is its suite's directory
  (`../../../../packages/pi/fixtures`).
