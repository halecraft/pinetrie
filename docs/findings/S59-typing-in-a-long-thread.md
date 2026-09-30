# S59 — is typing slower since drafting cards, or in a long thread?

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

A disposable probe in `apps/pineta/e2e/`, not checked in: `startHost` with an
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

## What was not measured

- Your session itself: a long lane's messages carry markdown and tool rows,
  which cost more per render than this probe's.
- A production build: the page is Vite's development build, whose JSX
  runtime (`jsxDEV`) costs more than production's.
