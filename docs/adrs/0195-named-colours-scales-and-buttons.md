# ADR-0195 — The page's colours are named by role, its sizes come from scales, and every button is a Button

- **Status:** Proposed
- **Area:** `packages/web/TECHNICAL.md`
- **Evidence:** S277, S278

**Context.**

- **A light theme had nothing to redefine.** The page's stylesheet wrote
  530 colours as 109 different hex literals, and named only `--page`,
  `--chrome`, `--edge` and `--on`. `rail.tsx` repeated `--page` in code, and
  `colors.ts` held the twelve track colours.
- **Its sizes had no scale.** It used 25 font sizes, 19 radius values and
  54 different spacing values.
- **Every button started blue.** A global `button {}` rule filled each one
  with the action's blue and white text, and 62 rules undid it with
  `background: none`. 107 raw `<button>`s were spread over 38 files.
- **Naming every near-duplicate cannot reach about 30 names.** Keeping each
  colour within 0.02 in OKLab takes 67 names (S277).

**Decision.**

1. **One `:root` rule names every colour by its role,** and only it writes a
   colour literal:
   - neutrals as two ramps (surfaces darkest first, then lines and text);
   - a hue per meaning (`--accent`, `--agent`, `--attention`, `--danger` …);
   - `--white`, `--ink` and `--shadow`, which are the same on any page;
   - the track colours as `--slot-0` … `--slot-11` and `--slot-pending`.

   That is 33 names, plus the slots. A near-duplicate takes the name of
   its role. A tint is `color-mix()` of its hue and the surface under it,
   never a literal of its own. `stylesheet.test.ts` holds this.
2. **Code names the stylesheet's colours.** `slotColor` returns
   `var(--slot-N)`, and the rail draws its gaps in `var(--page)`.
3. **Sizes come from scales:** eight font sizes, six radii and twelve
   spacing steps. A value stays literal only where another number holds
   it, and a value tied to a padding is a `calc()` of the same step.
4. **Every button is a `Button` or an `IconButton`** (`button.tsx`), with a
   `look` (`primary`, `outline` or `plain`). The looks are drawn under
   `:where()`, with no specificity, so a button's own rules win as they did
   over the global rule. `IconButton` takes a required `label`.
   `button.test.ts` holds this.

**Consequences.**

- A light set is a second definition of the first `:root` rule.
- **What moved:**
  - Every surface within 0.018 in OKLab, and every tint within 0.037.
  - Merged grey text up to 0.053, and one invalid field's 1px border by
    0.093.
  - A padding, margin or gap by at most 0.1rem (usually 0.05rem), and a font
    size by at most 0.8px.
  - Before and after captures of 20 views keep every element.
  - Boxes move by a median of 2px.
- **A column's menu reads in the menus' own `--text-soft`.** A
  `.column-head button { color: inherit }` had dimmed its items to the
  header's grey, because the menu box sits inside the header in the DOM.
- **Each button's padding and radius come from the look's base.** Most of
  its class rules now set only what differs from that base.

**Alternatives rejected.**

- **A name per near-duplicate:** 52 to 67 names. A light theme would still
  have to choose each one.
- **Panda CSS, or another typed token system:** it would rewrite every
  rule and the browser suite's class selectors. The named colours are what
  it would start from, so they come first.
- **A plain base with no padding and inherited text, for every button:**
  39 buttons rely on the global padding, so each would need a rule of its
  own to keep its look (S278).
