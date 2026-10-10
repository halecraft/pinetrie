# Interface: the sidebar down the left, columns for reading, a rail for shape, a board for everyone

The backend can now hold a conversation as a tree, with people and an agent in
it (ADR-0018). The first interface drew that tree as a chat list: one path, with
every other branch reduced to a "⑂ 1 branch" marker. That was honest about
context (T) but hid everything else (E), which is the product. Play-testing it
also showed two controls that confuse people:

- **"Follow the newest"** appeared after your first message, though you had not
  gone anywhere. It showed internal state (the client remembering which thread
  you read), not a choice you made.
- **"Make this a conversation"** changed a rule without showing where the rule
  starts, or saying what it does.

This document fixes the design before any code. It draws E and T directly.

## Principles

1. **Draw the tree.** Every branch that exists is visible somewhere, in the
   shape it has. Hiding branches behind a counter is what a transcript does.
2. **A branch sits beside its parent.** Slack's thread panel gets this right for
   one level. pine·trie needs it at any depth.
3. **No thread is special.** The data has no "main thread"; the interface should
   not invent one. Whatever you put first is what reads as the trunk. Roots
   are peers too: you open the ones you work in, in the sidebar (ADR-0030,
   ADR-0122).
4. **Show context, don't describe it.** What the agent will read is a path: the
   column shows it, and marks where the agent joined.
5. **Say the effect, not a mode name.** "send to agent" says what
   happens. "Working session" is a name someone has to learn. So there is no
   mode to set: the send button says what each message will do (ADR-0021).
6. **Every control is a choice the user made.** Nothing appears because of
   internal state.

## Layout

```
┌ the sidebar ───┐┌ rail ┐┌ column 1 ──────────────┐┌ column 2 ─────────────┐
│▎Fix the sync ││ ●    ││ Ada                    ││▌from Ada: "Say…" (blue)│
│▎bug ◉ (B)    ││ │    ││ Say exactly: OK  ●blue ││ Bea                   │
│ Release notes││ ├──● ││ agent: OK              ││ an aside              │
│ Q3 planning ·││ │  │ ││ Ada                    ││ agent: …      ●green  │
│              ││ │  ● ││ Ada: @Bea have a look →││ Bea                   │
│ ＋ agent ▾   ││ ◉    ││ Ada: @agent … ◉replying││   what about X?       │
│              ││      ││ ┌──────────────────────┐││ ┌───────────────────┐ │
│              ││      ││ │ send to agent…  send │││ │ reply in thread…  │ │
│              ││      ││ └──────────────────────┘││ └───────────────────┘ │
├──────────────┤└──────┘└────────────────────────┘└───────────────────────┘
│(A) Ada ✉2 ▣1│ ▦ Board · Backlog 3 · Doing 3 ◌2 ⇡1 (B)(C) · Done 41  publish
└──────────────┴──────────────────────────────────────────────────────────────
```

There is no header: the columns start at the top of the window. The page's
one row of chrome is the footer, and it splits where the sidebar's edge does:
under the sidebar, what is yours; to the right, what is everyone's (ADR-0122).

### The sidebar: the roots you have open (ADR-0030, ADR-0045, ADR-0077, ADR-0122)

Down the left edge: the roots you have open, in your order, then new tabs,
then ＋. It is darker than the page, and the root you are on is the page's
colour, with a light edge on its left, and opens into the rail and columns
beside it (ADR-0081, turned sideways).

- **The root you are on shows one root's tree**: its rail, and its columns.
  Every column there shares the root.
- **The sidebar is yours, on every device of yours**: your own document, which
  only your tabs write. Top to bottom is your order. Opening a root adds it at
  the bottom; drag an item to reorder. **×** closes a root for you and
  writes nothing shared; opening it again brings its columns back. A root
  you start joins the sidebar; a root someone else starts does not, and
  reaches you through the board or your inbox.
- **An item's label** is the root's title, else its first message's first
  line, wrapped to two lines before it is cut; a root only people have
  written in, untitled, is **Chat**. When the agent is first asked in a root
  with no title, a model titles it in one to three words (ADR-0074).
  **Rename** in the item's `⋯` turns the label into a field: Enter or
  leaving it saves the title for everyone, Escape cancels, and an empty title
  brings back the first line. **Auto-update title**, beside it, asks the
  model again from what was said in the thread, and replaces the title for
  everyone. A title is a mark on the root (ADR-0045), and names the root
  wherever it is shown: the sidebar, the board, your inbox.
- **An item shows what happens in its root while you are elsewhere**
  (ADR-0077), before its label: a still blue ring while the agent works
  there, cards wait to be sent to it, or it is finishing its summary, which
  needs nothing from you (cards behind a held queue wait for a person, and
  draw no ring, ADR-0113); a filled
  amber dot when something there needs you, which pulses three times as it
  arrives and then stays still; a dim amber dot when something is worth a
  read; and, when a run you follow ends with nothing to do, a ✓ that fades.
  Its title says why ("needs you: asks whether to drop the v1 table").
  Reading the thread to its end, on any device of yours, clears it; work
  ready to accept clears when it is accepted, or with **Not needed** in the item's
  `⋯`. A page that loads draws every mark still: only a change you see
  moves. After the label, small avatars of the others reading there, and a
  small dot in your colour when the root holds something you typed and have
  not sent.
