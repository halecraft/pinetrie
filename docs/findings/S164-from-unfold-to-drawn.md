# S164 — An unfold is drawn in one long task, a quarter second for 150 messages; an animation the compositor runs keeps moving through it

- **Status:** Answered
- **Led to:** ADR-0137

**Question.** An unfold animation can start only once the unfolded column
is drawn. How long after the press is that, and does the column arrive
whole or fill in over later frames? Is the fold (or unfold) rendered in the
press's own task, a microtask after it, or a later task? And while the main
thread renders a long column, does an animation already running on the
compositor (a transform or opacity by the Web Animations API) keep moving,
so motion could cover the wait?

**Kill criterion.** None: this measures what the plan must time against.

**Throw away.** The probe (modes `mount` and `compositor`).

**Answers.**

1. **The column arrives whole, in one long task, in a microtask after the
   press.** The fold is the tab's layout reducer (`layout.ts`), and a click
   is a discrete event, so React renders it in a microtask after the click
   returns, before the next frame: never synchronously inside it, never in
   a later task. An unfold of a column of 150 messages is one long task of
   about 250 ms (rate 1) or 0.9–1.1 s (CPU throttled 4×), then the first
   frame draws it with all 150 messages; nothing fills in later. A fold
   (the strip replacing the column) takes about 25 ms (rate 1) or
   100–150 ms (4×).
2. **So an unfold animation adds no delay of its own, but cannot hide the
   wait by starting after it.** Started from the commit (a layout effect, or
   a `MutationObserver` callback, before the first paint), it begins on the
   column's first frame. The 250 ms before it are today's, animation or
   not.
3. **A compositor animation keeps moving through the long task, if one
   frame passes first.** A transform animation started two frames before
   the press produced a new picture every 16–18 ms throughout the commit,
   at rate 1 (263 ms) and 4× (1.1 s). Started in the same task as the
   press, it produced no frame at all until the commit ended. A plan that
   wants motion during the wait starts it, lets one frame pass
   (`requestAnimationFrame` twice), then sends the unfold.

**How it was measured.** `docs/findings/S164-from-unfold-to-drawn/probe.ts`
starts a suite host and writes one task: a trunk and three branches of 150
messages each (paragraphs, lists, code blocks, tables), opened in
Chromium's headless shell at 1920 × 1080; the branches open folded. Mode
`mount` clicks a strip's unfold in the page and records whether the column
is there after `click()` returns, in a microtask, when a
`MutationObserver` sees it, in which animation frame, and the long tasks;
then folds it again from its ⋯ and records the same. Mode `compositor`
turns a 300 px element over 600 ms, presses an unfold, and records the
screencast's frames (`Page.startScreencast`) with a hash of each picture.
Figures: `docs/findings/S164-from-unfold-to-drawn/runs.txt`.

**Limits.** The host serves React's development build through Vite, as
`pnpm host` does for everyone, so these are the times a person sees, on
this container's CPU. The headless shell composites in software; a GPU
only makes the compositor's side cheaper.
