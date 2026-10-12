# S167 — A column header's name, turned 90° clockwise, lands exactly on the folded strip's name when both are set at the same size

- **Status:** Answered
- **Led to:** ADR-0137

**Question.** Folding a column would turn its name (the thread's name in
`.column-head .agent-name`, the task's title in `.task-column-title`) 90°
clockwise into the folded strip's name (`.folded-name`, set
`writing-mode: vertical-rl`), and unfolding would turn it back. A real
animation knows only the two elements' boxes. Does turning the header's
name about its box's top-left corner, then moving that box so its right
edge is on the strip name's right edge and its top on its top, put every
glyph where the strip draws it? Or do the baselines of horizontal and
vertical text differ, so that it needs offsets of its own?

**Kill criterion.** If, with both names at the same font, a glyph lands
more than 1 px from where the strip draws it, the plan cannot work from the
boxes alone: it must measure glyphs, or cross-fade the two names at the end.

**Throw away.** The probe: a script that opens pine·trie's page, copies
the header's name into a fixed element, folds the column, turns the copy
by CSS onto the strip, and compares each glyph's box with the strip's.

**Answers.**

1. **At the same size it lands exactly.** With `.folded-name` at the
   header's size (0.85rem for a thread, the task title's 14.4 px for the
   task column), the two boxes are each other turned (66.78 × 21.08 and
   21.06 × 66.78 px), every glyph's advance is the same (6.07 px), and the
   box formula puts every glyph's centre on the strip's: 0.00 px off, in
   both axes, for the thread column and the task column alike. No offset
   is needed: horizontal and `vertical-rl` text sit in their line boxes
   the same way, turned.
2. **At today's sizes it does not.** The strip's name is 0.8rem against
   the header's 0.85rem (a thread) or 0.9rem (the task), so it is shorter:
   the glyphs land up to 3.7 px (thread) and 5.5 px (task) off, and no
   single correction fixes it (still 1.9 and 2.7 px). The name would
   shrink at the end of a fold. So the strip's name takes the header's
   size; the 2.2rem strip holds a 21–22 px line.
3. **What is turned is the name alone.** The box that lands is the name's
   own line box, not the button around it: in the header that button holds
   the thread's mark and the ▸ chevron (`::after`) too. The header's name
   needs an element of its own, which the animation measures and turns;
   the mark moves on its own path and the chevron fades.

**How it was measured.** `docs/findings/S167-fold-turn-lands/probe.ts`
starts a suite host, adds an agent from the sidebar (which names its
thread), and in Chromium's headless shell at 1920 × 1080 reads the box of
each glyph of the header's name (`Range` per character), copies the name
into a fixed `span` whose glyphs sit where the original's do, folds the
column from its ⋯, and turns the copy with `transform-origin: 0 0;
transform: translate(…) rotate(90deg)` by the formula above. It reads the
turned copy's glyph boxes back and compares them with `.folded-name`'s, as
the page draws it now and with a style setting the strip's name to the
header's size; then the same for the task column's title. The figures are
in `docs/findings/S167-fold-turn-lands/runs.txt`; the two shots
(`thread-same-size.png`, `thread-sizes-now.png`) lay the turned copy, in
red, over the strip.

**Limits.** One font stack (the page's `ui-sans-serif, system-ui, sans-serif`, which
falls back in the container to WenQuanYi Zen Hei); the Mac's San Francisco is not measured, but
the result rests on the same element being drawn at the same size in both
writing modes, not on the font. Names here are two short words; a name
longer than the strip's `max-height: 60vh` is cut with an ellipsis there
and not in the header, which this does not measure.