- **Move to ▸** in an item's `⋯` moves the root on the board, for everyone
  (below). Moved to the archive, it is archived: the item says so
  ("archive: read-only for everyone until moved out"), is disabled while
  the agent works in that root or cards are queued there, with the reason,
  and names the threads whose offers it withdraws from your repo ("work not
  accepted goes: amber-fox"); moving it out builds them again
  (ADR-0061). **×** is for putting a root away yourself.
- **Archiving closes it for you** once the host accepts it, as **×** does,
  showing its neighbour below, else above, else nothing.
- **If someone else archives the root you are on**, it stays while you are
  there, read-only, saying who archived it, with **Restore**. It leaves your
  list when you switch away.
- **`⋯` and ×** show while an item is hovered or focused, the one you are on
  too, over the label's end.
- **＋ agent**, at the foot of the sidebar, is a split button with
  **conversation** in its menu: a conversation at the root is the rarer
  start, so it is the one behind the menu. What each does is under
  "Starting" below. A board column has its own ＋, which lands the new root
  in that column's state.
- **The sidebar folds to icons** (ADR-0088), about 3rem wide, from **«** at
  its foot or Ctrl+Shift+L; **»** shows its titles again. Which you chose is
  this browser tab's, and a new tab starts from your latest. Until you
  choose, a window under 56rem shows icons. Nothing folds it by itself.
  - **An item's icon** is the sprite of its root's earliest thread that has
    one (ADR-0053), else two initials on the root's colour, the colour of
    its trunk (ADR-0089): "Kanban outside click" is **KO**, "Sidebar" is
    **SI**. A new tab is a hollow tile until its first message.
  - **Its signals stay on it:** the blue ring round it while the agent
    works, the amber dot and the fading ✓ on its top-right corner, your
    dot on its bottom-right. Hovering or focusing it shows its label and
    who is reading there.
  - **Its menu** opens with a right-click, Shift+F10 or the Menu key: what
    `⋯` holds, then **Close**. **Rename** opens the title field beside the
    icon.
  - **＋** stands over its ▾.

### The footer: you, your inbox, and the board (ADR-0069, ADR-0077, ADR-0122, ADR-0091, ADR-0098)

One row along the bottom. Its own cell, under the sidebar and as wide, is
yours: your avatar and name on the left, then your inbox and your inventory
as two icons of one style on the right, with no borders and the sidebar's
hover fill. Your name is cut short before anything else gives way. While
the sidebar is folded, the cell holds only your avatar, which carries the
inbox's badge on its corner, and the inbox and the inventory are in its
menu. To the right is everyone's, from live data only: the board's strip,
then publish. Your inbox carries the page's only badge: one place asks you
for something, the other reports.
While the page syncs, "syncing…" leads its right end.

- **You:** your avatar and name open a menu headed by who you are: your
  avatar, your name and your email. Folded, it lists **Inbox** with its
  badge and **Inventory** with its count (**Close inventory** while the
  panel is open); choosing **Inbox** shows the inbox's sections in the same
  menu, under **← back**. Then **Profile**, which opens your profile page
  (Pages, below), and **Sign in as someone else**, which forgets who this
  device says you are and asks again (ADR-0037).
- **Your inbox** (ADR-0030, ADR-0077, ADR-0091), beside you: one menu of
  what needs you, its trigger a tray icon named **Inbox** and what needs
  you ("Inbox · 2 things need you: …"), drawn even with nothing in it. Its
  amber badge counts what the threads you follow need from you (a run that
  ended asking something, failing, or that no one could tell; work ready to
  accept) plus the mentions you have not seen; the page's title carries the
  same count, before the root you are on: "(2) Fix the sync bug · pine·trie".
  Its sections, each shown only with rows: **Needs you** (each thread's
  reason, in amber), **Ready to accept** (threads you follow with an open
  offer), **Worth a read** (listed, not counted) and **Mentions of you**.
  It lists exactly what it counts. Each thread's row opens it; under each,
  **not needed** clears it on every device of yours, until the next run's
  end or new work. You follow a thread once you have written on it; threads
  you do not follow raise nothing for you.
- **Mentions of you**: the messages that mention you, newest first, each
  with who, the thread, and the start of the message. A row opens that
  thread in the sidebar, with a column on the message, archived or not. The
  badge counts the mentions you have not seen. One is seen when you open it
  from the inbox, when it is drawn in a column of the root you are on, or
  when you **mark all seen**. A seen mention stays in the inbox; a filter
  shows only the unseen.
- **The inbox is yours**, the same on every device of yours (ADR-0077). You
  start from your first load, with no backlog.
- **Your inventory** (below): a box icon beside your inbox, with its count
  when it holds cards, titled "your inventory: 1 card"; in the account menu
  while the sidebar is folded.
- **The board's strip**: ▦ **Board**, then each workflow state's name and
  count, avatars of the people reading in its roots, an amber dot when a
  root there needs you, and, only when there are any, **◌n**, its roots the
  agent works in, and **⇡n**, its roots with work ready to accept (ADR-0091).
  Those two are facts for everyone: never a badge, never moving. While the
  board is open, the board's search and **mine** take the states' place,
  since each column's head shows the same (ADR-0115). ▦ carries
  the highest mark of the roots not in the sidebar, a dot in your colour
  when one of them holds something you typed, and a blue ⌕ while a filter
  is on and the board is closed; its title is the session's
  message count, "2 in the threads this tab has loaded, of 4 in the
  session": the messages in the roots this browser tab holds, of every
  root's. Nothing in the footer animates: the sidebar, the column, the rail
  and the board show where the agent works.
- **Publish** (ADR-0104, ADR-0076, ADR-0090, ADR-0099): one button, no
  menu. **Accepted work** is where finished work goes (ADR-0100,
  `docs/glossary.md`); its bookmark (`accepted.bookmark`) is in titles only. Before accepted work
  exists, any host shows **set up**, which opens what it writes: the
  bookmark it makes at your `@-` and the exact `immutable_heads()` and
  `revsets.log` text for your repo's config (the log, so jj and jjui show
  the offers), and what to add to a jjui revset of its own
  (`docs/the-jujutsu-repo.md`), done only when you choose it. After,
  **publish** shows only while there is something to publish, and does it
  in one act, the same whoever presses it and wherever the host listens:
  - with `publish.catchUp` on, the working copy catches up with accepted work
    (`jj rebase -b @ -d <accepted>`, as you) when they are behind; your
    commits below `@` are accepted; then `main` (`publish.bookmark`) moves
    forward to accepted work. Your commits and `main` move together in one
    jj operation;
  - with it off, the default, only `main` moves, as the host. No one's
    files move.

  Its title says what it will do, with how many files catching up
  changes and any other line of your work that moves with it, or, with
  the setting off and the working copy behind or commits waiting, that the
  working copy does not move (`publish.catchUp` is off), then the jj commands. It
  does not push. What can be checked first is (`main` holding commits
  accepted work lacks; with the setting on, the working copy's conflicts and what
  catching up would conflict), and the title leads with why it would be
  refused.
  If your commits come out of the catch-up conflicted, or the move fails,
  the catch-up is reverted (`jj op revert`): nothing is left half done.

  While a publish is out the button reads "publishing…". A refusal or a
  failure is a **toast** above the footer ("not done:" and why; "it
  failed, and may be part done:" and why), until you dismiss it or send
  another. A conflict in the working copy is said, and left to you, in jj
  (ADR-0102).
- **A menu you opened stays open until you close it.** The footer's and the
  board's avatars and counts come from live data, but when what one stands
  for goes while its menu is open (a person leaves the root, the last thing
  in a section of your inbox is dealt with), the menu says so ("Bea has
  left", "Nothing left to accept.") and its trigger stays until you close it
  (principle 6). Escape closes a menu open on the board, and then the board.
- **Nothing opens a root by itself.** A mention is a notification: you
  choose to open it.

### Pages (ADR-0098)

A page covers the stage: the sidebar and the footer stay, and the
stage stays as you left it under the page. It opens with **← back** and
its title. Back, the browser's Back, and choosing a root, a new tab, ＋, ▦
or a row of your inbox all return to the stage. The page is in the
URL (`#profile`), so a reload stays on it; the window's title names it,
"(2) Profile · pine·trie". While a page shows, the card and undo keys do
nothing; Ctrl+Shift+L still folds the sidebar.

- **Profile**: your picture, your name, then your email.
  - **Your picture** is your circle, large, with **upload a picture** (or
    **choose another**) and **remove**. An image chosen, dropped or pasted
    there opens a round preview you drag to move it, with a **zoom**; **use
    this picture** sends it ("saving…"), **cancel** drops it, and nothing
    is sent before. Everyone's circle shows their picture wherever a
    person is drawn: the corner, the account menu, readers on the sidebar,
    the board and columns. The rail's rings, card pips and the inventory's
    borders keep each person's colour.
  - **Your name**, and the handle it gives you as you type it, sent on
    Enter or **save**, which says **saved** once it is; a name no mention
    could reach is refused before it is sent.

### The board: where everyone's work stands (ADR-0122)

▦, or a state in the strip, opens the board over the columns, from the
footer's edge: it moves none of them. ▦ again, Escape (once a filter is
cleared), or a click outside it and its strip closes it, and so does choosing something to work in. Whether it is open is this browser
tab's; with nothing in the sidebar and nothing you are on, it opens by itself.

- **Every root is in one workflow state.** Each open state is a column of
  the board, in order; the archive is last. A new session has
  **Backlog**, **Doing** and **Done**.
- **A thread card** (ADR-0111) is a root, on the board and in the sidebar
  alike: its header, the same in both, shows its label, its status (with
  the agent's ring in any root, opened in this browser tab or not), a
  blue **⇡** for everyone when a thread of it has work ready to accept (its
  title names the threads; the thread's followers have it in their inbox),
  and a dot in your colour when it holds something you typed. On the board,
  a titled root's first line is its body, and its foot shows who wrote in
  it and the others reading there: each reader's avatar is a menu of the
  threads they read there, a row of which opens that thread in the sidebar.
  Selecting the item opens the root in the sidebar and shows it.
- **Anyone moves a root, for everyone**: drag an item to another column, or
  before another item, or use its `⋯`'s **Move to ▸**, **Move up** and
  **Move down**. Dropped on your
  list, it opens there. Nothing moves a root by itself: an offer ready, or a
  run that needs you, is a mark, never a move. A move from a state the root
  has left is refused, naming who moved it and where ("not moved: Bea moved
  it to Doing first").
- **A column's head** shows the state's name, its count, the readers'
  avatars of its roots, its highest mark, and, only when there are any,
  **◌n** and **⇡n**, as the strip's button does (ADR-0115).
- **One search for the whole board** (ADR-0109, ADR-0115), in the footer's
  strip while the board is open, with **mine** (the roots you wrote in),
  filters every state in place: a root is kept when its label holds every
  word typed, in any order (labels, not every message, which would load
  every root, ADR-0063). The states keep their places and the items their
  order. While a filter is on, each head's count says how many it shows
  ("12 of 96"), its ◌, ⇡ and readers count those, and the count and the
  field's border are blue; its mark, Remove's refusal and the strip count
  every root. A banner at the board's foot names the filter ("Filtered by
  "parser" and mine: 14 of 140 roots") with **Clear**, which lifts the words
  and mine; the field's **×** clears only the words. Move up and Move down
  step among the items shown. Opening the board with ▦ or a state's button
  focuses the field; the board opening by itself does not. `/` focuses it
  while the board is open; Escape clears the filter before it closes the
  board. The filter outlives closing the board, not a reload.
- **A root in the archive is archived** (ADR-0029): it is read-only for
  everyone until it is moved out, the host lets go of it, and its threads'
  offers leave your repo. Its column, as wide as the others and marked ✓,
  shows a count and its most recent roots, or every root the search keeps,
  newest first. An archived root opened from it
  is read-only, with **Restore** in its composer's place, which moves it to
  the first open state; it leaves the sidebar when you switch away unless you
  restore it.
- **Anyone edits the states**: a state's name is a button that turns into a
  field (Enter or leaving it saves; Escape keeps the old name); its `⋯`
  moves it left or right, adds a state left or right of it (a name field
  stands where it will go), or removes it, which is refused, with the
  reason, while it holds a root or is the only open state. Adding a state is
  rare, so it takes no room on the board. The archive can be renamed, never moved or
  removed.
- **A backlog item is a conversation root**: an idea not started is a root
  with no agent (ADR-0021); people discuss it below its first message, and
  asking `@agent` in it starts the work.
- **A text card becomes a thread** (ADR-0111): dropped on an open state, in
  the board's column or the footer's strip, or among the sidebar's roots,
  it starts a conversation root there whose first message is its text, by
  you; a note's and your message's ⋯ have **Move to a new thread in
  Backlog** (and each open state) for the keyboard. Dropped in the
  sidebar, the new root opens there for you. It never asks the agent,
  even with `@agent` in it. While a card is dragged, those places are
  outlined, and a card held over ▦ opens the board. The undo key lifts the
  thread back into the card, where it was, while the thread holds that
  first message alone; once someone replied, it says "not lifted back: Bea
  replied". A blank card starts nothing.

### Columns: the task's canvas (ADR-0116)

- **A task opens on its canvas**: every card on it, as columns, in an order
  everyone shares. A thread card's column is its thread's path; a note
  column's is its notes. Each is **folded** for you until you open it: a
  narrow strip in its place with its title, which a click unfolds. Folding
  (⇤ in a column's header) is yours alone, and moves nothing for anyone
  else.
- **The task column comes first**, folded the same way: the task's title,
  which anyone renames there, **Move to ▸** among the board's states, who is
  reading, the cards pinned to the task, the canvas list its agents are
  told, and **+ note column**.
- **A thread's column is one path**, from its root to its thread's end,
  read top to bottom. Its composer sends at its last message.
- **Opening a branch adds a column after the thread it forks from**, starting
  after the fork, and yours alone until its first send. Its card then lands
  on the canvas in that place, for everyone, unfolded for you. An aside of
  an aside opens a third column.
- **A column's header says who works in it and where it came from**
  (ADR-0040). Its first row names the agent working there, `✦ amber-fox` in
  the column's colour. While the composer's next send would start one, the
  agent to come is named already (ADR-0057), with `✦ new agent` only until its name arrives. A conversation
  shows nothing there, since a message goes to people. Its second row, for a column
  that forks, names the fork, `↰ Ada: “Say exactly…”`, and clicking it brings
  the fork point into view. A copy names its source instead, "↰ copied from
  amber-fox · Fix the sync bug", and a thread whose parent thread is in
  another task names that, "↰ from amber-fox · Fix the sync bug": clicking
  either opens that task at the fork. Where someone holds the source in
  their inventory, the row says "Bea has it" and opens nothing. A thread that started from a WIP says so, "on
  wip/search", or "wip/search is gone" once it is (ADR-0104); one on the
  line says nothing.
- **A thread's name opens its details** (ADR-0073), under the header, and a
  second click on it closes them; a chevron after the name turns as they
  open. They show the thread's icon magnified, which spins in as they open
  and again at a click, its name, "started by Ada · 3 h ago", where it
  works, what it is working on, and what its base has new, in full. Where
  the agent joined below the path's first message, **where it started**
  brings that message into view. Open details stay open, through a reload
  too, as a column's density does.
- **Colour, not lines, links a branch to its parent.** Each open branch takes
  its rail track's colour: its column's header carries a stripe of it and a dot
  beside its fork, and the fork point in the parent column shows a dot of it.
  Hovering either end outlines the other in that colour; clicking the dot
  scrolls to the branch's column. Sibling branches off one column never cross,
  as drawn lines would.
- **Each column scrolls on its own.** A new column opens scrolled so its first
  message is level with its fork point when the fork point is on screen, and
  at its end otherwise; after that it scrolls freely. Forks far apart (message
  2 and message 95 of a long trunk) are both readable at once.
- **A column at its end follows what is written there**, the agent's reply as
  it streams included. A scroll up holds it still; **↓ new below**, a scroll
  back to the end, or your own send brings it back.
- **The shared part of paths is shown once.** A column shows only what follows
  the deepest entry it shares with any column to its left; its header says where
  it came from.
- **A column grows as replies arrive.** It shows one thread to its end,
  including the agent's reply (`threadEnd`, ADR-0117). A branch, which
  starts another thread, however new, never pulls it away.
- **Columns are reordered by dragging their headers, for everyone**: the
  canvas's order is shared, and a drag moves a card on it. Whichever column
  is first shows its whole path, so moving a branch to the far left makes it
  read as the trunk. A grip (⠿) leads each header, and is the keyboard's way
  to do the same: ←/→ move a column one place, and Home/End move it to
  either end. A column's ⋯ sets its width, one or two columns wide, for
  everyone.
- **A thread is a card** (ADR-0117, ADR-0124): one place, on a task's canvas
  or in someone's inventory. A thread column's ⋯ has **Copy to this
  task**, **Copy to your inventory** and **Move to your inventory**, and
  lists no tasks (ADR-0127); ⇲ in its header, dragged onto a slot, takes
  it too. A thread reaches another task through your inventory: taken,
  then put down there, so a running thread moved that way stops. Taken
  into an inventory, its run stops at once, the taker's own stop ("Bea
  stopped it"); nothing is sent in it there, nor branched from its entries
  ("put it on a canvas first"), and its queue waits, held. Put on a canvas
  again, from its slot or by a drop on a column, it lands after that
  column and takes sends again.
- **A copy is a branch at its source's end** as you saw it, its card where
  you put it: a new thread, with a new name, and no message yet. Its first
  send writes its first message there, and its lane is made when it first
  asks the agent, from the files of that end's turn (ADR-0021); if those
  were not kept, it starts from its base, and its fork row says so. An
  archived thread copies.
- **A thread from another root shows its path from that root**, the part
  above its own first message folded behind "↑ N earlier messages" when
  the thread it forks from is on no column of the canvas. A canvas with
  threads of several roots draws each root's tree on the rail.
- **Only a branch you have not sent closes** (×); asked first when it holds
  text, which you keep in your inventory or discard. A branch not yet sent
  from a thread someone else has since taken keeps its text, but its
  column says "Bea has it" in place of that thread's messages and sends
  nothing until the thread is on a canvas again. A card's column folds
  instead. A new tab's × closes the new tab. The cards at a thread's end
  stay with the thread.
- **Each column's foot is its dock** (ADR-0113), pinned there while the
  messages scroll above it: the queue's header, which says what happens
  next, the cards queued, **+ add to queue**, the line, and your message.
  It takes at most a third of the column and scrolls within
  itself past that, its queue header kept in view.
- **The queue's header says what happens next**, with one button. ▸ marks
  what goes next: the run, the queued card the host sends next (a blank
  one is passed over, as the host passes it), or your message's send.

  | the thread | header | button |
  |---|---|---|
  | running | ◉ running | stop |
  | idle, queue held, cards queued | held by Bea | send queue (2) |
  | stopped, nothing queued | stopped by Bea | resume |
  | a card due | sending, or "sends when the typing stops" | none |
  | idle, nothing queued | idle | none |

  Its ⋯ holds the rest: **resume** while the queue is held and the turn
  may carry on, **hold queue** (or **release hold** while it is held with
  nothing to send), and **unqueue all** while a card waits.
- **Queued cards are folded** to their header and first line, and open
  while one holds the focus. **+ add to queue** makes an empty card at the
  queue's end, never a note first, and focuses it; on an idle thread it
  holds the queue first, so the card is not sent as you type it. The host
  passes over a blank message (no command, nothing typed) and sends the
  cards behind it; the blank card stays until someone writes in it. It does
  not keep the thread working: a thread with only blank cards queued draws
  no ring, can be resumed, and can be moved to the archive. The rail scrolls on its own, and
  follows the column you move (below).
- **A column shown again is where you left it** (ADR-0058): the same message
  at the same height, or its end if you were following it. If its thread
  grew meanwhile, it comes back at its old end, with ↓ new below.
- **A row of the column's header, the work strip, says what became of the
  agent's files** (ADR-0040, ADR-0113): an agent on its own copy shows its offer in plain words ("2
  files ready"), with **accept** and its bookmark, which a press copies. The
  button names a WIP the work goes into (ADR-0104, ADR-0090): "accept", or
  "accept into wip/search" for a thread on a WIP, whose menu also offers
  "accept, with your 2 commits beneath it" into accepted work; its title
  names the bookmark it moves. Accepting the offer (an *acceptance*,
  ADR-0083) moves that bookmark forward to the offer and never touches your
  working copy. From the click to the host's
  answer the strip says what your command is doing ("accepting…",
  "accepting into wip/search…", "squashing to one…", "splitting into
  a stack…", "rewriting the description…", "refreshing…"), and its buttons
  wait. A command refused or failed says so there, as the publish toast does
  ("not done: …", "it failed, and may be part done: …"), until your next
  one on that thread; one carried out says nothing, as the offer then shows
  it. An acceptance adds the offer the strip showed: if it now brings other work
  (the lane moved on), or conflicts where it did not, it is not done ("not
  done: the offer changed since you looked at it: review it again"), and
  the strip shows the new offer. A rebase onto moved accepted work, or your
  own edit of the offer, is still the offer you saw, and is accepted. An
  offer that conflicts is never accepted into accepted work; its button is
  **catch up with accepted work and resolve**: the agent resolves what the merge leaves. An offer whose
  every conflicted file was already conflicted where its thread's copy
  started says so instead: "began from a copy with an unresolved conflict
  in 1 file", and, when the thread it branched from has since resolved
  those files, "· amber-fox has resolved it", with **catch up with
  amber-fox** as its button (ADR-0072). Its **⋯** menu holds **catch
  up with** the thread's base (accepted work, or its WIP), or, once its WIP
  is gone, **continue from accepted work**; and, while the thread it branched
  from has new commits, **catch up with** that thread by its name, greyed
  out while that thread's agent works. When catching up would change files
  in the thread, the strip says so ("2 files ready · accepted work has
  moved on"), catching up stands beside the offer, titled with how many files it
  changes, and the column's header shows ↓, titled with the count, the
  bookmark and both commits. When it would change nothing, it stays in the
  menu, greyed out, and says why: "already caught up with accepted work",
  or, when accepted work moved only by this thread's own work you accepted,
  "what's new in accepted work is this thread's own: catching up changes no
  file"
  (ADR-0067). A thread whose base pine·trie has not read yet (one whose agent
  never changed a file, so its work never reached your repo) keeps it in
  the menu, enabled, and claims nothing. An offer whose work accepted work
  already has says "nothing to accept: accepted work already has this
  thread's work": the header does not
  count it, and archiving its thread warns of nothing. A thread whose
  earlier accept was made before pine·trie recorded what an accept brought
  says "an earlier accept of this thread can't be traced: catch up with
  accepted work to offer what's new", with catching up beside it. Every catch-up button does
  it at once
  (ADR-0061): each queues a new card holding the command and no text, which
  the host pops when the lane is free, and your composer is left as it
  was. The queued card says "↓ catches up with accepted work first", and
  the strip "catching up with accepted work…". A card that already carries a
  command (one unqueued, say) says so in a chip in its header, with a × that
  sends it as a plain message instead, and its button reads "catch up", or "catch up
  and send"; what you write is what the agent should do with the new work
  (ADR-0108).
- **The thread hears what was done to its work** (ADR-0080). An
  acceptance, a rewrite of the description, a squash and a refresh each add a line to
  the thread: "✓ accepted as k1a2b3c4", "✎ a new description
  was asked for", "⇣ the stack was squashed into one revision", "↻ the
  offer was rebuilt from this thread's work". While the agent works, the
  line waits in the dock's queue as a quiet row, and joins the thread when
  the run ends. When accepted work has moved on with work the thread
  lacks, its next run, or its run in progress, begins with "↓ accepted
  work has moved on: 2 files, 1 this thread changed too". A thread with no work of its own is
  caught up before it runs, and shows the update's "↓ caught up" line
  before your message.
- **Split into a stack waits its turn** (ADR-0080): the button queues a
  card with the split, as catching up does, sent when the thread is free;
  the queued card says "⇶ splits the offer into a stack, with what you
  write as its brief", its button reads "split", and while it waits the
  strip's **split** is greyed out. The agent can ask for a split too.
- **The agent asks about a conflict** with `ask_about_conflict`: the strip
  then says "the agent has a question about your edits · see the thread"
  until the offer changes.
- **A branch from a conflicted copy is warned** (ADR-0072): when the next
  send would start a thread on its own copy cloned from a commit with
  conflicts, the line under the box says "starts from a copy with an
  unresolved conflict in 1 file".
- **A column's pane opens what you read beside the thread** (ADR-0078):
  the offer's review, an ask's review, a table, or an image, one at a time.
  The thread keeps its place and width, and the column widens to hold the
  pane, which takes what the strip has beside the thread, from 40rem to
  64rem (ADR-0087). Opening something else replaces it; opening it again,
  the pane's ×, or Escape inside it closes it, and its source in the thread
  is outlined in the column's colour while it shows. A strip too narrow for
  the thread and 40rem shows the pane over the page instead, with ← to go
  back to the thread; folding the sidebar can make room for it beside the
  thread. Nothing in it is kept: a reload closes it.
- **The offer's line opens its review in the pane** (ADR-0047): a file
  list when there is more than one file, and one scroll of every file's
  diff, each file's head pinned while its diff is in view, with the files
  that conflict and those you are editing flagged. In its head, **↩** wraps
  long lines, each continuation hanging under its line's text, and **☰**
  hides the file list, giving the diffs the pane's width (ADR-0087). Both
  are kept for this device, in every review; lines start unwrapped.
- On a narrow screen, columns stack as a back-navigable sequence (the macOS
  Finder column view on a phone), with a breadcrumb of fork points.

### Asks: a message to the agent, and what was done for it (ADR-0106)

An **ask** is a message that started a run, together with that run: a
person's message to the agent, a land message or a stack message. A message
for people only is not one. Nothing about an ask is stored; it is read from
the tree.

- **A column is read at one of three densities**, chosen in its header, kept
  with the column and never written. A new column opens in story.

  | density | an ask shows |
  |---|---|
  | **outline** | its message, and one line: how it ended, or what it is doing, and its digest; the column's last ended ask also its last word (ADR-0106) |
  | **story** | its message, a digest line folding its work, and its last word |
  | **raw** | every message and tool row, under its digest line |

  People's messages show at every density. Outline lists everyone's asks.
- **An ask's digest line** counts its work: steps, tool calls, files its
  turns changed, how long it took, and failures. A press opens or closes the
  work under it. Its files open a review of what the ask alone changed, beside
  the column, as an offer's review does.
- **What the rail draws apart, no fold hides**: a fork, a branch's first
  message, a running tip, an open column's end. Each splits the fold around it.
- **The running ask is open** in story and raw: until its run ends, which
  message is its last word is not known. It folds once its run has ended and
  the column is at its end, so what folds is above the view. Scrolled up into
  its work, it stays open under you until you come back down. Your choice,
  open or closed, wins, and is kept while the page lives.
- **An ask's last word** is its run's last message with text or a tool call:
  its answer, or what it was doing when it stopped. A stopped ask says who
  stopped it, "stopped by Bea" (a stop made before stops were recorded says
  "stopped"); a failed one shows the error. A restart does not end a run:
  the host resumes it.
- **The ask stays in sight.** While the work at the top of the column belongs
  to an ask whose message has scrolled away, a bar over the column's top
  names it, `Ada: "Fix the rail…"`; a press scrolls to it. A column that
  starts inside a run names the ask in a column to its left,
  `↰ answering Ada: "…"`, and a press shows it there.
- **A pick on the rail into an ask's work opens its fold**, then brings the
  message into view.
- **Since you were here.** Your attention document remembers, per thread,
  how far you have read it, on any device of yours (ADR-0077): a column at
  its end in a page you can see marks it, and so does leaving it there.
  Coming back, a dashed line, "since you were here", marks the first
  message after it. It takes no room.
- **A summary, unless digests are off** (`{ "digests": { "enabled": false } }` in
  `~/.config/pinetrie/config.json`, ADR-0071): a model's two or three sentences on an
  ask's work, under its digest line, set apart from the agent's words. It is
  refreshed at most once a minute while someone reads the running thread,
  written once more when its run ends, and read by no agent.

### The rail: a root's tree, compactly

- **A forest on a canvas of several roots** (ADR-0116, ADR-0117): one tree
  for each root a thread of the task is in, each cut to the paths leading
  to the task's threads, in its root's own colours. A fork from those paths
  to a thread elsewhere is a stub, `↳ amber-fox`, titled where it is: a
  click opens that task, or your inventory's preview; one someone else
  holds says "Bea has it" and opens nothing.
- A strip beside the sidebar draws every branch in the root you are on as a line,
  and every message as a dot, except for uneventful stretches (below). A row
  is a depth, not a turn in one order: a branch starts on the row under its
  fork, beside the messages it diverged from, in the leftmost place free for
  its whole height (ADR-0068). Each branch has its own colour, by when it
  was made, starting from a colour of its root's own (ADR-0089): its trunk
  takes a colour the root's id picks from twelve, and each later branch
  steps on round them, so roots don't all start alike, and neighbouring
  branches are far apart. The tree is centred in the rail.
- **A new tab has a rail too**: a hollow dot where its first message will be.
  It is as wide as the rail it becomes, so the columns do not move when the
  first message lands.
- **A column wears its rail track's colour**, so you can see which branches are
  on screen and where they sit in the whole.
- **Clicking a message in the rail brings it into view**: in the column that
  shows it, or in a new column opened beside it.
- **Uneventful stretches are capsules** (ADR-0031, ADR-0106). A message is
  always its own dot if it is the root's first message, a branch's first
  message, a fork, a thread end, a thread end someone else is reading, where
  the agent is replying, the end of a column you have open, or the message
  of an ask whose work is three agent messages or more. Three or more other
  messages in a row are one capsule on their track, and a capsule never
  crosses such an ask's edge: a long ask is a dot and a capsule of its own,
  and short exchanges merge. A capsule is 2 rows long for 3–9 messages, 3
  for 10–99, 4 for 100–999. It is hollow when only the agent wrote in it,
  solid when only people did, and filled at half strength for both. Its
  tooltip leads with its ask, then the counts, failed tool calls included,
  then the ask's summary when there is one. Clicking it opens the message at
  that point of the stretch, its ask's fold included: near its top, the
  first; three quarters down, the message three quarters through. The column
  is where it is read.
- **Activity shows in the rail**: a pulsing dot where the agent is replying, a
  mark where a branch has messages you have not read.
- **The rail outlines what each column shows** (ADR-0058): a rounded outline
  in the column's colour around the whole dots and capsules in its view, and
  a thin line across a capsule where the view's top or bottom falls inside
  it: at most two, never a fill. Both move as
  the column scrolls, and the rail scrolls to keep the view of the column you
  move in view, except while your pointer is over the rail.

The rail is E; the column is T. Seeing both at once is the product.

### Context, drawn

- A message the agent was asked shows as asked (a margin bar), and a divider
  marks **where each agent joined**, by name: `✦ amber-fox joined`, or
  `✦ copper-owl, from amber-fox` in a branch of agent work. Everything above
  it is now that agent's context.
- **What is on the canvas, as the agent was told it**: a run in a task is
  told the list of the canvas's cards, 50 at most, when it differs from the
  last the thread was told; "the agent was told the task's canvas: 4 cards"
  sits above its prompt and opens to the list. A card added or taken while
  the agent works reaches it as it works, never as a message queued.

### Who a message is for (ADR-0021)

- **A thread's mode is whether the agent works in it**, which is whether it has
  a lane. In agent work, a message that names no one asks the agent; in a
  conversation, only `@agent` does. Nothing is set or stored, so there is no
  rule to mark and no mode to toggle.
- **Mentions pick who a message is for.** `@agent` asks the agent. A message
  naming only people goes to them, in agent work too. A handle that names no
  participant (`@types/node`) is ignored. A person's handle is their name as
  shown, in lower case, keeping only letters and digits (in any script), `_`
  and `-`: `@adalovelace`, `@josé`, `@日本`. Someone who set no name is shown,
  and mentioned, by their email's part before the `@` (`@ada` for
  `ada@example.com`, ADR-0037). A name with no such character, or spelled
  `agent`, is refused: no mention could reach it.
- **Another thread's agent can be brought in** (ADR-0128, proposed). A
  mention can name the agent of another thread on the task's canvas by its
  thread's name (`@amber-fox`); a person's name may not be a thread's.
  - **The first mention invites it**: it becomes a **member** of the
    thread, and the message goes where it would have gone without that
    mention, so "Please talk to @amber-fox" in agent work asks the thread's
    own agent. Where that is nobody, as in a conversation, the agents it
    invites are asked. A member's mention asks it, and leaves the thread's
    own agent out, as a person's mention does.
  - **Members are read from the thread's path**: a branch has the members
    its thread had where it forked. The column's header names them ("with
    amber-fox"), and what agents talking from the thread spent ("agents
    spent 38k of 200k tokens").
  - **The send button names them**: "invite amber-fox · send to agent",
    "send to amber-fox", "send to amber-fox +1".
  - **An agent asks another with its `ask` tool**, which never waits: its
    row reads "asked amber-fox". The asked agent works in its own thread:
    a "heard in sable-meadow: 3 messages" line, then the ask, spoken by its
    asker. Its last message comes back as an answer, spoken by its thread's
    name; an answer to an agent's ask runs that agent again, and nothing
    else does. An ask for a busy agent waits in its dock as an ask card,
    which a held queue holds.
  - **A budget of tokens** (200k unless the user config's `agents.budget`
    says otherwise) is set by the person's message the talk began from;
    the runs agents start spend it, and a spent one stops the run, wakes
    nobody, and says so in the thread.
- **The send button says what the message will do**: "send", "send to Ada"
  ("send to Ada +2" for three), "send to agent", or, while the agent is busy,
  "queue up next", "queue after Bea" or "queue after yours", naming who
  queued the last card already waiting. It uses the host's own decision (`addressChat`,
  over the column's thread), so it cannot promise a reply that will not come. When the
  send starts a thread and you have WIP bookmarks, a line left of the
  button says what its copy **starts from** ("starts from accepted work ▾"),
  and opens the choices: accepted work, or a WIP, with how far that is
  behind accepted work (ADR-0104). Every thread's agent works in a lane of
  its own (ADR-0102): there is no place to choose.
- **Who else is here** (ADR-0024) shows where there is room for it:
  - the **rail** rings the dot at the end of each thread someone else is reading,
    in their colour, with a count when several do; hovering names them. The
    dots are 8 px, so the rail marks and the header names;
  - a **column's header** shows small avatars of the others reading its
    thread: this is "seen by", naming only others, and nothing when you are
    alone;
  - the **composer** says "Bea is typing…".

  Presence is thread-level: every column of the root you are on reports the
  thread it shows. Columns of other roots report nothing, so a root's
  avatars, in the sidebar and on the board, are the people looking at it now.
  Which message someone has on screen waits until thread-level proves too
  coarse.

### Starting, branching, and stepping down

- **At the root, two ways to start**, because there is no context yet: a person
  declares a purpose. Both are on ＋, at the foot of the sidebar and on each
  board column. **＋ agent** opens a new tab whose column asks the agent
  unless a message names someone, so its first message creates the lane.
  **Conversation**, in its menu, opens a new tab whose column is a
  conversation.
- **A new tab is yours until its first send**, as any fresh column is. It sits
  at the end of the sidebar, labelled "new agent" or "new conversation", and
  closing it leaves no trace. Its first send makes the root, which joins
  the sidebar and the board: at the end of the first open state from your
  list's ＋, of its own state from a board column's (ADR-0122). Others find
  it on the board, and see you in it there.
- **An empty session** shows the board, with nothing in it, and ＋.
- **A page with nothing in the sidebar** (a first visit, or a list you
  emptied) opens on the board, which shows every root to open: nothing opens
  a root by itself (ADR-0030).
- **`→` in a message's right margin opens a branch** as a column to its right,
  empty until something is sent there. What it opens appears to the right, so
  the button sits on that side. A branch starts as a conversation; `@agent`
  there makes it agent work. **A branch from agent work starts with `@agent `
  typed**, so going on with the agent is one Enter away; alone it sends
  nothing, and deleting it makes the branch a conversation.
- **At an agent thread's end, `→` opens a branch too**, the same as on any
  other message: with `@agent ` kept, the agent's work forks there; with it
  deleted, a conversation steps back down from the end, reading everything
  above. The agent thread's column keeps following its lane. At a
  conversation's end `→` is hidden, since it would be the same as replying.
- Every one of these only opens a column. Nothing is written until the first
  send, and closing the column first leaves no trace.

### Messages

- The speaker's name heads each human message; the agent's messages are marked
  as the agent's.
- **Tool calls are rows under the agent's message** (ADR-0107): what the call
  touched (`packages/core/tree.ts`, `pnpm test`), and what it returned. The
  tool's word is a tag at the row's top right, apart from what it touched:
  "shell", "read", "search", "ask" (ADR-0114), with ✓ or ✗ beside it once
  the call ends. The model still calls its tools by their ids (`bash`,
  `grep`). A shell command is highlighted, its commands, options, strings
  and variables told apart, and a long one-line chain is laid out a step a
  line. A result is its own entry in the tree, but it belongs to its call,
  so it adds no message and no row on the rail.
- **A row shows its summary until you ask for its detail** (ADR-0123): the
  command's first five lines and the output's last five, a very long line
  cut short. Below them, a button says what they leave out, "+3 lines ·
  +335 lines of output", and shows it all; in the detail it says "less". A
  row that leaves nothing out has no button. The row spans the column, as
  far from its right edge as from its left.
- **An image a tool read is drawn in its row** (ADR-0051), in place of the
  caption ("Read image file [image/png]"), which is its tooltip. A tall
  one shows 10rem tall, and its row's button, "full size", shows it whole;
  a click on the image opens it in the pane (ADR-0078), Cmd- or Ctrl-click
  in a new tab.
- **While the agent works, its column shows it live**: the reply as it is
  written, and each running command's last five lines of output in its own
  row. Each becomes the committed message or result in
  place, and a column at its end does not get shorter while the agent works
  (ADR-0044).
  **stop**, the queue header's button, ends the turn, and records who
  pressed it under the ask (ADR-0106); cards queued are then held, until
  someone presses **send queue (n)**, or sends a message there (ADR-0048
  step 7, ADR-0113). Once it has stopped, **resume** takes its place (in
  the header's ⋯ while the queue is held): it starts a new turn with a
  message from the host, "↻ resumed by <name>" (ADR-0082), until anything
  else is written at the thread's end.
- **A column says what its agent is doing** (ADR-0054), and none of it moves
  the column. While the agent works, the mark before the thread's name in the
  header (its `✦`, or its banner, ADR-0053) pulses, titled with the ask it
  works on, "the agent is working on Ada: "Fix the rail…"" (ADR-0106). In
  outline, the running ask's own line pulses instead of accepted work below. A
  short line pulses at the
  end of the column, centred, where its next text will appear. While a
  command that has run for half a second is still running, its row is
  outlined instead, with how long it has run beside its tag ("12s",
  "1m 05s"), and accepted work hides: the wait is the machine's, not the
  model's. A quicker command changes neither.
- **A root shown again draws its tool rows as they were left** (ADR-0123):
  a running command's row outlined, a row whose detail you opened or folded
  the same way.
- **Pasting an image into a composer puts it in the message** (ADR-0042).
  It is uploaded as it is pasted, and its markdown, `![name](/blob/…)`, goes
  in where the cursor was; the send button reads "uploading image…" until
  it is done. Sent, the message draws the image at its stored size, capped
  at the column's width. A click opens it in the pane, fitted to its width,
  where a click on it shows its own size and **open in a new tab** shows it
  alone; Cmd- or Ctrl-click opens a new tab at once. The agent is
  given the image itself, after the text. An image no longer stored refuses
  the send, and the text comes back to the box.
- **A table in a message has a bar above its right edge, always shown**
  (ADR-0078). Its ⤢ ("open the table beside the thread") opens the table in
  the pane, where it scrolls both ways under its pinned header row, titled
  by its header cells; pressed again ("close the table"), it closes it. In
  a reply still being written it waits ("the reply is still being
  written"). A table keeps its words whole, and one wider than the column
  scrolls sideways in it.
- **A message's tools are one row** over its top right, shown on hover or
  focus (ADR-0043): *copy* first, then *edit*, and `→` last, in the
  right margin, since what it opens appears to the right. Copy puts the
  message on the clipboard as markdown: its text as it was written, then
  each tool call it made, its tool's word and the command or path, and its
  whole output. It
  shows a check for two seconds; over plain http, which has no clipboard,
  it selects the message's text and tool rows for you to copy. Beneath a message stay only the
  buttons of branches no column shows.
- **Edit sends a person's message again, changed or not**, as a sibling: a
  branch at its parent whose composer holds its text as sent. The original
  stays. It asks the agent exactly when the original did, so a message its
  thread's default sent to the agent starts with `@agent`. Anyone's message
  can be edited, and the edit is the editor's. On a root's first message,
  which has no parent, the tool is *new tab*: a new tab holding its text, an
  agent's when the message asked the agent. An agent's reply offers no edit:
  that would be a reply the agent never gave.

### A card's frame (ADR-0111)

- **Every text card is drawn in one frame**: a header, its box, and a
  footer. The header is what you drag it by. Its icon says what kind of
  card it is (✎ a text card), and it says where the card is (your message,
  note, queued, pinned, inventory), how it
  stands ("next", "held · 2nd in line", "not sent: …", "changed since the
  agent last read it"), who put it there, and its command's chip; then ⋯
  and ×. The footer holds ↑ and ↓ in a list, and at most one primary
  action, filled in the card's colour: send on your message, put in your
  inventory. A note has none, and a queued card none: the queue's controls
  send it.
- **Its colour is its place**, which says who reads it: your inventory in
  your colour, your message and notes neutral, queued blue, pinned violet.
- **⋯ holds Move to ▸ and History.** Your message moves to the notes, the
  queue, pinned or your inventory; a note to your message, the queue,
  pinned or your inventory; a queued card to the notes, pinned or your
  inventory; a pinned card to the notes, the queue or your inventory; a
  card in a new branch to your inventory. Each is the move a drag makes there, and the
  undo key outside a box undoes it. A card in your inventory has none
  there: put, × and a drag move it.
- **Before your composer's first keystroke**, and in the box "+ pin" opens,
  the frame says only where the card will be.

### Your message and notes (ADR-0048, ADR-0113)

- **What you type in a composer is your message**, a card on its thread
  that only you see. The first keystroke worth keeping (anything but a
  branch's `@agent `) makes it. It belongs to the thread, not the column:
  switching roots, reloading, closing and reopening the column, or the
  host restarting, you find it where you left it, and it follows the
  thread as the thread grows. A new tab's or a new branch's card belongs to
  its column until its first message is sent. Others writing at the
  thread's end show above it as "Bea is writing…".
- **A note is a card in a note column** (ADR-0116), which everyone in the
  task sees and anyone can type in; no agent reads it. A **note column** is
  a column of the task's: a title ("Notes" until someone renames it, from
  its header, for everyone) and its notes one under another, each folded to
  its first line until you click into it, headed "Ada's note · with Bea".
  ↑ and ↓ on a note, or Alt+↑/↓ in its box, move it in the column, as a
  queued card moves; **+ add a note** makes an empty one at its end, the
  cursor in it; one left empty is swept when the host next starts. It sits
  on the canvas in its place, folded until you open it, and moves and
  folds as a thread's column does. **+ note column** in the task column
  adds one first on the canvas, and a column's ⋯ adds one after it.
- **A card leaving a thread's queue or pinned strip goes to the note column
  nearest the thread**, in the task's order, the one after it on a tie;
  with none, a note column titled "Notes" is made just after the thread.
  So does your message's **Move to notes**, a card the host could not send,
  and a card put or dropped on a thread's column. A card dropped on a note
  column is a note at its end. Dropped on the composer a note becomes your
  message, and a message there with text takes the note's place, in one
  move the undo key outside a box undoes; an empty one is discarded. In a
  new branch, a message with text takes a card only from your inventory
  ("not moved: your message here holds text").
- **Marks say where you left something unsent** (ADR-0048): a small dot in
  your colour on its root's item in the sidebar, and on the rail at its
  thread's end, whether or not that thread's column is open. A root you
  closed is marked on ▦ and its thread card; an archived root only on its
  thread card, since its work is done. A note you own marks its task, not a
  thread's end. Only your own message and the notes you own count, and only while they hold text: emptied, sent or
  discarded, the dot goes. A bare `@agent ` is nothing typed.
- **Sending spends the card.** The box stays as it was until the host
  answers: written or running, the card is gone and the box empty; a
  conflict or a refusal leaves the card, so nothing is lost or put back.
- **A send to a busy thread queues your card above the line** (ADR-0048), as
  does a card with a command, even on an idle thread. Every move shows at
  once and is the host's to make (ADR-0059). A queued card is drawn
  in the column's dock, headed by its place in line ("next",
  "2nd in line", "held · next" while the queue is held) and "queued by Bea",
  with its command's chip when it has one; its ⋯'s **Move to notes**
  unqueues it. Anyone here
  can edit it until the host pops it to send it, when the lane is free, in
  order. An unqueued card goes back below the line, a note. Unqueue a card the host
  had already popped and your column says "already sent as Bea's message,
  before you unqueued it". A move someone else made first is undone on your
  screen, saying "not moved: Bea moved it first". A card the host could not
  send is back below the line saying "not sent: …" until it is queued again.
- **The queue's controls are its header's** (ADR-0048 step 7, ADR-0113),
  on any thread with an agent: **send queue (n)** releases a held queue;
  **hold queue**, **release hold** and **unqueue all** are in its ⋯. While
  the queue is held nothing in it is sent, so you can line up several steps on a
  quiet thread and let them go together. Notes the thread will read (a
  fact, ADR-0080) still go. **Sending removes the hold** (ADR-0113): on an
  idle thread whose queue is held, your send button reads **send all (n)**,
  and queues your message last and releases the queue in one step. On a
  running thread a send waits in the held queue. Unqueue all puts every
  queued card below the line at once, and the undo key outside a box puts
  them back.
- **× on a card discards it** (ADR-0111), wherever it is: your message, a
  note, a queued or pinned card, or the selected card in
  your inventory; so does Ctrl+Shift+Backspace in its box. Where you did it,
  the column says "discarded · the undo key (⌘Z outside a box) brings it
  back", and the undo key does, for a week; then the host deletes it.
  Discarding someone else's card leaves them a trace, as a move does.
- **↑ and ↓ on a queued card, or Alt+↑ and Alt+↓ in its box, move it one
  place in line**; the box keeps its caret. A card never passes a note the
  thread will read. A move the queue overtook says "not moved: the cards
  around it changed first".
- **A card someone is typing in waits.** The host does not send the next
  queued card while someone types in it, and sends it a few seconds after
  they stop.
- **Cmd+Z in a box undoes only that box's card**, never anything in another
  column or tab (ADR-0052). After you undo past a card's first keystroke,
  the box is empty but keeps its card, and Cmd+Shift+Z there brings the text
  back.
- **Cmd+Z and Cmd+Shift+Z** undo and redo your own typing in a card, never
  someone else's. Each tab has its own history, which a reload forgets.
- **Closing a new branch that holds text asks** "keep what you typed in your
  inventory?": **keep in inventory** (focused, the default), **discard**,
  which the undo key reverses, or **cancel**. Keep moves every card in the branch with
  text into your inventory, and closes the branch once each is there; with
  too few empty slots it says so ("not kept: needs 2 slots, 1 free") and the
  branch stays open.
- **A new branch's first message** leaves any other card in it as a note
  below it.

### Pinned cards (ADR-0048 step 5)

- **A pinned card says what a thread is for**, and the agent reads it on
  every run. It sits in a strip at the top of the thread's column, under the
  header, and stays there as the messages scroll. A new tab or a new branch
  has none until its first message is sent.
- **Move to pinned**, in your message's, a note's or a queued card's ⋯,
  pins it; so does dropping a card on the strip: while you drag a card, a
  thread with no pinned card shows "drop a card here to pin it for the
  agent" there. A pinned card's **Move to notes** puts it back below the
  line, **Move to the queue** queues it, and **Move to your inventory**
  takes it. Each is a move the undo key outside a box undoes.
- **"+ pin" writes a new pinned card**: in the column's header while the
  thread has none, at the end of the strip once it has one. The box it
  opens pins what you type from the first keystroke; Enter is a new line,
  and Escape or clicking away closes it.
- **↑ and ↓ on a pinned card, or Alt+↑ and Alt+↓ in its box, move it among
  the thread's pinned cards**: the agent reads them in that order.
- **Anyone here can edit a pinned card**, as a queued one. Each is headed
  "pinned by Bea", and shows its size, "~120 tokens", since a long one costs
  that on every run, and how it stands: "read by the agent", "changed since
  the agent last read it", or "not read by the agent yet".
- **Where a run read them**, a small "the agent read 2 pinned cards" sits
  above its prompt; it opens to the text the agent read, and to "no longer
  applies: “…”" for a card unpinned since. A card edited just before you
  send reaches that run.
- **A branch starts with no pinned cards.** Its agent is told its parent's
  no longer apply, quietly: the branch's column shows nothing for that. To
  keep a direction, take a copy of the card into your inventory and pin it
  in the branch.
- **Pinned cards are not unsent work:** they mark no item in the sidebar and no rail dot.
- **Pinned to the task**, a card is read by every thread's agent in the
  task, after the thread's own. **Pin to the task** in a card's ⋯ puts it
  in the task column; unpinned, it goes to the nearest note column. A run
  that read them says so above its prompt, as for a thread's.

### History and traces (ADR-0048 step 6)

- **Every card's ⋯ has History.** It lists, in the card, where the card has
  been and who moved it, oldest first: "created by you", "queued by Bea", "unpinned
  by Carl (an undo)", then "written by you, Bea".
- **A card someone else moved back below the line says so** in its
  header: "unqueued by Bea", "unpinned by Bea", until it moves again.
- **A trace stays where your card was** when someone else moved it while you
  had no column open on that thread: "Bea queued this", "Bea sent this →",
  "Carl took this", or "3 cards moved by Bea". Only you see your traces.
  Click one to go to the card where it is now, or to the message it became.
  A trace is gone once you have seen it, on every device; the column keeps
  showing it until you leave. An unqueue or an unpin leaves no trace: the
  card is still in your column, saying who moved it. Nor does a note: a
  note column is everyone's scratch.

### Your inventory (ADR-0048 step 4)

- **A panel of your own, floating over the columns**, opened and closed by
  **inventory** in the footer (which counts your cards). It sits in the
  middle of the screen by default; drag its top bar and it settles left,
  centre or right, and this device remembers where. Only you see it, on
  every root and device; nobody else can move a card into or out of it.
- **A fixed 3 × 6 grid of cards**: each slot shows
  its card folded, its first three lines under its author's circle; the
  first nine are numbered 1–9. A thread's card takes one slot, drawn so it
  is known at a glance (ADR-0124): its banner and name, its first line,
  the first line of where it ended, and whether it stopped or has cards
  queued. Opened, it shows the thread's path read only, with no composer,
  queue or run, and **put** puts it on the canvas you are on, after the
  column you were last in. Only its holder opens it: a link to it anywhere
  else says "Bea has it". Click a slot, or move with the arrow keys or
  `hjkl` while the panel has focus, to select it: beside the grid, on the
  side away from where the panel is docked, its card is previewed, one
  column wide and read only (ADR-0126). Enter, or a click on the card
  already selected, opens it whole in place, over its neighbours, and
  editable, the preview hidden while it is open, and Escape folds it. Cards keep their slots, gaps included, on every device.
  Dropping a card on a slot that holds one swaps the two, and so do
  Alt+arrows.
- **Take** moves a card into your inventory (a *take into the inventory*,
  ADR-0083): Ctrl+Shift+I in its box, **Move to your inventory** in its ⋯,
  or a drag of its header onto the panel. It lands in the selected slot if that is empty, else the first
  empty one, and flies there; a take into the inventory while the panel is
  closed shows it briefly. Full means full: the nineteenth card is refused
  with "inventory full".
- **Taking from the past** (ADR-0126): a message's **take**, a table's ❝,
  or Cmd+C outside a text box, takes a *reference*, a card naming the
  message, the table or your selection in it, with its quote, and puts its
  markdown on the clipboard. The past never changes, so the reference is
  the copy. It shows as a chip; selected, its quote; opened, its quote and
  thread, and **Edit as text**, which makes it a text card you can change,
  in its place, one undo. Put with the put key, it stays in your hand and
  a new one lands; in a text box, it is a link, which opens what it names.
  The agent reads each linked message, table or quote under the message
  that links it.
- **Put** moves the selected card to the notes of the column you were last
  in: Ctrl+Shift+O, the panel's **put** button, or a drag out
  of the panel onto a column: a note in the note column nearest its thread,
  or, onto a note column, at its end. Dropped on a
  composer, it becomes your message there. Held over a root in the sidebar,
  a drag opens it. The open card's **×** discards it; the undo key brings
  it back.
- **Undo a move** with Cmd+Z (Ctrl+Z elsewhere) while no box has focus;
  Cmd+Shift+Z, Ctrl+Shift+Z or Ctrl+Y redo it (ADR-0066). It undoes your
  newest move in the root you are on, from any of your tabs, after a reload
  or a restart too. As it acts it shows where the card went back: the
  panel, the thread's column, or a branch you closed since, opened again at
  the end of its root's columns. If anyone moved the card since, it is refused, saying
  who, and nothing moves. A keep of a branch's cards is undone whole. Sends
  and copies are final; so is a keep that closed a new tab, whose
  cards you take back from the panel. An archived root's moves cannot be
  undone, and are forgotten 7 days after it was archived.
- **Undo a swap** with the same keys while the panel has focus: this tab's
  newest swap goes back, unless those slots have changed since.
- **A refusal is said where you acted**: in the panel for a take into the
  inventory, in the
  column you aimed at for a put, and where an undo showed.

## What goes away

| today | replaced by |
|---|---|
| "follow the newest" | columns grow on their own; there is no hidden anchor |
| "reading a thread · sending replies here" | every column's composer sends at its own path |
| "make this a conversation" in a bar | nothing: a thread's mode is whether the agent works in it (ADR-0021) |
| "⑂ 1 branch · 2 messages" with a hidden list | the rail, and a coloured fork dot in the column |
| "switch to this path" (`navigate`) | nothing: sending attaches where you are reading |
| every tree in one rail, one after another | one root at a time, with its own rail (ADR-0029) |
| a column on another root, with no stripe and no fork dot | nothing: the columns you see share their root |
| the rail's `+`, and Start Chat and Start Agent in place of a composer | ＋: agent, or conversation |
| a tab bar shared by everyone, with no close for yourself | the sidebar, yours on every device, with **×** (ADR-0030, ADR-0122) |
| a new root by anyone appearing as a tab | the board shows it, and who is in it; you open it (ADR-0122) |
| the Archive tab, and the header's people | the board: every root in a workflow state, Done the archive (ADR-0122) |

The last row mattered for `PLAN-2026-09-26-thread-lanes`: with no control moving
a lane, the `navigate` command had no caller and was deleted with `prompt` and
`branch`. Lanes now never move at all (ADR-0120).

## Data

Every part of this is a read of what the document already holds, except the
board's records (ADR-0122); a card's text is its own document (ADR-0048).

- **A column** shows a thread (ADR-0117). Its path is `projectTranscript` of
  the thread's end (`threadEnd`); the part after its fork point is the
  suffix below the column to its left.
- **The rail** is the tree itself, from `parentId`, drawn in id order, which is
  creation order (uuidv7).
- **A thread's mode** is its lane; **names** are `pinetrie.participant` values.
- **A root** is a root of the tree index (an orphan counts as one). **Your
  list** is your own document (`open:<you>`, ADR-0122), each root's id to an
  order key, written only by your tabs: the roots in it that are not
  archived, plus the root you are on.
- **The board and the footer** read presence (people, and the thread each
  is in) and the lanes (the agent's running threads). **Mentions of you** are the chats whose
  mentions `address` resolves to you. **What you have seen** is kept in your
  attention document (`attention:<you>`, ADR-0077), on every device of
  yours: an entry id (`mentionsSince`), at or before which every mention is
  seen, and the ids of later ones you have seen.
- **The board** is two host-written records (ADR-0122): the workflow
  (`pinetrie.workflow`, the open states in order, then the archive) and each
  root's place (`pinetrie.board`, by its id: its state, its rank there, who
  moved it and when). A root in the archive is archived; the host
  refuses commands that would write in it (ADR-0029).
- **Which task you are on, each task's view (which of its columns you
  unfolded, how each reads, your branches not yet sent), new tabs and
  whether the board is open** are view state, kept in the browser per
  browser tab, with
  the device's latest for a new one, and never in the document (ADR-0027,
  amended by ADR-0029, ADR-0030 and ADR-0122).

## Deferred, but designed for

- **What else a canvas holds** (ADR-0116): file cards showing a source's
  file, and media. Threads from any root and note columns are built
  (above).
- **What is left of cards and the dock** (ADR-0111, ADR-0113): a thread
  card's body on the board drawn from its pinned cards' first lines (today
  its first line, under a title); and who is in a note column now, which
  needs a presence field of its own.
- **Narrow screens**: the stacked sequence described above, with the sidebar
  collapsed to each root's banner (ADR-0050, ADR-0053) and the footer to ▦,
  what needs you and you (ADR-0122); built after the wide layout works. The
  column's pane is its first step (ADR-0078): over a narrow window it covers
  the page, and ← goes back to the thread. Below 56rem the sidebar narrows and
  the strip shows its first states only.
- **What's new since you looked** (ADR-0030 defers it): a last-read position
  per root gives unread marks on the sidebar's items, a "3 new" count on ▦, and a
  "what's happening" panel listing roots by activity. It can reuse the
  inbox's storage and its rule for "seen".
- **The inbox, grown:** **done** to take a handled mention off it; browser or
  system notifications, which need permission. (How runs end, work ready,
  and one inbox per person on every device came with ADR-0077 and
  ADR-0091.)
- **The review, grown** (ADR-0047): side-by-side diffs; a review of one turn,
  its revision record's commit, through the same URLs; "ask about this" on a
  hunk, which puts its path, line and quoted lines into the column's
  composer; the agent's edit tool rows drawn as diffs, if pi's results carry
  them. (On narrow screens, the review is one more step already: the pane
  covers the page, ADR-0078.)

## Settled while planning

1. **Columns keep a readable width** (28rem); when they overflow, the strip
   scrolls horizontally.
2. **A branch opens next to the column it forks from**, so its colour link is
   short to follow.
3. **Unread tracking** needs a per-person "last read" position. That is presence
   state, so it arrives with presence; until then the rail shows activity only.
4. **Columns scroll independently.** A shared vertical scroll kept every branch
   level with its fork point, but could not show forks far apart together, and
   its connector lines crossed sibling columns.
