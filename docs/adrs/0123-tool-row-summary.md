# ADR-0123 — A tool row is its summary or its detail, and only the reader toggles it; the floor is capped

- **Status:** Accepted (Duane, 2026-10-09)
- **Area:** `packages/web/TECHNICAL.md`, `docs/06-interface.md`
- **Evidence:** S142, S35, S67
- **Supersedes:**
  - ADR-0049: restated, with a row's three sizes replaced by its summary and
    its detail.
- **Amends:**
  - ADR-0051: an image a tool read is drawn in its row's summary, as a
    thumbnail when it is tall; no row opens for it.
  - ADR-0054: `revealed` only marks a running row for its ring; it opens
    nothing.
- **Amended by:**
  - ADR-0173: in story, a tool row with an intent leads with it, and its
    command is in its detail.
  - ADR-0204: a row's output is shown under the statement that wrote it, when
    its bytes are attributed; undivided otherwise.

Restates what ADR-0049 decided of the floor and of a column's and a row's
memory across an unmount, which stand. What changes is how much of a row
shows.

**Context.** ADR-0049 gave a tool row three sizes: `closed`, one line;
`capped`, opened by the work, its command and output each scrolling in a
box; and `full`, opened by the reader. The disclosure arrow had two
states for three sizes: ▼ marked both capped and full, and a click on a
capped row's ▼ showed it whole instead of folding it. The pending mark,
"…", sat under the command and read as "more lines". The whole summary was
the click target, so its command could not be selected. And a row stopped
1rem short of its running ring, in the gutter the column keeps for →.

**Decision.**
- **A row is its summary or its detail** (`rowView`,
  `packages/interface/tool-row.ts`). Every row starts in its summary, fast
  or slow, running or done; only the reader opens its detail, and closes
  it.
  - The summary shows the command's first 5 lines and the output's last 5
    (`SUMMARY_LINES`), as written: a command keeps its layout and its
    colours, cut after the layout. A line over `LINE_LENGTH` (160)
    characters is cut with "…". An image is drawn in the output's place,
    10rem tall at most.
  - The detail shows both whole and uncapped. An output over 20,000
    characters keeps its end, after a line counting what it left out.
- **One toggle, in words, at the row's foot** (`.tool-more`). It names what
  the summary hides ("+3 lines · +335 lines of output", "full size"), and
  "less" in the detail. A row that hides nothing has none. The command and
  the output are text to select; only the toggle toggles.
- **The tag and the status sit together at the row's top right.** A
  running call has no mark: its ring and its live lines say it runs.
- **The row takes the column's width.** It reaches 1rem into the right
  gutter, as far from the column's right edge as from its left, and its
  ring is 4px clear of it on every side.
- **A row keeps what it decided across an unmount** (`RowMemory`:
  `revealed`, and whether its detail is open), kept by call id in `App`
  for the page's life (`screenMemory`). A row mounted again starts from it.
  A remembered `revealed` starts no timer, so a running command's row on a
  tab shown again has its ring from its first frame.
- **The floor is at most a third of the column's view** (`FLOOR_MAX`,
  `packages/interface/follow.ts`), as ADR-0049 decided. Past that the
  column shrinks, and two thirds of it still show content.
- **A column keeps what it knew of its end across an unmount** (`SeenEnd`:
  its tip, and whether ↓ new below showed), as ADR-0049 decided. Mounted
  again, it starts with ↓ new below when it has moved on since. A placement
  short of the end keeps `unseen`; only one at the end clears it.

**Consequences.**
- A row's height does not change at the handover from a call's live
  output to its result: both show their last five lines, and pi's result
  is the live text with at most a status line after it (S142). Nothing
  opens or closes on its own, so a fast command and a slow one draw the
  same row. A column following its end still never gets shorter while its
  agent works (S35).
- In raw density, a finished row is up to twelve lines, not one.
- Neither the summary nor the detail scrolls inside the row, so the
  result no longer keeps a scroll position the reader left in the live
  output.
- A row's detail is screen state, as its size was: a reload draws every
  row in its summary.
- The copy fallback, which selects what a message draws, selects a row's
  summary; the copy button's own text is the call's whole command and
  result, as before.
- `LAYOUT_WIDTH` is 55: the command has the row's whole width, and only
  its first line runs beside the tag.

**Alternatives rejected.**
- **Three sizes with a third glyph:** the reader must still learn three
  states, and a capped row's click still does not do what its arrow says.
- **A summary with no output, or one live line:** the outcome, an error or
  a test tally, is in the last lines. Showing output only while running
  brings back the shrink at a run's end that ADR-0049 removed.
- **The output's first five lines:** they jump when the result replaces
  the live tail, and pi's status line comes at the end.
- **Cutting by lines on screen** (`line-clamp`): it cannot count what it
  hides for the toggle's words, and only a browser can test it.
- **A native `<details>` with the command in its `<summary>`:** the whole
  summary is the click target, so the command cannot be selected, and
  `toggle` fires for React's own `open` too.
- **A narrower gutter for every message:** → needs it, and every
  message's text would change width.
- **Amending ADR-0049:** it had three amendments, the limit
  (`docs/adrs/README.md`).
