# S222 — what uses roots, how often each loads, and what a policy for keeping them would save

- **Status:** Open (waiting on a day's trace from Duane's host)

## Brief

**Question.** A root is loaded while a step, a lease or a tab holds it, and
let go, compacted, at the next upkeep after none does (ADR-0162). In Duane's
CPU profile, loading and compacting roots were 6.8 s of 20 s busy (S220).
How often does each root load in a day, and who asks? What would each
policy have cost instead: letting go at once (today), after a grace period,
or LRU up to a memory budget? And which roots do tabs hold, and why?

**Kill criterion.** If, once a refresh reads its root only when it builds,
a day's trace shows each root loading about once per real use (a run, a
review, a tab opening it), then no policy beats today's, and a memory
budget is not worth its code.

**Throw away.** The trace, the store's copy, and the replay tool
(`sandbox/root-trace/replay.ts`).

## How it is measured

- **The trace** (`apps/pinetrie/host/root-trace.ts`, on with
  `PINETRIE_ROOT_TRACE=<file>`) logs one JSON object a line: each use of a
  root (through a step, a lease, or a tab's ask), whether it loaded it, and
  the host code that asked (`file:line`, the first frame outside the code
  that keeps roots); each lease's end; each upkeep that compacts or lets
  go, with the roots a tab holds.
- **The replay** (`node sandbox/root-trace/replay.ts <trace> [store copy]`)
  counts, from the trace: loads by caller, loads per root, root
  compactions; then replays the uses against each policy and counts loads,
  unloads and the peak stored MB loaded. A copy of the store weighs each
  root by its stored size. "Let go at upkeep" is today's policy in the
  replay, a check that it agrees with the trace.
- Checked on a host suite's trace (`presence`, `images`): 4 loads traced,
  4 replayed under today's policy; callers named, as
  `apps/pinetrie/host/commands/send.ts:239`.

## What the code says, before the trace (S-h)

- **A tab holds every root of every canvas in your sidebar,** archived
  or not, and the one you are on, and the root of each thread in your
  inventory (`planHeldRoots`, `packages/interface/held-roots.ts`). Only
  the canvas you are on is shown.
- **The page's first render waits for all of them:** it holds them, then
  awaits each one's sync before choosing what to show (`settled`,
  `packages/web/app.tsx`).
- **Each held root comes whole,** and every one is read into one tree
  index (`readHeldIndex`), which the sidebar reads too.
- Open: what the sidebar reads from a root that the directory record
  (`pinetrie.root`) does not hold. If nothing, a canvas off screen needs
  no root held.

## Answers

None yet.
