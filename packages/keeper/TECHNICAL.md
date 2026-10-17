# `@pinetrie/keeper`: technical notes

One primitive for a resource that needs exclusive access: one step at a
time, in an order the caller can reason about. The host has one for its
documents (`apps/pinetrie/host/index.ts`), and one each for its names and its
lane work. It declares nothing (`workspace.test.ts`).

## `run`, `once` and `later`

- **`run` is a step someone waits on.** It runs after every `run` and `once`
  step queued before it, and before any `later` step not yet started.
- **`once(key)` is a `run` step merged by key.** Queued at most once per key
  until it starts: every caller until then gets the promise of the one step.
  A call while it runs queues one more, which sees what the running one
  missed. It keeps its place among `run` steps.
- **`later(key)` is upkeep.** Merged by key as `once` is, and started only
  when no `run` or `once` step waits. So it runs after every `run` and `once`
  step queued before it starts, and a steady stream of commands delays it,
  never the other way round.
- **The next step is chosen a microtask after a call, not during it.** So a
  `later` and a `once` queued in the same turn run in priority order, the
  `once` first.
- **Nothing may depend on when a step begins, only on what is queued before
  it.** An order two callers need is a data dependency between them, never
  a race between their microtasks. The host's command loop is the example: a
  seat's next command is queued only once the one before it has replied
  (`control.ts`), so a drain that one queued is ahead of it by construction.
- **A key is cleared when its step starts**, so a throw leaves nothing set: the
  next call queues afresh.
- **Keys are typed** (`createKeeper<K>()`): a mistyped key fails to compile
  rather than silently not merging. A keeper made with no key type takes no
  `once` or `later` at all.

Why the host drains with `once` and not `later`: a drain must keep its place
among commands. A late message sent after a card was queued goes after the
card: the drain queued first runs first. Upkeep would let the message's
command overtake it. The upkeep is the one `later` on the host's
documents: it may wait, and waiting is what makes the records it compacts
current.

## A step context

- **A keeper made with `context` hands each step a value of its own**
  (`StepContext`): `open` makes it as the step starts, and `close` runs once
  the step has settled, a throw included, before the next step opens its
  own. The host's documents' keeper hands each step its `StepDocs`
  (`apps/pinetrie/host/roots.ts`, ADR-0162), which `close` revokes, so what
  a step reaches through it is that step's alone. A keeper without one
  hands `undefined`, and its steps ignore it.
- **A step never awaits another step of its keeper**: the inner one waits
  for the outer one to end, which waits for the inner. Work that a step
  awaits, and that needs what a step holds, takes it another way (the
  host's leases).

## Failures, voiding and closing

- **A failed step never stops the steps behind it.** `onError` hears each
  failure once, and the step's own callers still get the rejection. This is
  the opposite of `@pinetrie/lanes`' `createQueue`, whose fatal failure breaks it
  until `reset`, as a lane's disk needs.
- **Every promise it returns is already handled,** so voiding `run`, `once`
  or `later` is safe. Awaiting one inside an async function whose own promise
  is voided is not: that function's promise rejects unhandled, which ends the
  process.
- **A closed keeper refuses every new step** with `KeeperClosed`, already
  handled, and finishes what it holds: the running step and every `run` and
  `once` step queued. The closer says what becomes of upkeep not yet
  started: `close("finish")` runs it, `close("drop")` rejects it unstarted
  with `KeeperClosed`. The host's documents finish theirs, a compaction;
  the owner of your repo drops its refreshes, which the next start rebuilds. The host's `failed()` logs nothing for
  it: a refusal during shutdown is expected.
- **`idle` settles when nothing is queued, running or tracked**, including
  what is added while it waits. `track(work)` holds `idle` for work that is not
  a step: a request outside the keeper, say.
- **`onSlow`** hears each step that ran past `slowMs` (1 s by default), and
  each `run` or `once` step that waited past it, with its key. A `later`
  step's wait is not reported: upkeep waits behind commands and other
  upkeep by design, so a burst of it (a refresh per lane, queued at once)
  would report every step behind the first second. The host logs it.

## Tests

`keeper.test.ts`, one test per rule above; mutations in
`scripts/mutations/keeper.ts`.
