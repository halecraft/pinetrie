# S216 — The host can hold a root only while something needs it: Kyneta serves a tab across an unload, six host reads would write wrong values for a root not loaded, and a held root costs about its stored size in heap

- **Status:** Answered
- **Led to:** ADR-0162

**Question.** A starting host opens every started root with a thread on an
open task's canvas or in an inventory (`planLoads` over `rootsHeld`,
`apps/pinetrie/host/docs.ts`): 115 of 195 on Duane's host on 2026-10-16,
most of them in the backlog. Could it hold a root only while something needs
it (a run, a queued card, a command or a late write into it) and let it go
when idle?
1. Which host code reads a root's document only if it is already loaded
   (`docs.view`, `docs.docOfLane`, `docs.loaded`)? What reaches each read,
   and can it reach a root with no lane running?
2. What must a starting host still open so that a lane a crash interrupted
   is resumed?
3. What does Kyneta do when the host unloads a root that a tab holds, and
   later loads it again and writes to it? When a tab asks for a root the
   host has let go, does the host see it load? Can the host tell which tabs
   hold a root?
4. What does a loaded root cost, in heap and in time to load, by its stored
   size? Is loading many roots at once faster than one after another?

**Kill criterion.** Any of these: Kyneta loses a tab's copy, or stops
sending a tab the writes made after the host unloads and reloads a root; a
read that needs a root loaded is reached from a step that cannot load it
first; or a loaded root costs so little that 115 of them are under 50 MB of
heap and half a second to load.

