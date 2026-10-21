# ADR-0122 — The sidebar holds your open threads down the left; a board in the footer shows where everyone's work stands

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`
- **Evidence:** S69
- **Supersedes:**
  - ADR-0112: restated whole, with what ADR-0109 (as ADR-0115 amends it),
    ADR-0111 and ADR-0113 changed in it folded in.
- **Amended by:**
  - ADR-0116: the board holds tasks, and the sidebar your open tasks.
  - ADR-0158: a new session's states are Topics, Active and Archive; ＋ in the
    sidebar or on a board column makes a canvas, with no ▾; a text card put on
    a state starts a chat.
  - ADR-0206: the workflow marks two open states, Topics and Active, and a
    workflow edit moves either mark; the sidebar's ＋ puts a canvas at the end
    of Topics, wherever it stands.

Restates ADR-0112 as amended by ADR-0109, ADR-0111 and ADR-0113, and by
ADR-0115 through ADR-0109; decides nothing new, and uses the glossary's
words: "the archive" for the state ADR-0112 called closed. ADR-0112 restated ADR-0085,
and ADR-0085's changes to ADR-0027, ADR-0029, ADR-0030, ADR-0063, ADR-0077,
ADR-0080 and ADR-0081 stand as ADR-0085 made them. How the sidebar folds is
ADR-0088's, the inbox's sections ADR-0091's, the account menu and pages
ADR-0098's, and a card's frame ADR-0111's.

**Context.**

- **A tab was doing two jobs.** It was the person's view (ADR-0030: closing
  one writes nothing, and the order is yours) and a sign of shared work (a
  ring while the agent runs, readers' avatars, the amber mark). Only the
  first is the person's. Nothing showed where the whole team's work stood.
- **The Archive tab was a board with one column**, with one shared state,
  open or archived, at the left of a bar of personal tabs.
- **A collaborator's new root reached you only through the header.**
- **A horizontal bar has no top and bottom**, and cut long titles short.
- **Every row of chrome has to earn its height** (ADR-0081): columns are
  tall reading surfaces.
- **"Lane", "column", "track", "card" and "tab" were taken.** A board's
  divisions needed a word of their own.
- **Narrow screens** need the sidebar and the footer's corner to give up
  width (ADR-0088).

**Decision.**

*Two views: yours down the left, everyone's in the footer.*

- **The sidebar** runs down the left edge: your open threads, the roots you
  have open, in an order you choose, top to bottom (ADR-0111 names it). It
  replaced the tab bar. "Tab" means only a browser tab (`tab-state.ts`).
- **The board** is everyone's: every root, in the workflow state it is in.
  It replaced the Archive tab. It is drawn as a strip in the footer, and
  slides up over the columns when opened.
- **The footer splits where the sidebar does.** Below the sidebar, at its
  width, is what is yours: the corner (below). To the right is what is
  everyone's: ▦ **Board**, then each workflow state's name and count, then
  the publish button (ADR-0090) and "syncing…" while pending.
- **There is no header row.** The columns, their heads and their pinned
  cards start at the top of the window.

*The sidebar.*

- **It is kept per person**, in a person document of its own (`open:`,
  beside `inventory:` and `attention:`, ADR-0059, ADR-0077): only your tabs
  write it, the host stores it and shares it with you alone, and it is the
  same on every device of yours.
- **Opening a root adds it at the bottom.** You open a root from the board,
  your inbox, a mention or a link; a root you start opens at the bottom too.
  Nothing opens a root in the sidebar by itself (principle 6 of
  `docs/06-interface.md`): a root someone else starts appears on the board.
- **Dragging reorders it**, and so does a keyboard move in an item's `⋯`.
- **× closes a root for you** and writes nothing shared (ADR-0030). Its
  columns stay kept, so opening it again brings them back.
- **Which root you are on, and each root's columns**, are per browser tab,
  with the device's latest as a fallback (ADR-0027).
- **The sidebar is chrome** (ADR-0081, turned sideways). The root you are on
  is the page's colour, with a neutral light edge on its left, and the
  sidebar's right edge line breaks beside it. The other items have no fill
  or border at rest. A title wraps to two lines before it is cut.
- **`⋯` and × show only on hover or focus**, on every item.
- **An item is a thread card** (ADR-0111), and keeps a tab's signals
  (ADR-0077): the blue ring while the agent works there, amber when
  something needs you or is worth a read, the ✓ that fades, readers'
  avatars, and your pip for unsent text. The agent's work is read in every
  root, from every running lane, so a root's ring, in the sidebar and on the
  board, and the archive's refusal while the agent works read the same
  facts. A held queue is not work, and draws no ring (ADR-0113).
- **＋ agent, with conversation in its menu**, sits at the bottom. What each
  starts is ADR-0021's.
- **The window's title names the root you are on.**

*The sidebar, folded.*

- **Full, or icons** about 3rem wide. A control at its foot switches, and so
  does Ctrl+Shift+L; the choice is per browser tab, with the device's
  latest as a new tab's fallback. With none stored, it shows icons below
  56rem. It never folds by itself.
- **An item's icon** is the sprite of its root's earliest thread that has
  one (ADR-0053), else a tile in the root's colour (ADR-0089) with two
  initials. Its signals stay on it. Hover and focus show its label and who
  is reading there.
- **⋯ and × become one menu**, opened by a right-click, Shift+F10 or the
  Menu key. Rename opens its field in a popover. ＋ agent becomes ＋.

*The corner.*

- **With the sidebar full, the corner is you**, then your inbox and your
  inventory: your avatar and name as one button that opens the account menu
  (ADR-0098); the inbox (ADR-0091) with its amber badge and the inventory
  (ADR-0048) with a muted count, as icon buttons of one style.
- **With it folded, the corner is only your avatar**, carrying the inbox's
  badge; the account menu then holds the inbox and the inventory.

*The board.*

- **Its columns are the session's workflow states, in order.** A root is in
  exactly one. A new session has three: **Backlog**, **Doing** and **Done**.
- **Anyone can edit the states**: add, rename, reorder, remove. Removing a
  state that holds a root is refused until it is empty.
- **One state is the archive, always there and always last.** It is named
  Done in a new session, and can be renamed but not removed or moved. A
  root in it is archived, with every rule ADR-0029, ADR-0061 and ADR-0063 give
  archiving: read-only until it leaves, refused while the agent works there
  or cards are queued, withdrawn offers, unloaded by the host. Moving a
  root out of it restores the root.
- **Anyone can move a root**, between states and within one, by dragging it
  or from its `⋯` ("Move to ▸", Move up, Move down). Nothing moves a root by
  itself: an offer ready, or a run that needs you, is a mark, never a move.
- **Where a new root lands:** ＋ in the sidebar puts it at the end of the
  first open state; ＋ on a board column, at the end of that state.
- **A backlog item is a conversation root.** An idea not yet started is a
  root with no agent (ADR-0021): its first message is the idea, people
  discuss it below, and asking `@agent` in it starts the work.
- **A text card put on an open state becomes a thread there** (ADR-0111): a
  conversation root whose first message is the card's text, by whoever put
  it. A note dropped on a state in the footer's strip, on a board column or
  in the sidebar does the same; in the sidebar the root opens there
  (ADR-0113). The undo key lifts the root back into the card while it holds
  only that first message.
- **An item on the board is a thread card** (ADR-0111): the root's label,
  the same signals as in the sidebar, **⇡** for everyone when a thread of it
  has an open offer (not amber, since it asks nothing), who is reading there
  (presence, ADR-0024), and who has written in it.
- **Selecting an item opens the root in the sidebar and shows it.** An archived
  root opens read-only, with **Restore** in its composer's place; it leaves
  the sidebar when you switch away unless you restore it.
- **The archive shows its most recent roots**, newest first, or every
  root a search keeps.
- **One search for the whole board** (ADR-0109, ADR-0115). While the board
  is open, the footer's strip holds it, its ×, and **mine** (roots you wrote
  in), in the state buttons' place. A root is kept when its label holds
  every word typed, case-insensitively, in any order: labels, not messages
  (ADR-0063). The states keep their places and the items their order.
  - A column's head shows the state's name, count, readers' avatars,
    highest mark, ◌ and ⇡; while filtered, its count, ◌, ⇡ and readers
    describe what it shows ("12 of 96"), its mark and Remove's refusal every
    root.
  - A banner at the board's foot names a filter, with **Clear**; the counts
    and the field's border are blue while one is on, and ▦ carries ⌕ with
    the board closed.
  - Move up and Move down step among the items shown.
  - Opening the board with ▦ or a state's button focuses the field; the
    board opening by itself does not. `/` focuses it while the board is
    open.
  - Escape lifts the filter before it closes the board; **Clear** lifts
    the words and mine, the field's × only the words. The filter outlives
    closing the board, not a reload.
- **The strip summarises the board while it is closed**: each state's name
  and count, avatars of the people in its roots, an amber dot when a root
  there needs you, and `◌n` and `⇡n`, each only when there are any. ▦
  carries the highest mark of the roots not in the sidebar. Nothing on the
  right of the footer has a badge or animates: the inbox carries the page's
  only badge.
- **The board opens over the columns** and does not move them. ▦ or Escape
  closes it, and so does choosing something to work in. Whether it is open
  is per browser tab; with nothing in the sidebar and nothing shown, it opens
  by itself.

*Records and commands.*

- **The workflow is one session record**, host-written (ADR-0062): the open
  states in order, each with a stable id and a name, and the archive's
  name (`Workflow.closed` in the code).
- **A root's place on the board is a session record keyed by its
  `RootId`**: its state, its rank within the state (a field per root, S69),
  who moved it last, and when. A root is archived when its state is the
  archive.
- **Clients edit states and move roots with commands over the Line**, which
  the host's serial executor orders. A move names the state the mover saw
  the root in; if the root has moved since, the host refuses and says where
  it is ("not moved: Bea moved it to Doing first").

**Consequences.**

- With the default states, ＋ agent in the sidebar starts work in Backlog. A
  team that starts most work with the agent moves it to Doing, or removes
  Backlog.
- The full sidebar costs width: about 15rem beside the rail and 28rem
  columns, 11.5rem below 56rem. Folded, the sidebar and the rail are two
  narrow strips side by side.
- A board move by someone else leaves no trace on your screen, and the undo
  key does not reach it: a move is reversed by moving back.
- Someone else's offer is found by scanning the board for ⇡; the thread's
  followers have a row in their inbox that opens the thread.
- A run in a root you do not hold shows only as a ring on the board and a
  count on the strip.
- A root opened from the archive is held by the host only while it is
  shown (ADR-0063).
- A filtered column can show none of its items.

**Alternatives rejected.**

- **Each tab as a kanban card.** It joined the person's view to the shared
  item, which is the confusion this separates.
- **A root taken into the inventory.** A root exists once and is everyone's;
  taking it into a private place would take it from everyone.
- **Reference cards in the inventory.** A thing you can pick up and of which
  there is only one is the inventory's strength; a reference has neither
  property.
- **The board's strip as a header row**, or ▦ in the footer's left corner.
  The corner is yours, and the board is everyone's.
- **An activity menu** of runs and offers: in the corner it puts everyone's
  work in yours; on the right it is a second way in with a badge.
- **Fixed states**, **several archives**, **states derived from
  facts** (an offer ready moves a root to Review): not every team needs the
  same ones; tags can say what kind of done; nothing moves by itself.
- **Unsent cards on the board as backlog items.** Two kinds of item, and no
  place to discuss an idea before starting it.
- **The sidebar kept per device**, or folding by itself when a pane would
  not fit.
- **"Stage" as the name.** "Workflow state" says what it is in a team's
  process.
- **The board pushing the columns up.** It would move what you read each
  time it opens.
- **A bar on the board for the search** (ADR-0115). It moved as the board
  grew; the footer does not.
