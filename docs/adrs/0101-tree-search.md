# ADR-0101 — A search covers the task you are on: opened from the rail, each column shows its own matches over its thread, and the rail lights them

- **Status:** Proposed
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`,
  `packages/web/TECHNICAL.md`
- **Evidence:** S126

**Context.**

- **Nothing finds a word in a thread.** The browser's find sees only what
  is drawn. It cannot see a folded ask's work (ADR-0106), what a density
  hides, or a branch no column has open. The board's search finds tasks by
  their labels only (ADR-0115): a search of every message would hold every
  root (ADR-0063).
- **A task is drawn twice.** The rail draws the shape of its trees (ADR-0116), and each
  column draws one path, past what the columns to its left already draw
  (`projectColumns`). A search over one column's path would never find a
  branch no column has open.
- **The page has no header row** (ADR-0122). A bar shown only while you
  search, which you opened and close, is not one, as the board drawn over
  the columns while open is not: ADR-0122 stands as it is.
- **Showing a message already exists.** `openAt` opens the fold a message is
  in, scrolls whichever column draws it, and opens a column when none does.
  The rail and the inbox use it.

**Decision.**

- **A search is the task's, and opened from the rail.** It covers every
  message on the task's rail. A 🔍 at the rail's
  top, on a task, opens a bar across the stage's top, over the rail and
  the columns. The 🔍 leads the bar, pressed, where it sat. `/` outside a
  text box opens it. It is a view state of one browser tab, never stored,
  and writes nothing.
- **It matches a phrase of whole words.** The query's words, in order,
  separated by any whitespace; case ignored; a word only whole, by Unicode
  letters, digits, marks and `_`. It searches every message's text as a
  reader sees it. Tool calls, tool results and thinking are not searched.
- **An empty field is no search.** The page changes only once there is
  something to look for.
- **Each column shows its own matches over its thread.** A match belongs to
  the column that draws its message, so none is shown twice. The column's
  thread stays as it is, covered and `inert`. Its matches lie over it, in
  path order, which is time order, with a gap line where messages were left
  out. The header counts them. Leaving needs no restoring, since nothing
  under the matches moved (S126).
- **The rail lights the matches.** Items holding one are ringed, and the rest
  is dimmed. The bar counts the matches, and those on branches no column
  has open.
- **Clearing is not closing.** ⌫ in the field clears the query. **done**,
  the pressed 🔍, and Escape from the search close it. Escape always closes.
- **Showing something new leaves the search.** A match row is `openAt`. So
  is a rail pick, an inbox mention, or a reveal after an undo. Any of these,
  or another task, a new tab or the board, closes the search first. A
  message shown is then outlined briefly in its column's colour.
- **A column under a search marks nothing read** (ADR-0077). It is covered,
  so no one is reading it.

**Consequences.**

- The search is pure values in `@pinetrie/interface` (`search.ts`,
  `search-view.ts`, `keyAct`, `leavingSearch`), proven by unit tests. The
  browser proves the wiring: the bar, Escape, the layer, and the outline.
- A column's parts below its header sit in a positioned wrapper. That wrapper
  is now the messages' `offsetParent`, and their offsets from the body hold
  (S126).
- A column following its end keeps following under the layer. Leaving, it is
  at its new end, and "since you were here" marks what came, since nothing
  was read meanwhile.
- A message an `openAt` shows while its fold opens is scrolled to after the
  fold is drawn. Before, an ask's last word, which is drawn while its fold is
  closed, was scrolled to and then pushed down by the fold.

**Alternatives rejected.**

- **A search in each column's header, over that column's path.** It cannot
  find a branch no column has open. This decision is that search with every
  column.
- **A results list in the column's pane** (ADR-0078). It shows matches out
  of the path they belong to, and takes the pane from a review.
- **Filtering the thread in place.** Hiding messages changes the content's
  height under the follow rule, the spots and the rail's outlines, and needs
  restoring on leaving.
- **Unmounting the thread while searching**, and restoring it from its spot
  (ADR-0058). A spot gives up in a closed fold or a short column: coming
  back would be close, not exact.
- **Matches as rail landmarks**, splitting capsules. Each keystroke would
  move capsules and places.
- **Searching tool output.** A match there is inside a tool row the reveal
  does not open, and output would bury the messages.
- **A two-step Escape** (clear, then close). It is easy to fumble, and the
  pane's Escape closes.
- **Taking over Cmd/Ctrl+F.** It would surprise people.
- **A search of every task.** It would hold every root (ADR-0063). The
  board's search (ADR-0115) finds a task by its label; this one finds words
  inside the task you are on.