**Throw away.** One probe, kept as the record of what ran:
`docs/findings/S216-on-demand-roots/probe.ts`. It is run from
`apps/pinetrie/host/` (its imports are that directory's) with
`node --expose-gc`, over a host `Exchange` on `openStore`'s SQLite store
with `{ authority: "self" }`, `RootDoc`, and tabs on Kyneta's in-process
`Bridge` with a `canShare` that wants only the roots they hold, as
`packages/session/root-docs.ts` does. Its output is `output.txt`. Questions
1 and 2 were read from source, not run.

## Answers

Measured in a lane (Linux, Node 24.21) on 2026-10-16, against Kyneta at
`kyneta/workspace/pineta`.

1. **The reads.** All 24 of them were read. They fall into three groups.

   *During a run.* `runs.ts` (the stream, the run's end before `endRun`),
   `pinned.ts` and `canvas.ts` (what a run reads as it starts),
   `budgets.ts`, `digests.ts`'s pending verdict and `commands/lane.ts`
   (running lanes) read the root of a lane whose run is in
   `activeRuns`. None of them loads it: each relies on the step that
   started the run having loaded it, and on nothing letting it go before
   `endRun`. `packages/pi/agent.ts` opens it with `documents.root` only
   once pi starts, after `readPinned` and `readTaskContext` have read.

   *After a run.* `answers.ts`'s `ended` reads the prompt after `endRun`,
   and the late steps of `digests.ts` and `answers.ts` read it after a
   model request. Today the root is still held because the thread is live.

   *With no run.* `directory.ts` is harmless: a root that is not loaded
   does not change, so its record stays true. Six others can be reached
   with no lane running. On `null` they do not fail. They go on with an
   empty value:
   - `jj/offers/state.ts`: `tipOf` gives `""`, and `wipLine` gives a WIP
     description without its first prompt. An offer refresh (accepted work
     moving, a catch-up) and an accept or rebuild (`jj/offers/act.ts`) then
     write that into the offer and its WIP commit.
   - `work/destination.ts`: `offerReadFacts` reads revisions only from
     loaded roots, so a review of an offer in an unloaded root finds no
     range.
   - `places.ts`: `endOf` gives a composing, queued or pinned card no
     thread end, so a card pinned in a backlog task is moved without one.
   - `index.ts`, `appendLaneless`: `docOfLane` returning null is read as
     "this thread has no lane". For a lane in an unloaded root it then reads
     `view`, gets null and returns false.
   - `describe.ts`: an offer's description is asked with the thread's
     messages from `docOfLane`, so an offer in an unloaded root is
     described from its diff alone.
   - `later.ts`: every late step's plan reads `docs.view`, and the host's
     TECHNICAL.md forbids `docs.root` there. A late write into a live
     thread whose root is unloaded would write nothing.

   Each of these is reached from a step that can await first. Refresh,
   accept, review and a description gather before they plan. `Places.change` runs in a
   command or in a step. `Later.step` checks `lateAway` before it plans, so
   it can open the root of a thread that passes. Every other path already
   opens its root with `docs.root` or `docs.laneDoc`: commands
   (`commands/chat.ts`, `cards.ts`, `board.ts`, `gate.ts`, `lane.ts`),
   `threads-now.ts`, `titles.ts`, `records.ts`, `work/update.ts`,
   `work/turns.ts`, `save-blob.ts`, `split-call.ts` and `jj/split.ts`. In
   `packages/pi` the agent and the scribe open roots only through
   `documents.root`.

2. **Startup.** `recover` (`apps/pinetrie/host/startup.ts`) asks pi which
   lanes in the roots it opened hold an operation open
   (`agent.interrupted`, which runs `inspectExecution` on each lane). It
   also runs two other passes over those roots: `planUndeclaredSweep` and
   the log of malformed lanes.

   `pinetrie:live` is stored, and its `activeRuns` names every lane that was
   running when the host died, until `planClear` empties it at startup. A
   run writes `begin` to it synchronously in `Runs.start`, before any await,
   so before pi opens the operation. It writes `endRun` after pi returns.
   Kyneta persists each document from a per-microtask drain
   (`#drainLocalChanges` in `packages/exchange/src/runtime.ts`), so `begin`
   is requested for storage in an earlier drain than pi's write. This was
   read, not measured: no process was killed in between.

   Two gaps remain. If pi holds an operation open outside a run (an
   `append` a command makes, say; not checked), `activeRuns` does not name
   its lane. The two other startup passes cover only the roots opened. All
   three are per root, so they can run as a root loads instead of at
   startup: the roots of `activeRuns` and of the lanes with queued cards at
   startup, and every other root when it is first opened.

3. **Kyneta across an unload.**
   - **The host unloads a root a tab holds** (P1). The host sends the tab
     `dismiss`: neither side lists the other as a peer of that document any
     more. The tab keeps its whole copy (50 of 50 entries) and gets no
     `documents` event. No `unloaded-doc-reloaded` warning is logged.
   - **The host loads it again and writes** (P1). `get` announces the root
     again. The tab's `canShare` still wants it, so it syncs again, and the
     tab had the write by the first check after `flush`. A second tab
     opening it then had all 51 entries in 5 ms. So a tab does not need the
     host to hold its roots: anything the host writes reaches the tab
     whenever the host has the root loaded.
   - **A tab asks for a root the host has let go** (P2). Kyneta loads it
     (S86) and the host's `exchange.documents` reports `doc-promoted`. The
     host's own `get` then returns it already hydrated (20 of 20 entries),
     and its next write reached the tab in 5 ms. So `HostDocuments` does not
     know about a root loaded this way unless it follows
     `exchange.documents`.
   - **The host lets go of a root a tab's ask just loaded** (P5, 500
     entries). Unloaded a macrotask after `doc-promoted`, once the tab had
     synced, it stayed unloaded, and the tab kept all 500 entries.
     Unloaded a microtask after it, while the tab still waited, the tab
     asked again, the host loaded it again, and the tab had all 500 in
     13 ms. With an unload at *every* promotion, that repeats with no end:
     the probe hung, printing nothing, until it was killed at 30 s. So a
     root a tab is still syncing must not be let go.
   - **Telling which tabs hold a root** (P3). The public
     `sync(doc).peerStates` and `sync(doc).onPeerSyncChange` list them. The
     host hears a tab disconnect. It does not hear a tab let a root go the
     way `rootDocs` does it now. `rootDocs` narrows `wanted` before it
     calls `destroy`. `dismiss` is filtered by `canShare`
     (`contentRecipients` in `packages/exchange/src/sync-program.ts`), so
     no `dismiss` is sent, and the host goes on listing the tab as
     `synced` until it disconnects. In the other order, `destroy` and then
     narrowing `wanted`, the host heard the drop at once (3e), and a later
     announcement did not bring the root back to that tab (3f).

4. **The cost** (P4: 20 roots of each size, loaded from the store after a
   compaction):

   | stored per root | load, per root | heap, per root | heap after `unload` |
   |---|---|---|---|
   | 0.06 MB (50 entries) | 1.3–1.5 ms | 0.11 MB | 0.01 MB |
   | 0.59 MB (500 entries) | 3.8–4.1 ms | 0.72 MB | 0 |
   | 4.35 MB (2,000 entries) | 17.7–19 ms | 4.76 MB | 0 |

   - Heap is about 1.1–1.8× the stored bytes, and loading takes about
     4.4 ms per stored MB.
   - Loading all of them at once with `Promise.all` is no faster than one
     after another: hydration is CPU-bound on one thread.
   - `unload` gives the heap back.
   - In S84, Duane's 57 roots were 124 MB stored: median 0.9 MB, 90th
     percentile 5.6 MB, largest 13.6 MB. All of them together loaded in
     955 ms and held 186 MB of heap.
   - If the 115 roots are like those, they hold about 250 MB stored, which
     comes to roughly 300 MB of heap and 1.1 s of startup. This is
     estimated, not measured on Duane's store. Run on a copy of the store
     with the host stopped, this query gives the real numbers:

     ```sh
     sqlite3 -readonly pinetrie.db "SELECT doc_id, SUM(COALESCE(LENGTH(payload),0)+COALESCE(LENGTH(blob),0)) AS bytes FROM kyneta_records WHERE doc_id LIKE 'root:%' GROUP BY doc_id ORDER BY bytes DESC"
     ```

The kill criterion is not met. Kyneta keeps a tab's copy, and it resyncs
the tab after a reload. Each read that needs a root is reached from a step
that can load the root first. Unless Duane's sizes are far below S84's, the
115 roots cost well over 50 MB.

**What a plan takes from it.**
- A root is loaded through `docs.root` before any step plans from it. This
  replaces the rule that a live thread's root is held (S199) with "a step
  loads the root it reads".
- The six reads with no run become "load, then plan". `docOfLane` stops
  standing in for "this thread has no lane".
- `Later.step` opens the root of a thread that passes `lateAway`, then
  plans.
- A run holds its root from its start until its `ended` has run, and loads
  it before `readPinned` reads.
- A starting host opens the roots of `activeRuns` and of lanes with queued
  cards. Recovery and the two sweeps run per root, as each loads.
- `HostDocuments` follows `exchange.documents`, so a root a tab loaded is
  known, and is let go on the same terms as any other.
- An idle root is unloaded in a keeper step, so the unload is ordered
  against commands. A root whose peer state for some tab is still `pending`
  (`sync(doc).peerStates`) is skipped, and that state settling queues the
  sweep again (P5). The host need not know which tabs hold a root, since
  a reload resyncs them. If it ever should, `rootDocs` must `destroy`
  before it narrows `wanted`.
