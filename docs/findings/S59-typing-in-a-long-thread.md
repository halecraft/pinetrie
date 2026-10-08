# S59 — is typing slower since drafting cards, or in a long thread?

- **Status:** Answered
- **Led to:** ADR-0056, ADR-0068, ADR-0093, ADR-0106

**Answers.**
1. **Drafting cards cost little per keystroke.** Against the code just before
   ADR-0048's step 1, the card editor adds about 1 ms of script per keystroke:
   the Yjs write to the card's text, its sync, and the undo stack. The page
   holds about 5 MiB more. Per-key latency is the same.
2. **A long thread makes typing stutter, and did before cards.** In a thread of
   1,500 messages, the column re-renders about once a second while you type,
   and that keystroke takes 80–100 ms against a 17 ms median. In a thread of 4
   messages the worst key is 24–33 ms. Both builds show it.
3. **The trigger is your own typing presence.** The composer writes
   `typing` at most once a second (`App`'s `typing`); `App` reads presence
   (`readPresence`), so every write re-renders `App`, and with it every
   `Column`, which builds its whole message list again. Each `Message` is
   memoized (`sameMessageProps`), so the cost is the list itself: it grows
   with the thread, and in a real session each message is heavier (markdown,
   tool rows) than this probe's plain ones. With the write removed, `Column`
   does not render at all while typing in the long thread: the worst key is
   33 ms and script 91 ms, against 84–98 ms and 224–249 ms.

## Why it was asked

After ADR-0048's first step landed, typing felt slower in a long lane, in a
session of 8,206 entries.

## Method

A disposable probe in `apps/pinetrie/e2e/`, not checked in: `startHost` with an
in-memory store; about 8,000 entries written directly (`writeEntry`): 40 roots
of about 160 messages each, and one conversation of 1,500 messages
(`encodeChat` for people's, assistant text for the rest), under a root the
page started, with uuidv7-ordered ids so the column follows them. Headless
Chromium through Playwright; the page types 70 characters one at a time,
waiting a frame after each, with CDP's sampling profiler (200 µs) and
`Performance.getMetrics`. The same probe ran against a copy of the tree at the
revision before step 1 (`/tmp`, Kyneta linked as the lane links it). A
third run, on a copy of the current tree, turned `App`'s `typing` write into
a no-op.

| build | thread | per key: median / p90 / max | script | `Column` (incl.) | editor (incl.) | JS heap |
|---|---|---|---|---|---|---|
| before cards | 1,500 | 17 / 22 / 82 ms | 185 ms | 106 ms | 16 ms (`Composer`) | 169 MiB |
| cards | 1,500 | 17 / 22 / 84–98 ms | 224–249 ms | 113 ms | 29 ms (`CardEditor`) | 179 MiB |
| before cards | 4 | 17 / 19 / 24 ms | 95 ms | 1 ms | 31 ms (`Composer`) | 177 MiB |
| cards | 4 | 17 / 19 / 20–33 ms | 142–159 ms | 3 ms | 34 ms (`CardEditor`) | 181 MiB |
| cards, no `typing` write | 1,500 | 17 / 20 / 33 ms | 91 ms | not sampled | 23 ms (`CardEditor`) | |

Times are over the 70 keystrokes. Two runs of the cards build agreed within
the ranges shown.

## Consequences

1. Nothing in ADR-0048's step 1 needs undoing for speed.
2. **A presence write should not rebuild the columns.** Presence feeds small
   parts of a column (its header's avatars, the composer's "is typing" line);
   those can read presence themselves, so a write re-renders them and not the
   message list. Your own `typing` write need not re-render your page at all.
3. A column's message list is the part that grows with the thread; any
   re-render of `Column` for a reason that leaves its messages alone should
   skip it.

## Where a column's render goes

A second probe, rebuilt from the Method above and also not checked in, asked
how much of a `Column` render is the message list, and how much is the rest
of its work: the walks along its thread's path (`columnView`, `threadOf`,
`nearestRevision`, `yourCard`, `draftingAt`). It used the 1,500-message
thread among 7,902 entries, and typed 22 keys 1.1 s apart, so each key's
`typing` write re-rendered `Column` once with its messages unchanged. The
sampling profiler ran at 100 µs. Each sample is counted under the nearest
frame that names its part.

| part, per `Column` render | ms |
|---|---|
| building the list: the per-message callback in `Column` | 54.2 |
| of which, `jsxDEV` itself | about 52 |
| comparing the list: `sameMessageProps`, then React's reconcile and bailout | 2.3 |
| the walks: `columnView` 0.5, `threadOf` 0.5, `nearestRevision` 0.3, `yourCard` 0.25, `draftingAt` 0.23 | 1.8 |
| the rest of `Column` | 0.7 |
| `App` | 3.0 |

React's own measure of each `Column` render took 55–72 ms.

- **The walks are small.** Together they cost 1.8 ms on a 1,500-message
  path, about 3% of the render. They grow with the thread, but at this size
  they don't need memoizing.
- **Most of the list's cost is the development build's element.** For each
  element, React 19.2's `jsxDEV` captures an `Error("react-stack-top-frame")`
  and a `console.createTask` for owner stacks
  (`react-jsx-dev-runtime.development.js`, up to 10,000 per reset). That is
  about 35 µs per `<Message>`, whether or not the message then redraws. The
  host always serves Vite's development build (`apps/pinetrie/host/http.ts`), so
  this is the cost a person feels. Skipping the list when a column's messages
  are unchanged removes it.

## React's production build under Vite's dev server

The same probe ran once more with the host started under
`NODE_ENV=production`. Vite reads that variable when it resolves its config
(`isProduction`). With it set, esbuild emits `jsx` rather than `jsxDEV`
(`jsxDev: !isProduction`), `@vitejs/plugin-react` skips Fast Refresh, and
the dependency optimizer bundles React's production files. The page loaded
and drew all 1,500 messages. React recorded no component measures.

| React build | keydown events of 16 ms or more (Event Timing) | worst | script over 20 keys |
|---|---|---|---|
| development | 21 of 20 keys | 80 ms | 1,741 ms |
| production | 14 | 16 ms | 399 ms |

The optimizer's cache hash includes `NODE_ENV` (`getConfigHash`), so
switching builds re-optimizes into the same `cacheDir`. At the time,
nothing in this repository read `NODE_ENV`.

## How the presence document notifies

A probe in Node: a `@kyneta/reactive` computation over one field of a
presence document (`newPresenceDoc`), and writes with `batch`.

- A computation over `typing()` fired on a `typing` write, and not on a
  `reading` or `editing` write. Each field held the same: a read of one
  field is woken only by writes to it.
- Writing a value a field already held fired its computations again, and the
  field's record was a new object, each unchanged row the same. The page's
  10 s refresh writes exactly that.
- Notifications arrive after the write, not during it (the probe had to
  yield before counting).

## After

The same probe, on the code of PLAN-2026-09-30-presence-renders, with the
1,500-message thread, 20 keys 1.1 s apart.

| React build | keydown events of 16 ms or more | worst | script over 20 keys | renders while typing |
|---|---|---|---|---|
| development | 6 | 16 ms | 179 ms | `App` once (the first key makes your card); no `MessageListView` |
| production | 7 | 16 ms | 223 ms | not recorded |

Against "React's production build" above: development React went from 80 ms
to 16 ms worst and 1,741 to 179 ms of script.

## What it changed

PLAN-2026-09-30-presence-renders. `App` reads no presence: each field is
read by the small part that shows it (`packages/client/use-presence.ts`).
A column's message list is memoised (`MessageList`). `pnpm run host`
serves production React, and `pnpm run host:react-dev` development React
(`docs/pinetrie.md`).

## What was not measured

- Your session itself: a long lane's messages carry markdown and tool rows,
  which cost more per render than this probe's.
- `vite build`'s output: production React was measured only under Vite's
  dev server, which still transforms each module on request.
