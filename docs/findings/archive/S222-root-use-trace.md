# S222 — once a refresh stopped loading roots, no policy for keeping them loaded saves anything; what is left is the tab's roots at connect

- **Status:** Answered

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

Six traces from Duane's host on 2026-10-17, 1 to 57 minutes each, replayed
against a copy of his store (216 roots weighed by stored size). The first
four ran before a refresh read its root only when it builds; the last two
after.

| trace | minutes | loads | of them, a refresh's | root compactions | loaded |
|---|---|---|---|---|---|
| 1 | 57 | 71 | 53 | 63 | 226 MB |
| 2 | 8 | 4 | 0 | 0 | 12 MB |
| 3 | 41 | 93 | 73 | 83 | 1,040 MB |
| 4 | 1 | 31 | 14 | 14 | 89 MB |
| 5 | 1 | 17 | 0 | 2 | 50 MB |
| 6 | 5 | 17 | 0 | 0 | 50 MB |

1. **Before the fix, a refresh was three quarters of every load.** Each
   one leased its lane's root to read the tip (`jj/proposed/state.ts`),
   and the next upkeep compacted it and let it go.
2. **A root holding many lanes was loaded once per lane.** In trace 3, a
   33 MB root was loaded 25 times in 41 minutes, 11 of them in the 18
   seconds after the host started: each of its lanes' refreshes loaded it,
   and an upkeep let it go before the next. That is 833 MB loaded for one
   root, and the start's stalls.
3. **After the fix, no refresh loads a root.** In trace 6 the build's read
   leased a root 7 times and never loaded one: it was held already. No
   root was compacted.
4. **No policy beats today's after the fix.** Before it, keeping roots
   longer would have saved most loads: trace 3's 93 loads would have been
   31 under an LRU of 250 MB or a 30-minute grace, 54 under a 60 s grace.
   In traces 5 and 6 every policy loads what today's does. So the kill
   criterion holds: a memory budget is not worth its code now. The traces
   after the fix are short, and none has a run in a root no tab holds.
5. **What is left is the tab's roots at connect:** 15 to 17 loads at each
   start, about 50 MB, every root of every canvas in the sidebar. The
   tab held 17 or 18 roots at once; the most loaded at any time was
   84 to 116 MB.
6. **The replay counts what it is given.** A trace file appended across
   two host starts (trace 2) counts each start's loads in "as traced",
   and the replay treats them as one host.

The store copy beside these traces also says the session is now 45 MB,
36 MB of it shared lineages (S224's trim ran). 33 MB of those are two
folders that are still there: `sandbox/.pnpm-store` (17,715 paths; made
2026-10-17 10:01, 330 MB on disk) and `media/noun-icons` (16,923 paths).
