# S284 — A column's status dot needs no new value from the host

- **Status:** Answered
- **Led to:** ADR-0198

## Question

A column, folded or not, is to carry one dot for its thread's state, and
it should be more specific than the sidebar's mark: grey for nothing, and
in its place needs you, conflicts, ready to accept, worth a read, working,
accepted. Can the tab work out every one of those states for each thread
column from what it already has, a folded column included (where no column
is projected)? Or does any of them need a new value from the host?

## Kill criterion

If any state needs a fact the tab does not hold for a folded column's
thread, or one only the column's projected path (`ColumnFacts.view`)
gives, the dot needs a new host value or a projection for every folded
column, and the plan has to price that in.

## Throw away

Nothing was built. The answer is read from source.

## Answers

**Yes, from what the tab holds.** The dot has two sources, and the tab
holds both for every column on a canvas, folded or not.

1. **What needs you, for you (the sidebar's rule).** `threadStatus`
   (`packages/interface/attention.ts`) already decides each thread's
   status: working, or its highest raised item (needs you, worth a read),
   with the item saying what raised it (`Raised`: a run-end report, ready
   proposed changes, an ssh ask). `useAttention`
   (`packages/web/use-attention.ts`) computes it and passes it straight to
   `canvasStatus`, so the per-thread map is thrown away. The fix is to
   return it. A raised item that has been read or dismissed but still
   stands is `standingRunEnds`, which the columns already get as
   `runEnds`.
2. **What the thread's work is in (shared).** `workStrip`
   (`packages/interface/column-view.ts`) decides the work strip's state
   (`nothing`, `running`, `busy`, `needs-you`, `conflicts`, `ready`,
   `stack`, `stale`, `edited`, `accepted`; `WorkStripView` in
   `packages/rules/work-strip.ts`). Of `ColumnFacts` it reads only `lane`,
   `work`, `writable`, `index`, `lanes`, `queued` and `acting`, plus
   `parent` (`parentOfLane(index, work, lanes, lane)`). It never reads
   `view`, the projected path. Each of those is in the tab for a folded
   column:
   - `work` is the session document's own reads (`projection.ts`,
     `workFacts`: proposed changes, bases, accepted work, lanes), the same
     for every lane, not per column.
   - `index` and `lanes` belong to the held roots, and a canvas's thread
     column exists only for a held root: `cardColumn`
     (`packages/interface/canvas-columns.ts`) returns null otherwise, so a
     folded strip's thread is always held.
   - `lane` is `threadLane(lanes, thread)`.
   - `queued` is `queuedOn(cards, lane)`, and the strip already receives
     `cards` (`packages/web/strip.tsx`).
   - `acting` is the tab's own session state.

### What the plan must handle (no new data, but real work)

- **`workStrip` takes all of `ColumnFacts`.** To call it for a folded
  column, narrow its input to the fields above, so the strip can compute
  it without a projected column.
- **The two sources differ in scope.** Attention is per reader: only a
  thread you follow, nothing while it is busy, cleared when read or
  dismissed. Work state is per lane, for anyone who may write. Ready to
  accept shows up in both (attention's `ready` item, and the strip's
  `ready`/`stack`/`stale`/`edited`), so the dot needs a stated precedence,
  and a rule for whether ready reads bright (raised for you) or quiet
  (dismissed, or a thread you don't follow).
- **A read-only canvas has no work strip.** `workStrip` returns null
  unless `writable`, so there the dot comes from attention and working
  alone. A chat, and a thread not yet started, have no lane, so their dot
  is grey or absent. A note column and a media column have none.
- **The sidebar's fading ✓ is keyed by canvas.** `arrivals` and
  `useArrivals` are typed by `CanvasId`. A column's ✓ fading as a run ends
  needs the same keyed by thread: generalise the key, not the rule.
  "Accepted" itself is a standing state (`proposed.kind === "accepted"`),
  not an arrival, and needs no fade.

### The two sources already disagree

Attention's `ready` item comes from `openProposed`
(`packages/interface/app-view.ts`), which raises any proposed changes whose
`proposedChangesStatus` is `open`. The work strip derives its state from
the same record by its own ladder (`workStripView`), where open proposed
changes can be `conflicts`, `needs-you`, `edited`, `stale` or `stack`. So
the sidebar says "changes ready to accept" for a thread whose strip says
"conflicts with main in 2 files". Two derivations of one fact.

### What only a held root can tell

Of the strip's inputs, two read the root's tree index:
`conflictAskTime` (the agent asked about a conflict newer than the
proposed changes: `needs-you`) and `laneActivity` (a running turn, a
resolution or a split). The sidebar covers canvases whose roots this tab
does not hold, so there it cannot run the full ladder. For the dot,
activity matters only as working, which `readRunningLanes` gives for
every root; the conflict ask is the one fact the sidebar cannot have
without the index.

### Each state, and where it comes from

| dot | from |
|---|---|
| needs you | `threadStatus` raised `needs-you` (run end, ssh ask); the strip's `needs-you` |
| conflicts | the strip's `conflicts` (and `edited` with conflicts) |
| ready to accept | the strip's `ready`/`stack`/`stale`/`edited`; bright when attention raised `ready` |
| worth a read | `threadStatus` raised `worth-a-read` |
| working | `threadStatus` `working` (includes a pending run-end report); the strip's `running`/`busy` |
| accepted | the strip's `accepted` |
| nothing | none of these |
