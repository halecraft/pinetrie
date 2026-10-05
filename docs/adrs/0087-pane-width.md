# ADR-0087 — A column's pane fills the strip's free width, and a review can wrap its lines and fold its file list

**Status:** Proposed. Evidence: S109. Implementation:
`PLAN-2026-10-05-pane-fits-strip`. Amends ADR-0078 (the pane's width and the narrow
line come from the strip, not the window) and ADR-0047 (a review wraps
long lines and folds its file list on request).

**Context.**

- **The pane is sized against the window.** ADR-0078 gave `.pane`
  `clamp(40rem, 100vw - 36rem, 64rem)` and covered the page below 76rem
  (`NARROW_REM`, `packages/client/pane.ts`). The 36rem was the rail and a
  28rem thread back when the workspace filled the window. ADR-0085 then put
  your list to its left (`--side`, 15rem, or 11.5rem below 56rem), and
  neither number changed. At 1280 pixels (80rem) the strip is about 62rem
  wide. The thread and a 44rem pane need 72rem, so the pane's right 10rem
  lies past the strip's edge, and you scroll the strip to read it. Between
  76rem and about 91rem, the pane opens beside a thread it no longer fits
  next to.
- **The list's width is about to vary.** ADR-0088 lets it fold to icons, so
  no fixed margin can be right, and a media query reads the window, not
  the strip.
- **Nothing measured the pane against the strip.** The browser check in
  `apps/pinetrie/e2e/browser/images.scenario.ts` proves only that the pane
  opens beside the thread and that the thread keeps its 28rem.
- **A diff line longer than the pane scrolls sideways**, file by file
  (`.review-diff`, `white-space: pre`). A review of more than one file also
  gives 12rem of the pane to its file list.

**Decision.**

- **The pane takes the strip's free width.** `#strip` is an inline-size
  container. `.pane` is `clamp(40rem, 100cqw - 28rem - borders, 64rem)`,
  so its only margin is the thread's 28rem and the column's borders. The
  rail and your list are outside the container, at whatever width they have.
- **"Narrow" belongs to the strip, not the window.** The pane covers the
  page when the strip is narrower than the thread plus the pane at its
  narrowest (68rem, plus borders). A `ResizeObserver` on `#strip` measures
  it. The rule is a pure function of the strip's width and the rem, in
  `pane.ts`, and it replaces the `NARROW` media query and `NARROW_REM`.
  Folding your list to icons can bring a covering pane back beside the
  thread, and unfolding it can send the pane back over the page. Like a
  window resize under ADR-0078, the pane then starts again at its top.
- **One browser check proves it, and it is not a new check.**
  `images.scenario.ts`'s check that the image opens beside the thread also
  measures that the pane's right edge is within `#strip`, once with the
  list full and once with it as icons. Its mutation puts back
  `100vw - 36rem`.
- **A review can wrap its long lines.** A control in the review's head
  switches wrapping on and off. A wrapped line's continuation is indented
  under the line's text, so the `+`/`−` column stays clear. Wrapping
  applies to every review, the offer's and an ask's, in every column. It is
  off at first and kept per device (`localStorage`).
- **A review's file list folds away.** A control in the review's head
  folds the list, giving the diffs the pane's whole width. It is kept per
  device beside wrapping. A review of one file has no list, as before.

**Consequences.**

- On a window wide enough for both, the pane opens wholly in view at
  every width of your list, and the strip scrolls only when there are more
  columns.
- With the full list, the pane fits beside the thread from about 86rem
  (1,380 pixels) of window: the list's 15rem, the rail's 3rem, the thread's
  28rem and the pane's 40rem. A 1280-pixel window, which had the pane beside
  the thread and cut off, now has it over the page, or beside the thread
  once the list is folded. The browser suite's pages that open a pane are
  1440 pixels wide.
- `docs/06-interface.md` loses "under 76rem". The narrow line moves with
  your list's width. `pane.test.ts`, which held `NARROW_REM` to the CSS,
  holds the new margin to it instead.
- Wrapping and the folded list are your reader's settings, not the pane's
  subject. ADR-0078's rule that nothing in the pane is kept still applies
  to what the pane shows.
- Side-by-side diffs could come later, at the pane's widest. This ADR does
  not decide them.

**Alternatives rejected.**

- **Adding the list's width to the margin**
  (`100vw - var(--side) - 36rem`). The CSS would be right, but a media
  query can't read `--side`, so the narrow line would need its own copy
  for each width of the list (15rem, 11.5rem, icons).
- **A drag handle on the pane's edge.** It is a stored width to keep for
  every device, and filling the free width already covers what it is for.
- **Wrapping on by default.** A diff reads in its own lines, and wrapping
  hides indentation. Long lines are the exception.
- **Folding your list by itself when the pane opens.** See ADR-0088.
