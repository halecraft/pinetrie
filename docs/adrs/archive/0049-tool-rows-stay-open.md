# ADR-0049 — A tool row opens, capped, only for work that lasts, and only the reader closes it or shows it whole; the floor is capped

- **Status:** Superseded
- **Area:** `packages/web/TECHNICAL.md`, `docs/06-interface.md`
- **Evidence:** S35, S67
- **Amends:**
  - ADR-0044: when a tool's row opens and closes, and the floor's height.
- **Superseded by:**
  - ADR-0123: restated, with a row's three sizes replaced by its summary and
    its detail.
- **Amended by:**
  - ADR-0051: a row whose result has an image opens capped too, and draws the
    image in place of its text.
  - ADR-0054: a row keeps what it decided across an unmount, and
    `data-revealed` marks a row the work opened.
  - ADR-0058: a column also keeps where it was left, by message, and comes
    back there.

Adopts an alternative ADR-0044 rejected: keeping a finished tool's output
open.

**Context.** ADR-0044 kept a following column from getting shorter while its
agent works: a shrink is taken up by a floor below the content. But a tool's
row still opened and closed with its stream (S35). While it ran, it showed
its whole command and its live output, each capped at 16rem. When the result
came, the row folded to one line, and the column lost up to about 32rem at
once. The floor turned that into blank space until later content filled it,
which in a column 600–700px tall could leave no text on screen.

- **Fast commands flickered.** A 200ms command went closed, open, closed, and
  each time left floor behind.
- **Other shrinks had no bound.** A column opened to the left of a running
  one kept its floor, however tall, until the run ended.
- **↓ new below went missing.** Columns of another root tab are unmounted. A
  tab shown again mounted them with fresh follow state, and the placement
  cleared `unseen`, so a column aligned short of its end had new content
  below it and no button. `useReveal`'s placement cleared it the same way.

**Decision.**
- **A row's size is `closed`, `capped` or `full`** (`rowSize`,
  `packages/client/tool-row.ts`), derived from two facts the row holds:
  whether its call's output has streamed for `REVEAL_MS` (500ms) while drawn,
  and the reader's last choice.
  - A call whose result comes sooner never opens.
  - One that lasts opens `capped`: its command at most 5rem and its output at
    most 10rem, each scrolling.
  - Nothing but the reader closes it. A click on its summary makes a closed
    or capped row `full`, uncapped, and a full row closed. The click is the
    row's own (`preventDefault`): a native toggle would close a capped row.
- **The live output and the result are one element** (`ToolOutput`), which
  follows its end. The result keeps the live output's scroll: at its end, or
  where the reader left it. A closed row draws no output.
- **The floor is at most a third of the column's view** (`FLOOR_MAX`,
  `packages/client/follow.ts`). Past that the column shrinks, and two thirds
  of it still show content.
- **A column keeps what it knew of its end across an unmount** (`SeenEnd`:
  its tip, and whether ↓ new below showed). Mounted again, it starts with ↓
  new below when it has moved on since (`behind`). A placement short of the
  end keeps `unseen`; only one at the end clears it. `App` keeps the
  snapshots by column key for the page's life, unpruned: a closed column's
  key is never used again, except `first-<root>`, which comes back as its
  root's only column, placed at its end, and that clears ↓ new below.
- **A row keeps what it decided across an unmount** (amended by ADR-0054).
  `revealed` and the reader's choice are a `RowMemory`, which `App` keeps
  by call id for the page's life (`screenMemory`,
  `packages/client/screen-memory.ts`), as it keeps `SeenEnd`. A row mounted
  again starts from it. A remembered `revealed` starts no timer, so a
  running command's row is open from its first frame. Before, it mounted
  closed and opened `REVEAL_MS` later, and its column grew and followed as
  if new output had come (S67).

**Consequences.**
- A column no longer shrinks when a command ends. What the floor still takes
  up is the reader folding a row mid-run, and columns opened to the left.
- A row's size is screen state. A column mounted again draws its rows as
  they were left (amended by ADR-0054). A reload draws them closed. A row
  first drawn after its call started, such as one that began while its tab
  was hidden, starts its timer when drawn.
- A result over 20,000 characters (`SHOWN`) ends in its "… more characters"
  line, not the tail the live output showed.
- A full row's output has no cap: a long result makes a long column, since the
  reader asked for it.
- A reload keeps no snapshots, so it shows no ↓ new below.
- The browser suite checks: a fast command's row never opens; a slow one
  stays open where its reader scrolled it; a capped row's height and the
  toggle; a fold mid-run leaves the column no shorter; and ↓ new below after
  a tab switch.

**Alternatives rejected.**
- Keeping other tabs' columns mounted, hidden: every tab's columns would
  render on every change of the document, and a `display: none` column
  reports 0 × 0 to its ResizeObserver, which the follow rule reads as a
  shrink.
- Remembering a tip inside the follow rule: a tree concept in a geometry
  rule, and the `holding` step, which runs before placement, would need a
  special case. The unmount snapshot gives the same answer from what the rule
  already knows.
- Treating any placement short of the end as unseen: the button would mean
  "not at the end", and show on every branch aligned to its fork point.
- A row state machine driven by events from effects watching props: the
  shape the client's notes warn against ("No effect dispatches from document
  facts"), with states that restate the props.
- Scrolling the result to its end in an effect: repeats `useFollow`, and
  ignores a reader who scrolled up in the live output.
- Closing every row when the run ends: still shrinks the column unasked.
- Delaying the close instead of the open: a fast command still flashes open.
- Removing the floor: a fold mid-run, or a column opened to the left, would
  slide a following column again.
- Never opening a live row: loses watching a long command, which ADR-0022
  and ADR-0044 kept.
