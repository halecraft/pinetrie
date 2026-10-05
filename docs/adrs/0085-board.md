# ADR-0085 — Your open roots run down the left; a board in the footer shows where everyone's work stands

**Status:** Accepted (Duane, 2026-10-05). Implemented by
`PLAN-2026-10-05-board`. Supersedes the Archive tab
(ADR-0029, ADR-0063's search) and the tab bar's place in the header
(ADR-0081). Amends ADR-0029 (archiving becomes the closed workflow state),
ADR-0030 (your tabs become your list, kept per person; the header's people
go), ADR-0027 (a stored layout no longer holds your open roots), ADR-0063
(the archive record's key and its readers), ADR-0077 (a third person
document; the Archive tab's mark moves to the board), ADR-0080 (the
`archive` command becomes `move-root` and `workflow`) and ADR-0081 (the
header row goes; the message count moves to the board). Evidence:
screenshots of the client restyled into this layout, at 1440 and 860 pixels
wide, made while deciding.

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
- **ADR-0081 removed a header row** that held only "PINETA" and counts.
  Every row of chrome has to earn its height, and columns are tall reading
  surfaces.
- **"Lane", "column", "track", "card" and "tab" are taken.** A board's
  divisions need a word of their own.

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
  width, is what is yours: your avatar, which opens your profile
  (ADR-0037), and your inventory. To the right of that line is what is
  everyone's: ▦ **Board**, then each workflow state's name and count, then
  what needs you (the activity menu, ADR-0069, ADR-0077), the project
  (ADR-0060) and "syncing…" while pending.
- **There is no header row.** The columns, their heads and their pinned
  cards start at the top of the window.

*Your list.*

- **It is kept per person**, in a person document of its own (`open:`,
  beside `inventory:` and `attention:`, ADR-0059, ADR-0077): only your tabs
  write it, the host stores it and shares it with you alone, and it is the
  same on every device of yours.
- **Opening a root adds it at the bottom.** You open a root from the board,
  the activity menu, a mention or a link. A root you start opens at the
  bottom too. Nothing opens a root in your list by itself (principle 6 of
  `docs/06-interface.md`): a root someone else starts appears on the board.
- **Dragging reorders it**, and so does a keyboard move in an item's `⋯`.
- **× closes a root for you** and writes nothing shared, as a tab's ×
  did (ADR-0030). Its columns stay kept, so opening it again brings them
  back.
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
  the ✓ that fades, readers' avatars, and your pip for unsent text.
- **＋ agent, with conversation in its menu**, sits at the bottom of the
  list. What each starts is ADR-0021's.
- **The window's title names the root you are on**, as ADR-0081 has it.

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
  reaches every move.
  Nothing moves a root by itself: an offer that is ready, or a run that
  needs you, shows as a mark on the root, never as a move.
- **Where a new root lands:** ＋ in your list puts it at the end of the
  first open state; ＋ on a board column puts it at the end of that state.
  Each ＋ is the same split button: ＋ agent, or conversation.
- **A backlog item is a conversation root.** An idea not yet started is a
  root with no agent (ADR-0021): its first message is the idea, people
  discuss it below, and starting the work is asking `@agent` in it. The
  board holds one kind of item, and no new storage is needed for ideas.
- **An item on the board shows** the root's label (its title, ADR-0045,
  ADR-0074), the same signals as in your list, who is reading there
  (presence, ADR-0024), and who has written in it.
- **Selecting an item opens the root in your list and shows it.** A closed
  root opens read-only, with **Restore** in its composer's place, as the
  Archive tab's preview did; it leaves your list when you switch away
  unless you restore it.
- **The closed state is drawn collapsed:** its count, a search over labels
  (ADR-0063's rule: labels, not every message), and its most recent roots.
  The filters the Archive tab had ("mine": roots you wrote in) are on that
  search.
- **The strip summarises the board while it is closed**: each state's name
  and count, avatars of the people in its roots, and an amber dot when a
  root there needs you. ▦ carries the highest mark of the roots not in your
  list, as the Archive tab did (ADR-0077). Its tooltip carries the message
  count ADR-0081 gave the Archive tab.
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
  replaces `pineta.archive`: a root is archived when its state is the
  closed one, and the archive record and its readers go.
- **Clients edit states and move roots with commands over the Line**, which
  the host's serial executor orders. A move names the state the mover saw
  the root in; if the root has moved since, the host refuses and says where
  it is ("not moved: Bea moved it to Doing first"), as a card's handoff
  does (ADR-0059).
- **A starting host carries a store over once**: it writes the three
  default states, puts every archived root in Done and every other root in
  Doing, and drops the archive records. The carry-over code is deleted once
  it has run, as ADR-0066's was.

**Consequences.**

- `docs/06-interface.md` is rewritten for your list, the footer, the board
  and the closed state. Its sections on the tab bar, the Archive tab and the
  add tab go, and ADR-0081's browser check (the tab you are on is the
  page's colour and meets it) turns sideways.
- With the default states, ＋ agent in your list starts work in Backlog. A
  team that starts most work with the agent moves it to Doing, or removes
  Backlog.
- The list costs width: about 15rem beside the rail and 28rem columns. At
  1440 pixels two columns fit with room to spare; at 860, one and part of
  another.
- A board move by someone else leaves no trace on your screen yet, and Cmd+Z
  does not reach it: a move is reversed by moving back. ADR-0048's traces
  and ADR-0066's host undo could cover board moves later.
- The activity menu (ADR-0069, ADR-0077) keeps counting what needs you; the
  board shows the same marks per root, to everyone in the state's summary.
- A root opened from the closed state is held by the host only while it is
  shown (ADR-0063's load on request).
- Narrow screens wait: the list should collapse to each root's banner
  (ADR-0050, ADR-0053), and the footer to ▦, what needs you and you.

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
  you (profile and inventory), and the board is everyone's.
- **Fixed states.** Not every team needs the same ones, Pineta's own team
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
- **"Stage" as the name.** "Workflow state" says what it is in a team's
  process; "state" alone is avoided, since the archive record, offers and
  `tab-state.ts` already use it.
- **The board pushing the columns up.** It would move what you read each
  time it opens.
