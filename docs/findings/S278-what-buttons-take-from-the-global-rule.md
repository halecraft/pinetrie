# S278 — Buttons take the global rule's padding and radius, and a zero-specificity base keeps them

- **Status:** Answered
- **Led to:** ADR-0195

**Question.** What does each of the page's buttons take from the global
`button {}` rule in `packages/web/index.html`? Can a component's base
replace that rule with no rule of a button's own losing to it?

**Kill criterion.** The base has to beat some class rule to draw a button as
it is drawn now, so moving buttons onto a component changes their look.

**Throw away.** The audit script (`sandbox/theme/audit.py`).

## Answers

**The global rule** sets `padding: .5rem .9rem`, `border-radius: 6px`,
`border: 0`, `background: #2f6feb`, `color: #fff`, `font: inherit` and
`cursor: pointer`. Its specificity is (0,0,1), so every class rule beats
it.

**What buttons rely on.** The page has 107 `<button>`s in 38 files. For each
class a button carries, the audit read the rules that end in that class:

| the button's own rules set no | buttons |
|---|---|
| border-radius | 76 |
| border | 51 |
| background (so they are blue) | 45 |
| padding | 39 |
| color (so their text is white) | 37 |
| any of these | 27 |

The audit leaves out rules that reach a button by context (`.tools button`,
`.menu button`, `.column-head button`, `.card-head-acts button`,
`.work button`). Those set background, colour and padding for most of the
buttons the table counts as blue or white. The 27 with no rule of their own
are the page's real primary buttons: send, put, the identity form's submit,
profile save, the conflict and history choices, and the proposal's
actions. 62 rules undo the fill with `background: none`.

**A base with no specificity.** `:where(button[data-look])` has
specificity (0,0,0). A base rule under it, holding the global rule's
padding, radius, border, font and cursor, still loses to every class rule,
as the global rule did. Its looks (`:where([data-look="primary"])` and the
others) also lose. So a button moved onto the component keeps the old
padding and radius where nothing of its own sets them, and every rule that
set them still wins. Only the fill and the text colour change:
- `primary` keeps the blue and the white.
- `plain` is clear, and its text inherits its parent's colour.
- `outline` is clear, with a 1px `--line-strong` border.

A `plain` button that relied on the white text is the one case that changes.
The capture (S277) finds every such button among the views it draws.
