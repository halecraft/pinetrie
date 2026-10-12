# ADR-0139 — The e2e suites wait for states, never for time: a host's clock a suite moves, tools and replies a suite holds, and a list of the fixed waits left

- **Status:** Accepted (Duane, 2026-10-12)
- **Area:** `apps/pinetrie/e2e/TECHNICAL.md`,
  `apps/pinetrie/host/TECHNICAL.md`, `packages/pi/TECHNICAL.md`
- **Evidence:** S168
- **Amends:**
  - ADR-0041: a check that needs a run in progress holds its reply
    (`ScriptedModel.hold`), which can also release it a text delta at a time;
    `pause` is gone.

**Context.**

- **The suites slept.** Scenarios waited a fixed time, then read: after a
  resize, a scroll, a client's close, a refused write, a blob's grace. Their
  scripted tool commands ran `sleep 2` or loops of `sleep 0.25`, so the
  page could watch them run or stop them. Each wait is paid in full on
  every run, and is a guess: under load a `sleep 2` command once ended
  before the page drew its row.
- **Most guessed about nothing, or stood in for a state** (S168). Some
  guarded no check. A refused write sends nothing, so there is nothing to
  wait for. A negative read across the wire needs a barrier, and Kyneta's
  `whenSettled` is one: it resolves once the document's authority has
  answered.
- **The rest stood in for a clock or a step the suite could not hold.** The
  host read `Date.now` itself, so a suite waited out the blob grace in real
  time, shortened by `startHost`'s `blobGraceMs`. Tools ran on their own,
  and replies streamed on faux's own timer.

**Decision.**

- **A host's clock is `startHost`'s `now`**, which `Basics` and the blob
  stores read. A suite's clock (`suiteClock`) is the real one plus an
  offset only it moves forward. The blob store and the host share it
  (`clockedStore`): a store behind the host's clock would make every blob
  it stamps look old to the sweep. `blobGraceMs` is gone.
- **A tool command a suite must watch runs behind a gate** (`gate.ts`): it
  prints only the lines the suite feeds it into its lane, and ends when the
  suite closes it, or when Stop kills it.
- **A scripted reply is held** (`ScriptedModel.hold`) from its first event,
  and released a text delta at a time or whole. The run's abort ends it.
- **A negative read across the wire waits on `whenSettled`**, or on
  nothing, when the write it checks was refused before it was made.
- **The fixed waits left are listed** (`FIXED_WAITS`, `scripts/budget.ts`),
  each with its reason, and the list only shrinks: `pnpm test` fails when
  a scenario holds more, or fewer.

**Consequences.**

- `host/images` checks that the sweep deletes an image nothing shows, on
  the host's moved clock; until now no check showed the sweep deleting
  anything.
- A check that measured Stop by wall time ("within 4 s of a `sleep 5`")
  now reads only that the command was aborted: a gated command never ends
  on its own.
- The short command that showed "a call shorter than `REVEAL_MS` is never
  ringed" is gone. The ring is drawn only on a running row, and a held
  call's first frame, recorded as it is added, shows what such a call
  shows.
- `lanes/contract` spaces its snapshots by a random number of records
  written, not a random time.

**Alternatives rejected.**

- **Playwright's `page.clock`.** It replaces `requestAnimationFrame`,
  `performance` and `Event.timeStamp` as well as the timers, and the
  browser suite reads geometry in real frames.
- **A clock passed down through the page.** Every page wait left ends early
  on a state that comes within a second; the seam would serve only tests.
- **Shorter sleeps, or a slower `tokensPerSecond`.** Each trades flakiness
  for run time; a gate or a hold removes both.
- **A `step` beside `pause`.** Two registries matched on one prompt; a
  hold from the first event makes a pause a hold never stepped.
