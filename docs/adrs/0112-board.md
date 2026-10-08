# ADR-0112 — Your open roots run down the left; a board in the footer shows where everyone's work stands

- **Status:** Accepted
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`
- **Evidence:** S69
- **Supersedes:**
  - ADR-0085: restated whole, with what ADR-0088, ADR-0091 and ADR-0098
    changed in it folded in.
- **Amended by:**
  - ADR-0111: a board item is a thread card; a text card put on a board state
    becomes a conversation root there, which the undo key lifts back into the
    card while the root holds only that message; "your list" is the sidebar,
    which shows your open threads.
  - ADR-0113: a note dropped on a workflow state in the footer's strip, or in
    the sidebar, becomes a new thread; a held queue is not work, so it draws
    no ring.

Restates ADR-0085 as amended by ADR-0088, ADR-0091 and ADR-0098; decides
nothing new. ADR-0085's changes to ADR-0027, ADR-0029, ADR-0030, ADR-0063,
ADR-0077, ADR-0080 and ADR-0081 stand as ADR-0085 made them. Only what
those three ADRs changed in ADR-0085 is folded in here: how your list
folds is ADR-0088's, the inbox's sections ADR-0091's, and the account menu
and pages ADR-0098's.

**Context.**

- **A tab was doing two jobs.** It was the person's view (ADR-0030: closing
  one writes nothing, and the order is yours) and a sign of shared work (a
  ring while the agent runs, readers' avatars, the amber mark). Only the
  first is the person's. Nothing showed where the whole team's work stood.
- **The Archive tab was a board with one column.** It listed every root with
  one shared state, open or archived. Archived is a shared "done"
  (ADR-0029): read-only, refused while the agent works, and unloaded by the
  host (ADR-0063). The tab sat at the left of a bar of personal tabs,
  although it was the one shared view.
- **A collaborator's new root reached you only through the header.**
  ADR-0030 made the bar yours, so another person's root showed only as an
  avatar or a mention, and the Archive tab was the only list of everything.
- **A horizontal bar has no top and bottom.** Tabs kept the order you opened
  them in, and long titles were cut at 32rem on the tab you are on and much
  shorter elsewhere (ADR-0081).
- **ADR-0081 removed a header row** that held only "PINETRIE" and counts.
  Every row of chrome has to earn its height, and columns are tall reading
  surfaces.
- **"Lane", "column", "track", "card" and "tab" are taken.** A board's
  divisions need a word of their own.
- **Narrow screens** need the list and the footer's corner to give up
  width: 15rem of list is most of a phone, and decides whether a column's
  pane (ADR-0087) sits beside the thread or covers it (ADR-0088).
- **The activity menu sat on everyone's side of the footer** yet counted
  only what is yours, and listed runs and offers the board could show
  (ADR-0091).

**Decision.**

*Two views: yours down the left, everyone's in the footer.*

- **Your list** runs down the left edge: the roots you have open, in an
  order you choose, top to bottom, as your own priorities. It replaces the
  tab bar. "Tab" leaves the interface and the docs, except where it means a
  browser tab (`tab-state.ts`).
- **The board** is everyone's: every root, in the workflow state it is in.
  It replaces the Archive tab. It is drawn as a strip in the footer, and
  slides up over the columns when opened.
- **The footer splits where the sidebar does.** Below your list, at its
  width, is what is yours: the corner (below). To the right of that line is
  what is everyone's: ▦ **Board**, then each workflow state's name and
  count, then the publish button (ADR-0090) and "syncing…" while pending.
- **There is no header row.** The columns, their heads and their pinned
  cards start at the top of the window.

*Your list.*

- **It is kept per person**, in a person document of its own (`open:`,
  beside `inventory:` and `attention:`, ADR-0059, ADR-0077): only your tabs
  write it, the host stores it and shares it with you alone, and it is the
  same on every device of yours.
- **Opening a root adds it at the bottom.** You open a root from the board,
  your inbox, a mention or a link. A root you start opens at the bottom
  too. Nothing opens a root in your list by itself (principle 6 of
  `docs/06-interface.md`): a root someone else starts appears on the board.
- **Dragging reorders it**, and so does a keyboard move in an item's `⋯`.
- **× closes a root for you** and writes nothing shared, as a tab's × did
  (ADR-0030). Its columns stay kept, so opening it again brings them back.
- **Which root you are on, and each root's columns, stay as they are**:
  per browser tab, with the device's latest as a fallback (ADR-0027). Only
  the list moves to the person.
- **ADR-0081's surface rule turns sideways.** The list is chrome. The root
  you are on is the page's colour, with a neutral light edge on its left,
  and the list's right edge line breaks beside it, so it opens into the
  rail and columns. The other items have no fill or border at rest and keep
  their label colour. A title wraps to two lines before it is cut.
- **`⋯` and × show only on hover or focus**, on every item, the one you are
  on included.
- **An item keeps a tab's signals** (ADR-0077): the blue ring while the
  agent works there, amber when something needs you or is worth a read,
  the ✓ that fades, readers' avatars, and your pip for unsent text. The
  agent's work is read in every root, from every running lane as well as
  the lanes this tab holds, so a root's ring, in your list and on the
  board, and the closed state's refusal while the agent works read the
  same facts.
- **＋ agent, with conversation in its menu**, sits at the bottom of the
  list. What each starts is ADR-0021's.
- **The window's title names the root you are on**, as ADR-0081 has it.

*Your list, folded.*

- **The list is full, or icons**, about 3rem wide, the rail's `min-width`.
  A control at its foot switches between them, and so does Ctrl+Shift+L.
  The choice is view state, per browser tab, with the device's latest as a
  new tab's fallback. With no choice stored, the list shows icons below
  56rem and is full otherwise. It never folds by itself.
- **An item's icon** is the sprite of its root's earliest thread that has
  one (ADR-0053), else a tile in the root's colour (ADR-0089) with two
  initials. Its signals stay on it: the ring around it, the amber or dim
  dot and the fading ✓ on its top-right corner, your pip on its
  bottom-right. Hover and focus show its label and who is reading there.
  The root you are on is drawn as in the full list.
- **⋯ and × become one menu**, opened by a right-click, Shift+F10 or the
  Menu key: ⋯'s items, then Close. Rename opens its field in a popover
  beside the icon. ＋ agent becomes ＋, with its ▾ menu.

*The corner.*

- **With your list full, the corner is you**, then your inbox and your
  inventory. You are your avatar and your name, as one button that opens
  the account menu (ADR-0098). The inbox (ADR-0091) and the inventory
  (ADR-0048) are icon buttons of one style, the inbox with its amber badge,
  the inventory with a muted count.
- **With your list folded, the corner is only your avatar**, carrying the
  inbox's badge; the account menu then holds the inbox and the inventory.

*The board.*

- **Its columns are the session's workflow states, in order.** A root is in
  exactly one. A new session has three: **Backlog**, **Doing** and
  **Done**.
- **Anyone can edit the states**: add one, rename it, reorder it, remove it.
  Removing a state that holds a root is refused until it is empty.
- **One state is closed, and it is always there and always last.** It is
  named Done in a new session, and can be renamed but not removed or
  moved. A root in it is archived, with every rule ADR-0029, ADR-0061 and
  ADR-0063 give archiving: read-only until it leaves, refused while the
  agent works there or cards are queued, withdrawn offers, unloaded by the
  host. Moving a root out of it restores the root. There is one closed
  state; finer kinds of done wait for tags.
- **Anyone can move a root**, between states and within one, by dragging
  it or from its `⋯` ("Move to ▸", Move up, Move down), so the keyboard
  reaches every move. Nothing moves a root by itself: an offer that is
  ready, or a run that needs you, shows as a mark on the root, never as a
  move.
- **Where a new root lands:** ＋ in your list puts it at the end of the
  first open state; ＋ on a board column puts it at the end of that state.
  Each ＋ is the same split button: ＋ agent, or conversation.
- **A backlog item is a conversation root.** An idea not yet started is a
  root with no agent (ADR-0021): its first message is the idea, people
  discuss it below, and starting the work is asking `@agent` in it. The
  board holds one kind of item, and no new storage is needed for ideas.
- **An item on the board shows** the root's label (its title, ADR-0045,
  ADR-0074), the same signals as in your list, **⇡** for everyone when a
  thread of it has an open offer (its title names the threads; not amber,
  since it asks nothing), who is reading there (presence, ADR-0024), and
  who has written in it.
- **Selecting an item opens the root in your list and shows it.** A closed
  root opens read-only, with **Restore** in its composer's place, as the
  Archive tab's preview did; it leaves your list when you switch away
  unless you restore it.
- **The closed state is drawn collapsed:** its count, a search over labels
  (ADR-0063's rule: labels, not every message), and its most recent roots.
  The filters the Archive tab had ("mine": roots you wrote in) are on that
  search.
- **The strip summarises the board while it is closed**: each state's name
  and count, avatars of the people in its roots, an amber dot when a root
  there needs you, and counts of its roots where the agent works (`◌n`) and
  of those with work ready (`⇡n`), each only when there are any. ▦ carries
  the highest mark of the roots not in your list, as the Archive tab did
  (ADR-0077). Its tooltip carries the message count ADR-0081 gave the
  Archive tab. Nothing on the right of the footer has a badge or animates:
  the inbox carries the page's only badge.
- **The board opens over the columns** and does not move them. ▦ or Esc
  closes it, and so does choosing a root or a new tab to work in, which it
  lay over. Whether it is open is view state, kept per browser tab; with
  nothing in your list and nothing shown, it opens by itself.
- **The header's people go.** Who is where shows on your list's items, on
  the board's items, and in the strip.

*Records and commands.*

- **The workflow is one session record**, host-written (ADR-0062): the open
  states in order, each with a stable id and a name, and the closed state's
  name.
- **A root's place on the board is a session record keyed by its
  `RootId`**: its state, its rank within the state (a field per root, as a
  queue's order is a field per card, S69), who moved it last, and when. It
  replaces `pinetrie.archive`: a root is archived when its state is the
  closed one, and the archive record and its readers go.
- **Clients edit states and move roots with commands over the Line**, which
  the host's serial executor orders. A move names the state the mover saw
  the root in; if the root has moved since, the host refuses and says where
  it is ("not moved: Bea moved it to Doing first"), as a card's handoff
  does (ADR-0059).
- **A starting host carried a store over once**: it wrote the three
  default states, put every archived root in Done and every other root in
  Doing, and dropped the archive records. The carry-over code was deleted
  once it had run, as ADR-0066's was.

**Consequences.**

- With the default states, ＋ agent in your list starts work in Backlog. A
  team that starts most work with the agent moves it to Doing, or removes
  Backlog.
- The full list costs width: about 15rem beside the rail and 28rem
  columns, 11.5rem below 56rem. At 1440 pixels two columns fit with room to
  spare; at 860, one and part of another. Folded, the list and the rail
  are two narrow strips side by side.
- A board move by someone else leaves no trace on your screen yet, and Cmd+Z
  does not reach it: a move is reversed by moving back. ADR-0048's traces
  and ADR-0066's host undo could cover board moves later.
- Someone else's offer is found by scanning the board for ⇡. Choosing the
  item opens its root, not the thread with the offer; the thread's
  followers have a row in their inbox that opens the thread.
- A run in a root you do not hold shows only as a ring on the board and a
  count on the strip. No menu lists the runs.
- A root opened from the closed state is held by the host only while it is
  shown (ADR-0063's load on request).
- Two folded roots with no sprite, the same initials and the same colour
  look alike; the tooltip tells them apart.

**Alternatives rejected.**

- **Each tab as a kanban card.** It joined the person's view to the shared
  item, which is the confusion this ADR separates.
- **A tab as a container holding a card that can be dragged into the
  inventory.** A root exists once and is everyone's; taking it into a
  private place would take it from everyone.
- **Reference cards in the inventory.** A thing you can pick up and of
  which there is only one is the inventory's strength; a reference has
  neither property. Links are another thing, and can come later.
- **The board's strip as a header row.** The open board hung over the work
  well, but ▦ sat above the list of personal roots and read as one of them.
  In the footer, the board sits apart from them.
- **▦ in the footer's left corner, below your list.** The corner belongs to
  you, and the board is everyone's.
- **The activity menu, under your list or on the right.** Under your list
  it would put everyone's runs and offers in your corner; on the right it
  is a second shared way in besides the board, with a badge on everyone's
  side.
- **Fixed states.** Not every team needs the same ones, pine·trie's own team
  included.
- **Several closed states** (Done, Dropped). One is enough; tags can say
  what kind of done.
- **States derived from facts** (an offer ready moves a root to Review). It
  breaks "nothing moves by itself" (ADR-0048).
- **Unsent cards on the board as backlog items.** It needed a new place for
  cards (ADR-0059) and two kinds of item on the board, and gave no place to
  discuss an idea before starting it. A conversation root does both with
  what exists. Cards can be added if a frozen first message proves to hurt.
- **Your list kept per device.** An order of priorities is the person's,
  on every device, as the inventory and attention are.
- **Your list folding by itself when a pane would not fit**, or one
  device-wide choice of width. The page would jump as a pane opened, and
  two windows side by side want different widths.
- **"Stage" as the name.** "Workflow state" says what it is in a team's
  process; "state" alone is avoided, since the archive record, offers and
  `tab-state.ts` already use it.
- **The board pushing the columns up.** It would move what you read each
  time it opens.
