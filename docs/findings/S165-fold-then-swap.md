# S165 — A fold animated on the live column, then sent, shows no flash when its end state is held until the commit

- **Status:** Answered
- **Led to:** ADR-0137

**Question.** A fold must animate the column that is going: its body
fading, its width clipped to the strip's, the columns after it sliding
left. Only then is the fold sent, and React swaps the column for its
strip. Does any frame between the animation's end and the strip's first
frame show the old layout again (the column whole, its neighbours back
where they were)? Does it matter whether the animations are cancelled
before the fold is sent or held until the commit, and whether the fold is
sent from a click (a discrete event) or from plain code, as a callback at
an animation's end would send it?

**Kill criterion.** If every way shows the old layout for a frame, the
plan must draw the strip before the animation ends (a copy over the
column), not swap after it.

**Throw away.** The probe (mode `swap`).

**Answers.**

1. **Sending the fold from code after cancelling the animations flashes.**
   The old layout comes back for one frame, at rate 1 and at 4×: the
   cancel is painted before React renders an update sent outside an event,
   which it schedules as a later task.
2. **Holding the end state until the commit never flashes.** With the
   animations' `fill: "forwards"` kept and cancelled when the strip is in
   the DOM (a `MutationObserver`, standing for a layout effect: both run
   after React's commit and before the paint), no frame shows the old
   layout, whether the fold is sent from a click or from code, at rate 1
   and 4×. At 4× the commit came 57–77 ms after the animation's end; the
   end state held through it.
3. **Cancelling first is safe only when sent from a click**, because then
   React renders in a microtask before the next paint (S164). The plan
   should not rest on that: the fold is sent from an animation's end, not
   an event. It holds the end state and lets go at the commit.
4. **The strip lands where the animation ends.** The next column's marker
   ended the animation at 364 px and sat at 363 px once the strip was drawn
   (its border).

**How it was measured.** Mode `swap` of
`docs/findings/S164-from-unfold-to-drawn/probe.ts`, on a task of four
columns of 150 messages, in Chromium's headless shell at 1920 × 1080. It
puts a red marker on the column after the trunk's and a green one in the
trunk column's body, opens the trunk's ⋯ (hidden by a style, so its Fold
button stays in the DOM), then animates for 200 ms: the column's
`clip-path` to the strip's width, its body's opacity to 0, the columns
after it by `translateX`. At the end it sends the fold in one of four ways:
cancel then click Fold; click Fold and cancel at the commit; cancel then
call Fold's React handler directly; call it and cancel at the commit. The
screencast's frames (PNG) are read in a second page for the red marker's x
and the green marker's pixels. Figures:
`docs/findings/S165-fold-then-swap/runs.txt`.
