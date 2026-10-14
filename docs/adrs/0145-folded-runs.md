# ADR-0145 — The host holds a lane's runs folded as their events arrive, never the events themselves, so what it holds grows with the paths the runs touch, not with how often they touch them

- **Status:** Accepted (Duane, 2026-10-13)
- **Area:** `packages/lanehost/TECHNICAL.md`, `packages/rules/TECHNICAL.md`
- **Evidence:** S191, S179
- **Amends:**
  - ADR-0135: a run's events are folded on the host as they arrive, not
    gathered until the turn's drain; a flush is still the barrier before a
    drain reads them.

**Context.** On 2026-10-13 the Mac's host died at its 4 GB heap limit, 12
minutes into one `bash` call that ran `pnpm mutate` again and again
(S191).

How the host handles a run's events today:
- The observer reports every open of a run, read-only ones and failed
  lookups included, and each written file's release (ADR-0135).
- The host keeps each one in its lane's array in
  `packages/lanehost/observer-client.ts`.
- Only a flush empties that array, and a flush comes only at the turn's
  end.
- Then `foldRunEvents` (`packages/rules/runs.ts`) folds the events into
  one trace per run: one entry per path inside the lane. A repeated read
  changes nothing there, and a path outside the lane is discarded.

So the fold is bounded, but nothing reaches it until the call ends.

What S191 measured:
- A held event costs about 500 bytes.
- `pnpm mutate` makes about 9,500 events a second, which grows the heap
  4.66 MB/s: 3.4 GB in those 12 minutes.
- A call that read 1,000 files 1,000 times held 507 MB. All of it was
  discarded at the drain, since the files were outside the lane.

What the host holds should grow with the size of the answer, the paths a
turn touched, not with how long its command ran.

**Decision.**

- **What the host holds of a lane's runs is their fold:** per run, its
  trace. That is:
  - one entry per path the run touched inside the lane;
  - its exit, its end and its losses;
  - its accesses of shared files.

  No list of events outlives the batch it arrived in.
- **There is one fold, applied as events arrive, in batches.**
  - `foldRunEvents` is a left fold whose state carries from one call to
    the next. So folding batch by batch gives the trace that folding
    everything at the drain gives.
  - A test holds it to that, over random splits of event sequences.
  - A batch is what has arrived, up to a size. A fold per event would
    copy the trace's maps for every event.
- **lanehost holds the state, and the host supplies the fold.**
  - The observer client is given a fold: an empty state, and a step that
    takes a state and a batch.
  - It holds only what that fold makes.
  - lanehost keeps to `@pinetrie/core` and `@pinetrie/channel`, and the
    fold stays in `@pinetrie/rules`.
- **The fold's inputs are known when observation starts.**
  - The lane's root and its shared directories are given to `observe`,
    and do not change while the container runs.
  - A run's command still comes at the drain, from the helper's
    `launched`, and is set on its trace then. The fold does not read it.
- **A flush is still the barrier.**
  - A drain takes the folded state only after a flush has answered, so no
    drain folds without one.
  - Events that arrive while the drain runs wait in the batch. They are
    folded onto what the drain leaves of each trace.
  - The next tool call waits for the drain (`apps/pinetrie/host/TECHNICAL.md`,
    "A turn's end is one queued step"). So these come only from a process
    the turn left running.
- **An event outside the lane costs nothing past its batch.** The fold
  discards it, as it does now. Nothing filters it earlier.

**Consequences.**

- **What the host holds for a lane is bounded.** Its parts:
  - one batch;
  - the distinct paths the lane's runs touched inside it;
  - their shared accesses.

  S191's calibration would hold nothing past a batch. `pnpm mutate` would
  hold the paths it read under `/workspace`, `node_modules` among them:
  tens of thousands, not millions.
- **A drain no longer folds a turn's events all at once, on the host's
  main thread.** The work is spread over the call. S179 found the next
  stall there.
- **A drain runs inside its `RunSource`** (`@pinetrie/core`):
  - the source flushes, then calls the drain with the folded traces, and
    keeps the traces it returns;
  - the `Flushed` brand goes, since that call is the only way to reach the
    traces;
  - the launched runs' commands are set on the traces at the drain;
  - the traces `drainLaneRuns` kept between drains (`packages/pi`) go: the
    state lives in the source.
- **Two parts are still not bounded by paths.**
  - **A trace's `accesses`** keeps every open and release under a shared
    directory. `sharedTouches` reads them in time order and pairs each
    written file's open with its release, by process. So it grows with
    the work done in shared directories. Reducing it needs a proof that
    `sharedTouches` answers the same, and is not decided here.
  - **`moveUnder`**, for each directory a run renames, scans every path
    known so far. That costs time, not memory, and gets an index of the
    paths under each directory, as S179's fix did.
- **What the role holds is unchanged.** It still keeps the raw events of
  a lane with no host connected; its held-notice bound turns the excess
  into losses (`packages/lanehost/TECHNICAL.md`).
- **Nothing here keeps the host alive past its heap limit.** It removes
  the cause S191 found.

**Alternatives rejected.**

- **A cap on the held events, the excess counted as losses.** It bounds
  memory, but every long build becomes a run with a loss, and so no
  recipe. It throws away what the fold keeps for free.
- **A drain during a long call.** A drain is the turn's queued step, with
  its commit and snapshot, so a drain mid-call changes what a turn is.
- **Repeats dropped in the role.**
  - The role would need the fold's rules: a path's first event decides
    whether it was there before, and a path is read again at each drain.
  - That would be a second implementation, in another process, free to
    drift from the first.
- **Paths outside the lane dropped in the loader or the role.**
  - That would be a second definition of what is inside the lane.
  - It would not bound the repeated reads inside it (`node_modules`).
  - It would save CPU and traffic, not memory, and S191 did not measure
    how much. It can come later, on a measurement.
- **A larger heap, or the events gathered in a worker.** Either postpones
  the limit or moves the growth elsewhere; neither bounds it.
