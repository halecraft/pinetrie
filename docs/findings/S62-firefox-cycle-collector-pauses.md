# S62 — what stops the page for seconds in Firefox

**Answers.**
1. **The pauses are Firefox's cycle collector, not script** (measured). In a
   50 s profile from Duane's machine (Zen, Firefox 155, macOS, production
   React, a session of 9,177 entries), the page's main thread stopped twice,
   for 8.8 s and 9.0 s. Almost all of each stop is `nsCycleCollector_collectSlice`
   ("Incremental CC"), most of it building the graph
   (`CC (Build Graph)`, 7.8 s). Each collection's marker says it visited
   22,551,279 garbage-collected objects (`mVisitedGCed`), freed none of them,
   and ran one non-idle slice of 6.6–6.8 s. Garbage collection
   (`GCMinor`, 11 in all) took 15 ms in total.
2. **What it walks is the page's live JavaScript heap**, which is large in
   this session (measured in Chromium against a copy of the same store):
   236 MiB after a forced collection, once the page had drawn its longest
   thread. About 160 MiB of it was allocated inside `App`'s session read
   (`readSessionFacts` under `useSelector`), by Kyneta's per-node
   bookkeeping: `mapPayload` 56 MiB, `wireChangefeed` 28 MiB,
   `onRefCreated` 25 MiB, `attachIsPopulated` 9 MiB, `createNodeChangefeed`
   7 MiB. Chromium has no collector of this kind, so it showed no such pause.
3. **Each change to the session document allocates about 190 MiB**
   (measured, Chromium, one chat entry arriving). `readSessionFacts` reads
   everything again: `readRevisions` re-decodes every revision record with
   TypeBox (102 MiB), `readValues` rescans `values` (27 MiB), the tree index
   re-decodes every entry's message (23 MiB), and the rail, lanes, outbox,
   mentions and root summaries are rebuilt. It cost about 0.3 s of script.
   An agent's run writes an entry per message and a tool checkpoint every
   2 s, and the host writes a seat record when a page connects.

## Why it was asked

After PLAN-2026-09-30-presence-renders, Duane still saw the page stop for
about 5 s while typing, twice, and on load, in a session of 9,177 entries.

## Method

- The profile: Firefox Profiler, recorded on Duane's machine, read with a
  disposable script over its processed JSON (`threads[2]`, the content
  process's main thread). Busy stretches were found from `threadCPUDelta`;
  the cycle collector's own `CC` and `CCSlice` markers gave its counts.
- The heap: a disposable probe started a host on a copy of Duane's store
  (`.pineta/pineta.db`), opened its longest open thread in headless
  Chromium with production React, and used CDP's sampling heap profiler
  (`HeapProfiler.startSampling`), once over the load (live objects after
  `collectGarbage`), and once over one entry arriving, counting objects
  already collected too.
- Typing, in the same setup, in Chromium and headless Firefox on Linux:
  30 keys, worst 31–64 ms, no stall over 150 ms. Neither ran long enough, or
  under the same load, to see a collection like the profile's.

## Not tested

- Firefox with its developer tools closed. The profile was recorded from
  them, and an open toolbox can keep more of the page alive.
- How many of the 22.5 million objects are Kyneta's, Pineta's or React's:
  only bytes were measured, in Chromium.
