# S277 — 33 names hold the page's 109 colours, and every surface moves by at most 0.018

- **Status:** Answered
- **Led to:** ADR-0195

**Question.** Can the page stylesheet's colour literals be replaced by about
30 named colours, and its font sizes, radii and spacing by scales, with no
visible change? How far does each value move?

**Kill criterion.** Some surface (a background a person sees as an area)
moves by more than 0.02 in OKLab (about one just-noticeable difference), or
more than 40 names are needed to stay under it.

**Throw away.** The mapping script and the capture harness (`sandbox/theme/`,
never committed).

## Answers

**The literals.** The `<style>` in `packages/web/index.html` writes 530
colours as 109 different hex values, plus 7 `rgb()`s: six shadows and one
keyframe's amber. Clustered greedily by use count, they need 67 names to keep
every value within 0.02, and 52 within 0.03. Naming every near-duplicate
cannot reach 30.

**What does.** There are three kinds of colour:
- **Neutrals** fall on two ramps.
  - Surfaces, darkest first: `chrome`, `sunk`, `page`, `panel`, `raised`,
    `edge`.
  - Lines: `line`, `line-strong`, `line-hover`.
  - Text: `text-bright`, `text`, `text-soft`, `text-dim`, `text-muted`,
    `text-faint`, `text-quiet`.
- **Hues name a role:** `accent`, `agent`, `queued`, `action`, `attention`,
  `caution`, `inventory`, `highlight`, `pinned`, `command`, `danger`,
  `danger-soft`, `ok`, `ok-soft`.
- **Fixed colours** read the same on any theme: `white` (text on a filled
  button, the image checker), `ink` (text on a bright fill) and `shadow`.

That is 33 names. Every tint (a dark blue band, an amber fill, a green
approve button, a hue's line) is
`color-mix(in srgb, var(--hue) p%, var(--page))`. A tint written that way
lands within 0.037 of its literal, with most under 0.02, and it follows the
hue and the page into another theme.

Measured by OKLab distance, literal to replacement:

| moves | literals | uses |
|---|---|---|
| 0 (exact) | 33 | 369 |
| under 0.015 | 43 | 84 |
| 0.015 to 0.03 | 18 | 35 |
| 0.03 to 0.04 | 11 | 33 |
| over 0.04 | 6 | 9 |

A literal that takes two roles counts once per role (`#fff` is `white` on
a filled button and `text-bright` on the search bar), so the rows add to 111.

- **Every surface stays within 0.018.** The largest moves are
  `#1d222b` → `raised` (0.018, a search match row) and `#16181d` → `panel`
  (0.012, the pinned strip).
- **Over 0.04:**
  - `#d66` → `danger` (0.093), the 1px border of a name field that refuses
    its value.
  - `#9aa3b5` → `text-muted` (0.053), the search bar's count.
  - `#e0a080` → `caution` (0.050), an ask's outcome line.
  - `#d29922` → `caution` (0.045), the review's widening note.
  - `#e0b15c` → `attention` (0.044), the setup page's warnings.
  - `#555` → `line-hover` (0.043), a margin's rule and the canvas end's drop
    line.
- **The most used merge** is `#aaa` → `text-muted` (0.038, 11 uses), a
  column header's grey.

**Sizes.**
- **Fonts:** 25 sizes become 8 (`.65`, `.72`, `.75`, `.8`, `.85`, `.9`, `1`
  and `1.1rem`). `.78rem` → `.75`, `.7` → `.72`, `.6`/`.68` → `.65` and
  `11px` → `.72rem`, so text moves by at most 0.8px. `.85em` (inline chips)
  and an avatar's initial (sized in px to its circle) stay as they are.
- **Radii:** 2, 3, 4, 6 and 8px and a pill. A `.6rem` and a `1rem` radius were
  already pills at their heights, so nothing changes there, and `1px` → `2px`
  on a 2px tick draws the same. `50%` and the rail's 7px and 9px (half a
  width they are tied to) stay.
- **Spacing:** 54 values become 12 steps (`.1`, `.2`, `.25`, `.3`, `.4`,
  `.5`, `.6`, `.75`, `1`, `1.25`, `1.5`, `2rem`). `.05`, `.15`, `.35`,
  `.45`, `.55`, `.7` and `.8` move by 0.05rem (0.8px). `.9`, `1.1`, `1.4` and
  `1.6` move by 0.1rem. Some values stay literal because another number holds
  them: the column's 1.75rem gutter (its `→` button sits in it), the search
  field's 1.8rem room for its clear button, and the ask's 4.5rem room for its
  files button.
- **Coupled values** must move with a padding they match. The board head's
  sticky `top` and `min-height` follow its `.35rem` padding. A renamed
  title's `-.4rem` margin follows its padding. The diff's hanging indent
  follows its `.75rem` padding. A menu item's `1.6rem` indent is its padding
  plus the 1.1rem check column.

**The capture.** A host with a scripted model and a SQLite store makes a
session once. Each capture copies that store and opens it on a fixed port,
so the page's saved tabs apply, with the browser's clock fixed. It takes 20
views: the canvas, a message's tools, the column, account, add and inbox
menus, a thread's details, the board, the inventory, a search, the
profile, setup and identity pages, the sidebar folded, the composer focused
and with its command list, a queued card, each density, and a narrow window.
Each view is a screenshot and every element's computed colours, borders,
paddings, margins, font sizes, radii and box. Two captures of the unchanged
page match in every pixel and every value, apart from the setup page's
temporary paths.
