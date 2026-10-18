# S243 — The inventory opens and closes in motion with CSS while always drawn; a card flown inside the growing panel starts far off, and flown on the page it lands exactly

Numbered S240 until 2026-10-18, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0171

**Question.** The panel grows from its toggle and shrinks back in 200 ms,
and a take while it is closed peeks: open, the card's flight, close
(ADR-0171, proposed). Today `App` mounts the panel only while open, and a
flight (`use-flight.ts`) measures its destination once it is drawn.
- Kept mounted through its close (or by a CSS transition on
  `display`/`@starting-style`), does the panel shrink into the toggle
  with no frame of it at full size or gone too early?
- A flight's destination is a slot inside a panel still growing: does the
  flight measure the slot at its scaled size and land beside it? Does
  waiting for the panel's `transitionend`, or measuring the slot without
  the panel's transform, land it exactly?
- Under `prefers-reduced-motion: reduce`, does a fade alone keep the
  peek's order (open, land, close) readable?
- Does a pointer entering the panel during a peek keep it open, with no
  close already scheduled firing after?

**Kill criterion.** If a flight cannot land exactly in a slot of a panel
in motion, the peek opens the panel first and the card flies after the
panel has settled, and the ADR's timing changes.

**Throw away.** A probe page with the panel's CSS and `use-flight`, and
the frames it records, measured in the lane's headless Chromium.

**Answers.** Measured in the lane's headless Chromium 156 with a probe
page (`docs/findings/S243-panel-motion/motion.html`, driven by
`s240.mjs`): a panel 56rem wide at `top: 30vh`, a toggle at the bottom
left, a card in a column to the right, and a 2 × 6 bag. Each frame's
box read by `getBoundingClientRect` on `requestAnimationFrame`.

1. **CSS opens and closes the panel with it always mounted.** With
   `@starting-style` for the open state and `transition-behavior:
   allow-discrete` on `display`, the panel grew from scale 0.05 at the
   toggle (its `transform-origin` set at the toggle's centre) to full
   size in 200 ms, and shrank back on close, `display: none` only after
   the last frame. No frame showed it full size before growing, or gone
   before shrinking. Both features answered `CSS.supports` in Chromium
   156; Safari has had them since 17.5 (read, not measured). React keeps
   the panel drawn and toggles a class, so nothing unmounts mid-motion.
2. **A flight into a growing panel, as the page flies today, starts in
   the wrong place.** The page measures the card once drawn in its slot
   and animates it from its old box (`use-flight.ts`). Mid-growth the
   slot measured 10 px wide at the bottom left, and the translate is
   applied inside the scaled panel: the card's first frame was 307 px and
   615 px from where it left. Measuring the slot by layout
   (`offsetLeft`/`offsetTop`, which no transform moves) fixed the
   destination but not the start, still 249 px and 710 px off, as the
   card still moves inside the scaled panel. Both end in the slot,
   because the animation ends at no transform.
3. **A ghost on the body lands exactly.** A fixed element flown from the
   old box to the slot's layout box, the card hidden in its slot until
   it lands, started where the card was (its first frame one 16 ms step
   into the ease) and ended on the slot's settled box to the pixel. The
   panel's growth does not touch it.
4. **Under reduced motion** the page flies nothing (`useFlight` returns),
   so a peek is the panel fading in with the card already in its slot,
   then fading out: read from source; the order needs no flight to read.
5. **A pointer during a peek cannot keep it open today**: the close is a
   `setTimeout` that `App` never cancels (`app.tsx`, the inventory
   port's `show`). Read from source. The peek's close has to check, when
   it fires, whether the panel has since become held open.

The kill criterion did not hold: the card flies at once, as a ghost,
while the panel grows; the panel need not settle first.

**Sources.** `motion.html` is the probe page, `s240.mjs` the Playwright
run (it imports Playwright from `apps/pinetrie/node_modules` and reads
the page from `/tmp/spk/`).
