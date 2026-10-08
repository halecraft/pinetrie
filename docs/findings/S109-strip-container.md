# S109 — `#strip` can be a size container: `100cqw` is its client width, and a fixed popover inside it still places against the window

- **Status:** Answered
- **Led to:** ADR-0087

**Question.** ADR-0087 sizes the pane against the strip with container
query units. Containment level 3 once had `container-type: inline-size`
apply layout containment. If it still did, `#strip` would become the
containing block of every `position: fixed` box inside it, and the menus
in columns, which are fixed so that no scrolling list clips them
(`packages/client/TECHNICAL.md`, Gotchas), would be placed against the
strip and clipped by it. Does a fixed box inside a container stay placed
against the window? And what width does `100cqw` read in a container that
scrolls sideways?

**Kill criterion.** If a fixed box inside `#strip` moves with the strip,
the pane's width must come from a measured custom property instead.

**Throw away.** A one-page probe driven by Playwright 1.56's Chromium 141,
run from `/tmp` and deleted after.

**Answers.**

1. **A fixed box is not contained.** In a 1280 × 720 page with a 240px
   sidebar beside a `display: flex; overflow-x: auto` strip, a
   `position: fixed; left: 10px` box nested in the strip measured
   `left: 10` with `container-type: inline-size` on the strip and without
   it. Chromium applies no layout containment for `container-type`; the
   current spec asks only for style and size containment.
2. **`100cqw` is the strip's client width.** With the strip 1040px wide, a
   `flex: 0 0 auto` box of `clamp(400px, 100cqw - 448px, 1024px)` measured
   592px, which is 1040 − 448.
3. **The pane must not shrink.** Without `flex: 0 0 auto` the same box
   measured 611.8px against a 640px minimum. `.pane` already has it.

Measured in Chromium only, which the browser suite runs. Safari has
supported container units since 16.
