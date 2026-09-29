# S54 — why the page's memory grew, and what re-rendered

**Answers.**
1. **The growth was React's dev-build timeline entries** (measured). Two
   Firefox heap snapshots of one session, about 3.4 minutes apart, held
   262 MB and 526 MB of JS heap. Of that, 134 MB and 389 MB was reachable
   only through `PerformanceMeasure` details: 96% of the growth (255 MB).
   Everything else grew 10 MB. The entries went from 55k to 161k, each a
   `{color, properties, tooltipText, track}` object whose `properties` held
   about 18 `[label, value]` string pairs. React 19.2's development build
   (`react-dom-client.development.js`, `logComponentRender`) calls
   `performance.measure()` for every component render whose props changed,
   with a props diff as `detail.devtools.properties`, and the browser keeps
   every entry. The production build has none of this code.
2. **Every `App` render re-rendered every message on screen** (measured,
   12 messages on screen, Chromium, dev build):

   | phase | component renders with changed props | `App` renders |
   |---|---|---|
   | idle, 12 s | 47 | 1 (presence refresh) |
   | one streamed reply | 436–773 | 8 |
   | typing 40 characters | 150 | 3 (your own typing presence) |

   Almost all were `Message` and its `Tools`, once per message per `App`
   render. React marked their props "Referentially unequal but deeply
   equal": `prefill`, `forkTracks`, `closedBranches`, `nameOf`, and closures
   such as `onBranch`.
3. **Streaming does not render `App`** (measured). `App`'s read, run as a
   `@kyneta/reactive` computation against the host's own stream writes
   (`planStream`, `applyStreamOps`), re-ran 0 times for 20 text deltas;
   `readStreams` re-ran 20 times. A `values` write (pi's tool-output
   checkpoint, every 2 s while a tool runs) re-ran `App`'s read once, since
   `App` reads the whole of `values`.
4. **Kyneta keeps the identity of what did not change** (measured). After a
   write adding one entry, `doc.entries()` returned a new record in which an
   unchanged row was the same object, frozen, with the same `payload`. After
   a write to `values`, `doc.entries()` returned the same record.

## Why it was asked

The page's memory grew while in use, and it was not known whether Kyneta or
the app held it. Answer 1 found the holder; answers 2 to 4 found why so many
renders fed it.

## What it changed

PLAN-2026-09-29-render-cascade. Answer 2's cause was `App`'s inline
`useTracked` thunks: `useTracked` re-runs a new thunk, so every render rebuilt
the tree index and every value below it. `App` now reads through
`useSelector` with named reads; `readTreeIndex` and `readRenderableEntries`
cache by the identity answer 4 measured; and `Message` is memoised. The
browser suite counts renders from the same timeline entries answer 1 found
(`packages/client/TECHNICAL.md`, Renders).

## Not tested

- Safari. The timeline entries are React's, so any browser that implements
  `performance.measure` with `detail` keeps them.
- A session with several columns and hundreds of messages. The render count
  scales with messages on screen times `App` renders, by answer 2's shape.

## Method

- Answer 1: `sandbox/heap/`. A Firefox `.fxsnapshot` is a gzip'd stream of
  varint-delimited `CoreDump.proto` messages (Firefox's
  `devtools/shared/heapsnapshot/CoreDump.proto`); a dependency-free Node
  parser keeps nodes in typed arrays, aggregates by type and class, and
  measures what is reachable from the root with and without edges named
  `mDetail`. Firefox's snapshots hold no string contents, so the owner was
  found by the objects' property names.
- Answer 2: `sandbox/s-render/renders.ts`, copied into `apps/pineta/` to run.
  It starts a host with `scriptedModel({ tokensPerSecond: 60 })`, drives
  Chromium's headless shell, and reads
  `performance.getEntriesByType("measure")` whose
  `detail.devtools.track` is `"Components ⚛"`, grouped by name.
- Answers 3 and 4: `sandbox/s-render/probe.ts` and `identity.ts`, over
  `newSessionDoc()`.
