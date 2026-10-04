# ADR-0081 — The tab bar is the header, and the tab you are on is the page

**Status:** Accepted (Duane, 2026-10-04). Implemented by
`PLAN-2026-10-04-tabs-header`. Amends ADR-0029 (where the tab bar sits,
and how the tab you are on is drawn) and ADR-0030 (the header holds your
tabs; the message count moves to the Archive tab).

**Context.** Duane could not tell which tab was selected, nor that the
columns belonged to it:

- **Every tab looked alike.** Each had a fill, a border and a ×. The tab you
  were on was `#23272e` against the others' `#1b1e24`, about 3% brighter,
  and its visible ⋯ was the only real cue.
- **The tab you were on looked raised, not attached.** It was lighter than
  the page it headed (`#14161a`), and the bar's bottom border ran under it.
- **The column stripes paired with the wrong tabs.** Each column head's 4px
  stripe in its track colour (ADR-0040) sat under the bar, the strongest
  colour on screen, below whichever tabs happened to be above it.
- **The root's title showed only in its tab,** cut at 16rem, though it is
  the cue a person reads when switching context. The window's title was
  "(n) Pineta".
- **The header spent a row on little:** "PINETA", "messages M of N" and
  "connected".

**Decision.**

- **The tabs are the header.** One row holds the tabs on the left, scrolling
  as before, and the session's indicators (people, activity, project,
  inventory, you) at its right end. "PINETA", the count and "connected"
  leave it. "syncing…" shows among the indicators only while the document
  is pending. Too narrow for both on one row (below 56rem), the indicators
  go on a row above the tabs.
- **The tab you are on and the page are one surface.** The bar is a darker
  shade (chrome) than the page. The tab you are on has the page's colour,
  a neutral light top edge, and its label bright and bold, and the bar's
  bottom line breaks under it, so it opens into the page.
- **The other tabs are quiet, not dim.** They have no fill and no visible
  border at rest, and keep their label colour. Their ⋯ and × show on hover
  or focus, over the label's end.
- **The accent is neutral.** Colour already means a branch (track),
  something that needs you (amber) and yours (your pip). Track 0 is always
  blue, so a blue tab would read as the trunk.
- **The tab you are on shows its title, up to 32rem,** and scrolls into
  view as you choose it. The other tabs shrink to a floor before the list
  scrolls.
- **The window's title names the tab you are on:** "(2) Fix the sync bug ·
  Pineta", the count left out at zero.
- **The message count moves to the Archive tab:** its tooltip, and a line
  in its list. Archive is the whole session's view, and the count is the
  session's.

**Consequences.**

- One row less above the columns.
- `#top` holds `#tabs`. A selector under `#top` can now match a tab's
  readers' avatars.
- A tab's × is hidden at rest, like its ⋯: a browser check clicks it on the
  tab you are on, or hovers first.
- A ring around a dot is drawn in the colour behind it (`--surface`), since
  tabs at rest now sit on the chrome, not the page.

**Alternatives rejected.**

- **A header row of its own, holding the root's title.** It gives the title
  weight but sits above the tabs, so it does nothing for containment, and
  keeps the row.
- **A title band between the tabs and the columns.** It ties the title to
  the columns at the cost of a row; the joined tab does that for none.
- **Colouring the tab you are on** (track blue, or your colour): see the
  neutral accent above.
- **Dimming the other tabs' labels.** Their labels are how you find a tab,
  and were already muted. Removing their fill and border gives the
  contrast instead.
- **Restyling the column stripes (ADR-0040).** Once the tab and the page are
  one surface, the stripes read as inside it.
- **The count in the profile menu, or on the indicators.** The count is
  about the whole session, and Archive is where the whole session is shown.
