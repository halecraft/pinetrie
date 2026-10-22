# Interface: the sidebar down the left, columns for reading, a rail for shape, a board for everyone

The backend holds a conversation as a tree, with people and agents in it
(ADR-0018). The first interface drew that tree as a chat list: one path, with
every other branch reduced to a "⑂ 1 branch" marker. That was honest about
context (T) but hid everything else (E), which is the product. Play-testing it
also showed two controls that confuse people:

- **"Follow the newest"** appeared after your first message, though you had not
  gone anywhere. It showed internal state (the client remembering which thread
  you read), not a choice you made.
- **"Make this a conversation"** changed a rule without showing where the rule
  starts, or saying what it does.

This document says what the interface is now. It draws E and T directly.

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
│▎Fix the sync ││ 🔍   ││ Ada                    ││▌from Ada: "Say…" (blue)│
│              ││ ●    ││                        ││                       │
│▎bug ◉ (B)    ││ │    ││ Say exactly: OK  ●blue ││ Bea                   │
│ Release notes││ ├──● ││ agent: OK              ││ an aside              │
│ Q3 planning ·││ │  │ ││ Ada                    ││ agent: …      ●green  │
│              ││ │  ● ││ Ada: @Bea have a look →││ Bea                   │
│ ＋ canvas    ││ ◉    ││ Ada: @agent … ◉replying││   what about X?       │
│              ││      ││ ┌──────────────────────┐││ ┌───────────────────┐ │
│              ││      ││ │ send to agent…  send │││ │ reply in thread…  │ │
│              ││      ││ └──────────────────────┘││ └───────────────────┘ │
├──────────────┤└──────┘└────────────────────────┘└───────────────────────┘
│(A) Ada ✉2 ▣1│ ▦ Board · Topics 3 · Active 3 ◌2 ⇡1 (B)(C) · Archive 41  publish
└──────────────┴──────────────────────────────────────────────────────────────
```

There is no header: the columns start at the top of the window, but for a
search's bar while you search (below). The page's
one row of chrome is the footer, and it splits where the sidebar's edge does:
under the sidebar, what is yours; to the right, what is everyone's (ADR-0122).

### The sidebar: the canvases you have open (ADR-0030, ADR-0045, ADR-0077, ADR-0122)

Down the left edge: the canvases you have open, in your order, then ＋. It is darker than the page, and the canvas you are on is the page's
colour, with a light edge on its left, and opens into the rail and columns
beside it (ADR-0081, turned sideways).

- **The canvas you are on shows its canvas**: its rail, and its columns
  (ADR-0116, below).
- **The sidebar is yours, on every device of yours**: your own document, which
  only your tabs write. Top to bottom is your order. Opening a canvas adds it at
  the bottom; drag an item to reorder: dragged over another, it goes above
  or below it, never into it, and opens nothing. **×** closes a canvas for you and
  writes nothing shared; opening it again brings its columns back. A canvas
  you start joins the sidebar; a canvas someone else starts does not, and
  reaches you through the board or your inbox.
- **An item's label** is the canvas's title, else its first root's first
  message's first line, wrapped to two lines before it is cut; a canvas only
  people have written in, untitled, is **Chat**. When the agent is first
  asked in a canvas with no title, a model titles it in one to three words
  (ADR-0074).
  **Rename** in the item's `⋯` turns the label into a field: Enter or
  leaving it saves the title for everyone, Escape cancels, and an empty title
  brings back the first line. **Retitle from the conversation**, beside it, asks the
  model again from what was said in the thread, and replaces the title for
  everyone. A title is a mark on the canvas (ADR-0045), and names the canvas
  wherever it is shown: the sidebar, the board, your inbox.
- **An item shows what happens in its canvas while you are elsewhere**
  (ADR-0077), before its label: a still blue ring while the agent works
  there, cards wait to be sent to it, or it is finishing its summary, which
  needs nothing from you (cards behind a held queue wait for a person, and
  draw no ring, ADR-0113); a filled
  amber dot when something there needs you, which pulses three times as it
  arrives and then stays still; a red dot when changes there conflict and an
  amber ring when they are ready to accept, which pulse as they arrive too;
  a dim amber dot when something is worth a read; and, when a run you
  follow ends with nothing to do, a ✓ that fades.
  Its title says why ("needs you: asks whether to drop the v1 table",
  "changes conflict with accepted work"). The mark is the highest of its
  threads' statuses raised for you, in one order with a column's dot
  (ADR-0198), so what needs you shows over a thread at work.
  Reading the thread to its end, on any device of yours, clears it; work
  ready to accept clears when it is accepted, or with **Dismiss** in the item's
  `⋯`. A page that loads draws every mark still: only a change you see
  moves. After the label, small avatars of the others reading there, and a
  small dot in your colour when the canvas holds something you typed and have
  not sent.
- **Move to ▸** in an item's `⋯` moves the canvas on the board, for everyone
  (below). Moved to the archive, it is archived: the item says so
  ("archive: read-only for everyone until moved out"), is disabled while
  the agent works in that canvas or cards are queued there, with the reason,
  and names the threads whose proposed changes it withdraws from your repo ("work not
  accepted goes: amber-fox"); moving it out builds them again
  (ADR-0061). **×** is for putting a canvas away yourself.
- **Archiving closes it for you** once the host accepts it, as **×** does,
  showing its neighbour below, else above, else nothing.
- **If someone else archives the canvas you are on**, it stays while you are
  there, read-only, saying who archived it, with **Restore**. It leaves your
  list when you switch away.
- **`⋯` and ×** show while an item is hovered or focused, the one you are on
  too, over the label's end.
- **＋ canvas**, at the foot of the sidebar, makes a canvas, with no menu
  (ADR-0158): its first thread opens with `@agent ` typed, so its first
  message decides whether it is a chat. What it does is under "Starting"
  below. A board column has its own ＋ canvas, which lands the new canvas in
  that column's state.
- **The sidebar folds to icons** (ADR-0088), about 3rem wide, from **«** at
  its foot or Ctrl+Shift+L; **»** shows its titles again. Which you chose is
  this browser tab's, and a new tab starts from your latest. Until you
  choose, a window under 56rem shows icons. Nothing folds it by itself.
  - **An item's icon** is the icon of its canvas's earliest thread that has
    one (ADR-0143), else two initials on a colour seeded by the canvas's id
    (ADR-0089): "Kanban outside click" is **KO**, "Sidebar" is **SI**.
    Under built-in icons every named thread has one, so initials show only
    for a canvas whose threads have no names yet.
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
the machine's health, then publish. Your inbox carries the page's only
badge: one place asks you for something, the other reports.
While the page syncs, "syncing…" leads its right end.

- **You:** your avatar and name open a menu headed by who you are: your
  avatar, your name and your email. Folded, it lists **Inbox** with its
  badge and **Inventory** with its count (**Close inventory** while the
  panel is open); choosing **Inbox** shows the inbox's sections in the same
  menu, under **← back**. Then **Profile**, which opens your profile page
  (Pages, below), **Setup**, which opens what the host read of its config
  (Pages, below), and **Sign in as someone else**, which forgets who this
  device says you are and asks again (ADR-0037).
- **Your inbox** (ADR-0030, ADR-0077, ADR-0091), beside you: one menu of
  what needs you, its trigger a tray icon named **Inbox** and what needs
  you ("Inbox · 2 things need you: …"), drawn even with nothing in it. Its
  amber badge counts what the threads you follow need from you (a run that
  ended asking something, failing, or that no one could tell; work ready to
  accept) plus the mentions you have not seen; the page's title carries the
  same count, before the canvas you are on: "(2) Fix the sync bug · pine·trie".
  Its sections, each shown only with rows: **Needs you** (each thread's
  reason, in amber), **Ready to accept** (threads you follow with open
  proposed changes), **Worth a read** (listed, not counted) and **Mentions of you**.
  It lists exactly what it counts. Each thread's row opens it; under each,
  **Dismiss** clears it on every device of yours, until the next run's
  end or new work. You follow a thread once you have written on it; threads
  you do not follow raise nothing for you.
- **Mentions of you**: the messages that mention you, newest first, each
  with who, the thread, and the start of the message. A row opens that
  thread in the sidebar, with a column on the message, archived or not. The
  badge counts the mentions you have not seen. One is seen when you open it
  from the inbox, when it is drawn in a column of the canvas you are on, or
  when you **mark all seen**. A seen mention stays in the inbox; a filter
  shows only the unseen.
- **The inbox is yours**, the same on every device of yours (ADR-0077). You
  start from your first load, with no backlog.
- **Your inventory** (below): a box icon beside your inbox, with its count
  when it holds cards, titled "your inventory: 1 card"; in the account menu
  while the sidebar is folded.
- **The board's strip**: ▦ **Board**, then each workflow state's name and
  count, avatars of the people reading in its canvases, an amber dot when a
  canvas there needs you, and, only when there are any, **◌n**, its canvases the
  agent works in, and **⇡n**, its canvases with changes ready to accept (ADR-0091).
  Those two are facts for everyone: never a badge, never moving. While the
  board is open, the board's search and **mine** take the states' place,
  since each column's head shows the same (ADR-0115). ▦ carries
  the highest mark of the canvases not in the sidebar, a dot in your colour
  when one of them holds something you typed, and a blue ⌕ while a filter
  is on and the board is closed; its title is the session's
  message count, "2 in the canvases this tab has loaded, of 4 in the
  session": the messages in the roots this browser tab holds, of every
  root's. Nothing in the footer animates: the sidebar, the column, the rail
  and the board show where the agent works.
- **The machine's health** (ADR-0210): a machine glyph before publish, on
  everyone's side and drawn always, for the machine lanes run on (the lane
  VM on the Mac, Linux's own). It is the footer's grey while lanes and the
  host keep up; amber, with a triangle at its corner, when work slows (the
  lanes' disk low, the disk holding it low, lanes short of memory, a
  command killed for memory, the host stalling, or no reading from the
  host); red, with a barred disc, when work stops (the lanes' disk full,
  or its metadata). Shape and colour both, never colour alone; never a
  badge, never moving. Its title, which is also its accessible name, names
  the worst cause in words, with how many more ("The machine lanes run on:
  work is slowed: the lanes' disk is low: 6 GB left, 20 GB at least"). It is
  a status, not a control, until the Machine page it will open (Deferred,
  below). The host plans it from samples every few seconds, each cause
  entering and leaving by counts of samples so it does not flap, and writes
  it only when it changes, at its start and at its stop, so no tab reads a
  stopped host's (`packages/machine/TECHNICAL.md`).
- **Publish** (ADR-0104, ADR-0076, ADR-0090, ADR-0099): one button, no
  menu. **Accepted work** is where finished work goes (ADR-0100,
  `docs/glossary.md`); its bookmark (`accepted.bookmark`) is in titles only. Before accepted work
  exists, any host shows **set up**, which opens what it writes: the
  bookmark it makes at your `@-` and the exact `immutable_heads()` and
  `revsets.log` text for your repo's config (the log, so jj and jjui show
  the proposed changes), and what to add to a jjui revset of its own
  (`docs/the-jujutsu-repo.md`), done only when you choose it. After,
  **publish** shows only while there is something to publish, and does it
  in one act, the same whoever presses it and wherever the host listens:
  - with `publish.catchUp` on, the working copy gets the latest from accepted work
    (`jj rebase -b @ -d <accepted>`, as you) when they are behind; your
    commits below `@` are accepted; then `main` (`publish.bookmark`) moves
    forward to accepted work. Your commits and `main` move together in one
    jj operation;
  - with it off, the default, only `main` moves, as the host. No one's
    files move.

  Its title says what it will do, with how many files getting the latest
  changes and any other line of your work that moves with it, or, with
  the setting off and the working copy behind or commits waiting, that the
  working copy does not move (`publish.catchUp` is off), then the jj commands. It
  does not push. What can be checked first is (`main` holding commits
  accepted work lacks; with the setting on, the working copy's conflicts and what
  getting the latest would conflict), and the title leads with why it would be
  refused.
  If your commits come out of getting the latest conflicted, or the move fails,
  getting the latest is reverted (`jj op revert`): nothing is left half done.

  While a publish is out the button reads "publishing…". A refusal or a
  failure is a **toast** above the footer ("not done:" and why; "it
  failed, and may be part done:" and why), until you dismiss it or send
  another. A conflict in the working copy is said, and left to you, in jj
  (ADR-0102).
- **A menu you opened stays open until you close it.** The footer's and the
  board's avatars and counts come from live data, but when what one stands
  for goes while its menu is open (a person leaves the canvas, the last thing
  in a section of your inbox is dealt with), the menu says so ("Bea has
  left", "Nothing left to accept.") and its trigger stays until you close it
  (principle 6). Escape closes a menu open on the board, and then the board.
- **Nothing opens a canvas by itself.** A mention is a notification: you
  choose to open it.

### Pages (ADR-0098)

A page covers the stage: the sidebar and the footer stay, and the
stage stays as you left it under the page. It opens with **← back** and
its title. Back, the browser's Back, and choosing a canvas, a new canvas, ＋, ▦
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
- **Setup** (ADR-0146), from the same menu, under **Profile**: what the
  host read of its config, the same for everyone, with nothing secret in
  it.
  - **Model**: the model and where it came from ("from
    ~/.config/pinetrie/pinetrie.json", "from $PINETRIE_MODEL"), or, in
    amber, why there is none and what to do ("no config names one: set
    model, as provider/id"; "… has no credential: pinetrie sign-in anthropic").
  - **Sign in**: each provider with a credential and where it is
    ("signed in (auth.json)", "from an environment variable"), never the
    credential, and the `pinetrie sign-in <provider>` line.
  - **Config files**: each layer's file, "(none)" when it is missing, the
    local one named with its session and that session's folder, and
    what it refused, in amber: a key no setting has, a key that layer may
    not set, a value that is not taken.
  - **Settings**: every setting with its value and where it came from;
    hovering one says what it is. A setting added later shows here with
    no page of its own.
  - **Skills, prompts and packages**: a listed package that is not a
    folder, then every command.
  - **Context files**: the files the model is given, `AGENTS.md` and the
    like: pine·trie's own and those inside the project.
- **A send that needs a model the host has not** is refused in the
  composer: the button reads **no model**, its title why, and **See Setup**
  beside it opens the page. A send to people needs no model, and is sent.

### The board: where everyone's work stands (ADR-0122)

▦, or a state in the strip, opens the board over the columns, from the
footer's edge: it moves none of them. ▦ again, Escape (once a filter is
cleared), or a click outside it and its strip closes it, and so does choosing something to work in. Whether it is open is this browser
tab's; with nothing in the sidebar and nothing you are on, it opens by itself.

- **Every canvas on the board is in one workflow state.** Each open state
  is a column of the board, in order; the archive is last. A new session
  has **Topics**, **Active** and **Archive** (ADR-0158).
- **Two open states are marked** (ADR-0206): one is marked Topics, where a
  new canvas from the sidebar's ＋ starts and Restore puts an archived one;
  at most one is marked Active. The mark is the state's: renaming or
  reordering the state keeps it, so a team that moves Topics to the right
  still starts canvases there. A new session marks Topics and Active.
- **Where a canvas is says what it is** (ADR-0158, ADR-0206): in the state
  marked Topics a **topic**, there so teammates find it; in any other open
  state a **task**, its work tracked; in the archive, archived. Nothing is
  stored. A canvas whose state is gone is drawn at the end of Topics. The
  canvas column says it ("a topic, in Topics"), and so does a sidebar
  item's hover.
- **An agent's first work moves a topic to Active** (ADR-0206): when an
  agent's run starts in one of its threads, a canvas in Topics whose state
  has never changed goes to the end of Active, as the host's own move, in
  nobody's undo. A run resumed as the host starts does not count. Any move
  between states, a person's or this one, means the host never moves that
  canvas again: put back in Topics by hand, it stays there until someone
  moves it out. An undone move never happened, so it does not count.
- **A canvas card** (ADR-0111, ADR-0126) is a canvas, on the board and in the
  sidebar alike: its header, the same in both, shows its label, its status
  (with the agent's ring in any canvas, opened in this browser tab or not), a
  blue **⇡** for everyone when a thread of it has changes ready to accept (its
  title names the threads; the thread's followers have it in their inbox),
  and a dot in your colour when it holds something you typed. On the board,
  a titled canvas's first line is its body, and its foot shows who wrote in
  it and the others reading there: each reader's avatar is a menu of the
  threads they read there, a row of which opens that thread in the sidebar.
  Selecting the item opens the canvas in the sidebar and shows it.
- **Anyone moves a canvas, for everyone**: drag an item to another column, or
  before another item, or use its `⋯`'s **Move to ▸**, **Move up** and
  **Move down**. Dropped on your
  list, it opens there. Nothing moves a canvas by itself: proposed changes ready, or a
  run that needs you, is a mark, never a move. A move from a state the canvas
  has left is refused, naming who moved it and where ("not moved: Bea moved
  it to Active first").
- **A column's head** shows the state's name, its count, the readers'
  avatars of its canvases, its highest mark, and, only when there are any,
  **◌n** and **⇡n**, as the strip's button does (ADR-0115).
- **One search for the whole board** (ADR-0109, ADR-0115), in the footer's
  strip while the board is open, with **mine** (the canvases you wrote in),
  filters every state in place: a canvas is kept when its label holds every
  word typed, in any order (labels, not every message, which would load
  every root, ADR-0063). The states keep their places and the items their
  order. While a filter is on, each head's count says how many it shows
  ("12 of 96"), its ◌, ⇡ and readers count those, and the count and the
  field's border are blue; its mark, Remove's refusal and the strip count
  every canvas. A banner at the board's foot names the filter ("Filtered by
  "parser" and mine: 14 of 140 canvases") with **Clear**, which lifts the words
  and mine; the field's **×** clears only the words. Move up and Move down
  step among the items shown. Opening the board with ▦ or a state's button
  focuses the field; the board opening by itself does not. `/` focuses it
  while the board is open; Escape clears the filter before it closes the
  board. The filter outlives closing the board, not a reload.
- **A canvas in the archive is archived** (ADR-0029): it is read-only for
  everyone until it is moved out, the host lets go of it, and its threads'
  proposed changes leave your repo. Its column, as wide as the others and marked ✓,
  shows a count and its most recent canvases, or every canvas the search keeps,
  newest first. An archived canvas opened from it
  is read-only, with **Restore** in its composer's place, which moves it to
  Topics; it leaves the sidebar when you switch away unless you
  restore it.
- **A thread whose lane keeps a history of another kind is read-only**
  (ADR-0150): made when the project had no jj repo, or the reverse, it
  stays as it was. Its column says "made when the project had no jj repo:
  nothing runs here now" (or "had a jj repo") in its composer's place, and
  a branch or a copy from it says the same before its first send. The host
  refuses the same: a message, a carry-on, getting the latest, an action on proposed changes
  that asks its agent, another thread's ask, and a crash's resume.
- **Anyone edits the states**: a state's name is a button that turns into a
  field (Enter or leaving it saves; Escape keeps the old name); its `⋯`
  moves it left or right, adds a state left or right of it (a name field
  stands where it will go), or removes it, which is refused, with the
  reason, while it holds a canvas or is marked Topics. Its last items are the
  marks, checked where they are: **New canvases start here** moves the
  Topics mark to it, and **Agent work moves canvases here** moves the Active
  mark to it, or, checked, unmarks Active, so nothing moves on its own. A
  state takes one mark, so the other's item there says why it is off.
  Adding a state is rare, so it takes no room on the board. The archive can
  be renamed, never moved, removed or marked.
- **A topic is often a chat**: an idea not started is a canvas in Topics
  whose thread no agent works in (ADR-0021, ADR-0158); people discuss it
  below its first message, and asking `@agent` in it starts the work, which
  moves it to Active.
- **A text card becomes a thread** (ADR-0111): dropped on an open state, in
  the board's column or the footer's strip, or among the sidebar's canvases,
  it starts a canvas there with a chat whose first message is its text, by
  you; a note's and your message's ⋯ have **Move to a new thread in
  Topics** (and each open state) for the keyboard. Dropped in the
  sidebar, the new canvas opens there for you. It never asks the agent,
  even with `@agent` in it. While a card is dragged, those places are
  outlined, and a card held over ▦ opens the board. The undo key lifts the
  thread back into the card, where it was, while the thread holds that
  first message alone; once someone replied, it says "not lifted back: Bea
  replied". A blank card starts nothing.

### Columns: the canvas (ADR-0116)

- **A canvas opens on its canvas**: every card on it, as columns, in an order
  everyone shares. A thread card's column is its thread's path; a note
  column's is its notes. Each is **folded** for you until you open it: a
  narrow strip in its place, which a click unfolds. A canvas you have not
  opened in this tab starts with its first column whose box is not ticked
  unfolded, and keeps that view once its columns are drawn, so a box
  someone ticks later folds nothing under you (ADR-0198). Folding (**⇤**,
  first in a column's header) is yours alone, and moves nothing for
  anyone else.
- **A strip is its column's header turned on its side** (ADR-0137,
  ADR-0198), in the header's order: **⇥** where the header's ⇤ is, so a
  second click lands on it, the column's box, its mark, its name at the
  header's size, in its colour, and its status's dot. Only ⇥ unfolds it
  (ADR-0203).
  Folding turns the name 90°
  into the strip, its mark and its box moving with it and ⇤ flipping into
  ⇥ where it stands, while the rest of the column
  fades and the columns after it close up; unfolding turns it back. Only a
  fold you ask for moves; under reduced motion, nothing does. Its mark
  and name drag, as a header's do.
- **Every column has a box, everyone's** (ADR-0198): a checkbox after its
  toggle, folded or not, on a thread, a note column or a media column.
  Anyone who may change the canvas ticks it, for everyone, and the undo
  key takes a tick back; on a read-only canvas it is drawn and cannot be
  changed. It means what its people mean, done or set aside: the page
  only dims a ticked column's name, and the canvas list an agent is told
  marks it "box ticked", which the agent's rules say is the person's own
  mark, which may mean done, or handled for now. Ticking folds nothing.
- **The canvas column comes first**, folded the same way: the canvas's title,
  which anyone renames there, **Move to ▸** among the board's states, who is
  reading, the cards pinned to the canvas, and the canvas list its agents
  are told.
- **＋ past the last column makes a column** (ADR-0138), for everyone, on a
  canvas you may change, and nowhere else: **＋** an agent thread, its box
  starting with `@agent ` typed (ADR-0164), its **▾** a chat or a note
  column. It lands where a drop there would, at the
  canvas's end; a thread made there starts a new root, with no history of
  its own, unfolded for you and ready to type in. On a read-only canvas it is
  not drawn.
- **A thread's column is one path**, from its root to its thread's end,
  read top to bottom. Its composer sends at its last message.
- **Opening a branch adds a column after the thread it forks from**, starting
  after the fork. Its card is on the canvas in that place from the moment
  it opens, for everyone, unfolded for you and folded for others (S218);
  what you type in it is your message, yours alone until you send it. An aside of
  an aside opens a third column.
- **A column's header says who works in it and where it came from**
  (ADR-0040, ADR-0203). Its line names the agent working there, `✦ amber-fox` in
  the column's colour. While the composer's next send would start one, the
  agent to come is named already (ADR-0057), with `✦ new agent` only until its name arrives. A chat
  reads "chat" there, since a message goes to people. Before the agent's name
  is its icon (ADR-0143): its banner, drawn from its name (ADR-0053) or
  pasted, under any icon
  source; else its name's noun's built-in pixel sprite, when the user config's
  `icons.source` is `built-in`, the default; else ✦. Under `drawn` a new
  agent shows ✦ until its drawn banner fades in, and never a built-in icon
  first. The same icon heads its folded strip and its card. Hovering the
  name says who started the thread and when ("started by Ada · 3 h ago"),
  where it works ("on wip/search", or "wip/search is gone" once it is,
  ADR-0104; nothing on the line), and the agents along its path. For a column
  that forks, the fork row under the line names the fork, `↰ Ada: “Say exactly…”`, and clicking it brings
  the fork point into view. A copy names its source instead, "↰ copied from
  amber-fox · Fix the sync bug", and a thread whose parent thread is in
  another canvas names that, "↰ from amber-fox · Fix the sync bug": clicking
  either opens that canvas at the fork. Where someone holds the source in
  their inventory, the row says "Bea has it" and opens nothing.
- **A column's header is one line** (ADR-0198, ADR-0200, ADR-0203): its
  toggle, its box, its mark and name, its status, then who is reading,
  and ⋯. The mark and name are its handle: they drag it, and a press there
  does nothing else. The status is a mark, not a button: its dot, and a
  word while something is raised for you (needs you, conflicts, ready,
  worth a read). Under the line, always, nothing behind a press: the run-end
  reason while raised for you, else the thread's title, else its focus; the
  fork row; and an ssh request for its owner. The column's ⋯ starts with
  how it reads (**brief**, **story**, **everything**, the current one
  checked) for a column with messages, then, where the agent joined below
  the path's first message, **Go to where it started**, which brings that
  message into view. Pinning a first card is its ⋯'s **Pin a card**. For
  anyone who may write the column, its ⋯ offers **Rename** on a note or
  media column and **Edit title** on a thread, first among what changes the
  canvas. A column has no details panel (ADR-0203).
- **A column's dot is its thread's status** (ADR-0198), the same value
  folded or not, and the one the sidebar and the board read: an amber dot
  when it needs you (a run's end, an ask about a conflict, an ssh
  request), red when its proposed changes conflict, an amber ring when
  they are ready to accept, a dim amber dot for worth a read, a ring in
  the agent's colour while it works, a grey ring once accepted, and a faint
  dot with nothing to say. What is not raised for you (a thread you do not
  follow, a report you read) is drawn grey. Its title says why, in the
  same words wherever a status is titled.
- **Under a named agent's line is what its thread is doing now** (ADR-0173,
  ADR-0203): its focus, two lines at most, with the whole of it in its
  title, "written by a model". A model names it after each of the thread's runs, once the
  run's summary is written, from the thread's asks and their headlines; it
  stays while the work goes on, and changes when the thread moves to a new
  phase. Until a thread's first run ends, the row shows its first message's
  first line, dimmed. A focus follows the digests' setting. A thread's preview
  shows a model's focus above its first and last lines, and its folded
  strip's tooltip leads with it.
- **A thread's title stands in for its focus** (ADR-0208): a person's words
  for it, set from its ⋯'s **Edit title** in a field where the line is.
  While it is set, the header, the preview and the folded strip's tooltip
  show it instead of the focus, undimmed, titled "set by" whoever set it;
  saving the field empty clears it, and the focus shows again. The model
  keeps writing the focus all the while. A chat, or a column whose agent is
  not named yet, shows its title there, and nothing while it has none. A
  copy keeps its source's title. The
  canvas list every thread's agent reads quotes a thread's title after its
  name.
- **In its focus's place, what its last run needs from you** (ADR-0175,
  ADR-0203), while raised for you: the reason alone, "asks whether to drop
  the v1 table", "Bea stopped it", in its level's colour, two lines at
  most, titled with the level then the reason in the sidebar's words, and
  for its followers alone, as its dot is; the status says its level in a
  word. A press brings the run's last entry into view. Read past or
  dismissed, it turns quiet and the focus shows again; the next run's start
  clears it. A run that was done, or a stop you made, shows nothing.
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
- **Every column's header starts with its toggle, and an unfolded one
  ends in ⋯** (ADR-0161, ADR-0134, ADR-0198): **⇤** on a started thread or
  a list column, which folds it for you (**⇥** in the same place unfolds
  it), and a **bin** on a thread not yet started, which trashes it
  (ADR-0177).
  Its ⋯ holds what changes the canvas for everyone: its width, one or two
  columns wide; a thread's copies and its take; and last **Move to
  trash**, on every column, even where the bin repeats it. ⋯ is everyone's, and
  the head's toggle is yours or loses nothing. A folded strip has no ⋯:
  unfold it first.
- **Columns are reordered by dragging their headers, for everyone**: the
  canvas's order is shared, and a drag moves a card on it. Whichever column
  is first shows its whole path, so moving a branch to the far left makes it
  read as the trunk. Its mark and name are the handle (ADR-0200), and
  nothing else in the header drags, so no press is both a drag and a
  click. With focus
  anywhere in a column outside a text box, Alt+← and Alt+→ move it one
  place, and it is scrolled into view.
- **Every drag in the page is one kind of drag** (ADR-0134): a column's, a
  card's, a slot's, a canvas's, by the mouse or a pen. What is dragged follows
  the pointer, its header raised and leaning with its speed; along the strip
  the other columns slide apart to open the gap it would land in, and off
  the strip a column shrinks to a slot's size, its header showing. What a drop there would do
  shows on the target: a move, a copy with Alt held, a slot's card to be
  replaced, or grey for a refusal. A drop lands; Escape, or a drop where
  nothing lands, springs it back. With reduced motion the same states show
  without moving. Touch does not drag yet: a touch scrolls and taps. Files
  dragged in from your desktop still drop on a picture field.
- **A thread is a card** (ADR-0117, ADR-0124): one place, on a canvas
  or in someone's inventory. A thread column's ⋯ has **Copy to this
  canvas**, **Copy to your inventory** and **Move to your inventory**, and
  lists no canvases (ADR-0127); its header dragged onto a slot takes it too.
  Dragged onto a canvas in the sidebar, a column moves to the end of that
  canvas, for everyone, and a running thread keeps running; you stay
  where you are. Dragged between two canvases there, it makes a new canvas
  holding it, placed there in your sidebar (ADR-0134). Held over the
  middle of a canvas there, a column or a card opens that canvas; held
  between canvases, nothing opens (ADR-0134). Taken
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
- **Move to trash, or the bin on a thread not yet started, trashes a column,
  for everyone, asking nothing** (ADR-0134, ADR-0161): a
  thread, running or not, sent or not, and a note column with its notes.
  A running thread's run stops, as putting it away does ("Ada stopped it"). The
  cards at a thread's end, your message among them, stay with the thread,
  in the trash with it. A new canvas's only thread, not yet sent, takes its
  canvas out of your sidebar too. The undo key brings any of it back.
- **A canvas's trash is the canvas's**: the canvas column lists the columns
  trashed from its canvas, newest first, each its title over who trashed
  it and when ("Bea · 2 d ago"). One quiet line under the heading says how
  long they are kept ("kept for a week after it is trashed, then
  deleted"); a row says nothing of deletion until its last day, when it
  reads "deleted in 5 h" in the warning colour. Anyone on the canvas
  **restore**s one, back where it
  was, at its rank. An archived canvas's list is read only. A restore whose
  place is gone (a note whose column was trashed after it) or taken (your
  message where you have written a newer one) is refused, saying so.
  Nothing is sent in a trashed thread ("restore it first"); a link to it
  says "in the trash" and restores it. A week after its trash a trashed
  card is deleted, with everything on it; a thread takes its lane, its
  bookmark and its proposed changes with it, and its messages stay in their root,
  where a link to it says "deleted".
- **A branch not yet sent from a thread someone else has since taken**
  keeps its text, but its column says "Bea has it" in place of that
  thread's messages and sends nothing until the thread is on a canvas
  again.
- **Each column's foot is its dock** (ADR-0113, ADR-0203), pinned there while the
  messages scroll above it: the changes row, the queue's header, which says what happens
  next, the cards queued, **+ add to queue**, the line, and your message.
  It takes at most a third of the column and scrolls within
  itself past that, the changes row and the queue header kept in view as
  one block. The header tells and the dock does: what acts on the thread's
  work is here, beside the box you write in. The dock has one ⋯: the
  changes' commands, then the queue's.
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
  may carry on, **pause the queue** (or **unpause** while it is held with
  nothing to send), and **move all back to notes** while a card waits.
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
- **A row of the column's header, the access row, says which ssh
  identities its lane holds** (ADR-0140): its service identities, then
  your identity's state, then the hosts it reached ("🔑 deploy, Duane's
  ssh · pop"). A lane waiting for you reads "🔑 asks to use your ssh for
  pop" with **allow** and **deny**, marked as needing you; an allowed one
  **take back**, and a denied or taken back one **allow** (ADR-0172). Only the owner sees
  the buttons; everyone else reads "🔑 waiting for Duane". While your
  answer is out its buttons wait, and a refusal is said there. A
  signature refused because its host is outside your `lanes.ssh.hosts` is
  said there too, with no buttons ("🔑 your ssh can't sign for
  192.168.1.2: outside lanes.ssh.hosts", ADR-0170): your config is the
  answer, and a host clears it as it starts. A lane that never asked,
  used no service identity and was refused no host has no row. A lane
  waiting for you is also in your inbox ("asks to use your ssh for pop"),
  whether or not you follow it; answering clears it. A request waits until
  you answer, however long (ADR-0178): the lane's ssh is refused meanwhile,
  and its agent is told to end its turn. Allowing it wakes the lane, its
  thread reading "↻ resumed by Duane: allowed ssh for pop", and it tries
  again.
- **In a folder project** (ADR-0142), the strip's proposed changes are the files the
  thread's newest state changes against accepted work's newest, reviewed as
  files, each with its line counts and its unified diff; it has no bookmark,
  no stack and no split. Its words name accepted work as jj proposed changes' do,
  and its titles name no bookmark. **accept** writes the files into the
  project's folder, as its title says; conflicted proposed changes have
  none, since a folder has no unfinished work, and getting the latest or **choose versions**
  resolves them: the pane shows each conflicted file's changes on both
  sides from the version both began from, and three choices ("keep this
  thread's", "take accepted work's", "take the version both began from"),
  refused while the thread runs. The footer shows no publish or set up
  button but **history** (ADR-0165): accepted work's kept states, newest
  first, who made each, when and how, each one's changes opened in place,
  and "restore this version", whose preview is what the folder would
  change; "restore" writes it back, refused if the folder moved since the
  preview. The composer has no unfinished work to start from: a folder project's
  accepted work is its folder.
- **A review shows a file as a file** (ADR-0165), in either kind of
  project: an image's before and after side by side, any other binary
  file its sizes and both versions to open, a moved, unchanged file one
  row `{old => new}`, "moved, unchanged".
- **The dock's changes row, the work strip, says what became of the
  agent's files** (ADR-0040, ADR-0113, ADR-0203), drawn while it has
  something to say or do, and its buttons act at once: an agent on its own copy shows its proposed changes in plain words ("2
  files changed"), with **accept changes** and its bookmark, which a press copies. The
  button names unfinished work the work goes into (ADR-0104, ADR-0090): "accept changes", or
  "accept changes into wip/search" for a thread on unfinished work, whose menu also offers
  "accept, with your 2 commits beneath it" into accepted work; its title
  names the bookmark it moves. Accepting the proposed changes (an *acceptance*,
  ADR-0083) moves that bookmark forward to the proposed changes and never touches your
  working copy. From the click to the host's
  answer the strip says what your command is doing ("accepting…",
  "accepting into wip/search…", "squashing to one…", "splitting into
  a stack…", "rewriting the description…", "refreshing…"), and its buttons
  wait. A command refused or failed says so there, as the publish toast does
  ("not done: …", "it failed, and may be part done: …"), until your next
  one on that thread; one carried out says nothing, as the proposed changes then show
  it. An acceptance adds the proposed changes the strip showed: if it now brings other work
  (the lane moved on), or conflicts where it did not, it is not done ("not
  done: the changes are not what you were shown: review them again"), and
  the strip shows the new proposed changes. A rebase onto moved accepted work, or your
  own edit of the proposed changes, is still the proposed changes you saw, and is accepted. Proposed changes that conflict are never accepted into accepted work; their button is
  **get the latest from accepted work and resolve**: the agent resolves what the merge leaves.
  While they conflict and your box holds text, the send button has a ▾
  whose **resolve and send** queues your message with that command, so the
  agent resolves with what you wrote; **send** always sends. Proposed changes whose
  every conflicted file was already conflicted where its thread's copy
  started says so instead: "began from a copy with an unresolved conflict
  in 1 file", and, when the thread it branched from has since resolved
  those files, "· amber-fox has resolved it", with **get the latest from
  amber-fox** as its button (ADR-0072). Its commands in the dock's **⋯** are **catch
  up with** the thread's base (accepted work, or its unfinished work), or, once its unfinished work
  is gone, **continue from accepted work**; and, while the thread it branched
  from has new commits, **get the latest from** that thread by its name, greyed
  out while that thread's agent works. When getting the latest would change files
  in the thread, the strip says so ("2 files changed · accepted work has
  moved on"), getting the latest stands beside the proposed changes, titled with how many files it
  changes. When it would change nothing, it stays in the
  menu, greyed out, and says why: "already got the latest from accepted work",
  or, when accepted work moved only by this thread's own work you accepted,
  "what's new in accepted work is this thread's own: getting the latest changes no
  file"
  (ADR-0067). A thread whose base pine·trie has not read yet (one whose agent
  never changed a file, so its work never reached your repo) keeps it in
  the menu, enabled, and claims nothing. Proposed changes whose work accepted work
  already has says "nothing to accept: accepted work already has this
  thread's work": nothing
  counts it, and archiving its thread warns of nothing. A thread whose
  earlier accept was made before pine·trie recorded what an accept brought
  says "an earlier accept of this thread can't be traced: get the latest from
  accepted work to offer what's new", with getting the latest beside it. Every time it gets the latest button does
  it at once
  (ADR-0061): each queues a new card holding the command and no text, which
  the host pops when the lane is free, and your composer is left as it
  was. The queued card says "↓ gets the latest from accepted work first", and
  the strip "getting the latest from accepted work…". A card that already carries a
  command (one unqueued, say) says so in a chip above its box, with a × that
  sends it as a plain message instead, and its button reads "get the latest", or "get the latest
  and send"; what you write is what the agent should do with the new work
  (ADR-0108).
- **The thread hears what was done to its work** (ADR-0080). An
  acceptance, a rewrite of the description, a squash and a refresh each add a line to
  the thread: "✓ accepted", its change id in the line's title, "✎ asked
  for a new description", "⇣ the stack was squashed into one revision", "↻ the
  proposed changes were rebuilt from this thread's work". While the agent works, the
  line waits in the dock's queue as a quiet row, and joins the thread when
  the run ends. When accepted work has moved on with work the thread
  lacks, its next run, or its run in progress, begins with "↓ accepted
  work has moved on: 2 files, 1 this thread changed too". A thread with no work of its own is
  got the latest before it runs, and shows the update's "↓ got the latest" line
  before your message.
- **Split into a stack waits its turn** (ADR-0080): the button queues a
  card with the split, as getting the latest does, sent when the thread is free;
  the queued card says "⇶ splits the proposed changes into a stack, with what you
  write as its brief", its button reads "split", and while it waits the
  strip's **split** is greyed out. The agent can ask for a split too.
- **The agent asks about a conflict** with `ask_about_conflict`: the strip
  then says "the agent has a question about your edits · see the thread"
  until the proposed changes change.
- **A branch from a conflicted copy is warned** (ADR-0072): when the next
  send would start a thread on its own copy cloned from a commit with
  conflicts, the line under the box says "starts from a copy with an
  unresolved conflict in 1 file".
- **A column's pane opens what you read beside the thread** (ADR-0078):
  the proposed changes' review, an ask's review, a table, or an image, one at a time.
  The thread keeps its place and width, and the column widens to hold the
  pane, which takes what the strip has beside the thread, from 40rem to
  64rem (ADR-0087). Opening something else replaces it; opening it again,
  the pane's ×, or Escape inside it closes it, and its source in the thread
  is outlined in the column's colour while it shows. A strip too narrow for
  the thread and 40rem shows the pane over the page instead, with ← to go
  back to the thread; folding the sidebar can make room for it beside the
  thread. Nothing in it is kept: a reload closes it.
- **The proposed changes' line opens its review in the pane** (ADR-0047): a file
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

- **A column is read at one of three densities**, chosen in its ⋯ (ADR-0203), kept
  with the column and never written: **brief**, **story** and
  **everything** (stored `outline`, `story`, `raw`, ADR-0172). A new column
  opens in story.

  | density | an ask shows |
  |---|---|
  | **brief** | its message, and one line: how it ended, or what it is doing, and its counts; its summary's headline under it; the column's last ended ask also its last word (ADR-0106) |
  | **story** | its message, a digest line folding its work, its summary, and its last word |
  | **everything** | every message and tool row, under its digest line and its summary |

  People's messages show at every density. Brief lists everyone's asks.
- **An ask's digest line** counts its work: steps, files its turns
  changed, how long it took, and problems, in plain words: "3 steps · 2
  files changed · 1m 05s · 1 problem" (ADR-0172). A tool call is a step's,
  never counted on its own. A press opens or closes the
  work under it. Its files open a review of what the ask alone changed, beside
  the column, as proposed changes' review does.
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
  message after it. It takes no room. Reading quiets the header's status line; it
  does not hide it.
- **A summary for every long ask, unless digests are off**
  (`{ "digests": { "enabled": false } }` in your `pinetrie.json`, ADR-0071,
  ADR-0146, ADR-0173): a model's headline on an ask's work, and up to four
  points when the work in between adds to the agent's last word. It is one
  row, set apart from the agent's words and marked as a model's, in one
  place at every density: under outline's line, else under the ask's first
  digest line, else above its work. Outline shows the headline alone; story
  and raw show its points too. A fold's line never holds it. It is
  refreshed at most once a minute while someone reads the running thread,
  as a headline alone, written once more with its points when its run
  ends, and read by no agent. A long ask is one whose work is three agent
  messages or more.

### The rail: a root's tree, compactly

- **A forest on a canvas of several roots** (ADR-0116, ADR-0117): one tree
  for each root a thread of the canvas is in, each cut to the paths leading
  to the canvas's threads, in its root's own colours. A fork from those paths
  to a thread elsewhere is a stub, `↳ amber-fox`, titled where it is: a
  click opens that canvas, or your inventory's preview; one someone else
  holds says "Bea has it" and opens nothing.
- A strip beside the sidebar draws every branch of a tree as a line,
  and every message as a dot, except for uneventful stretches (below). A row
  is a depth, not a turn in one order: a branch starts on the row under its
  fork, beside the messages it diverged from, in the leftmost place free for
  its whole height (ADR-0068). Each branch has its own colour, by when it
  was made, starting from a colour of its root's own (ADR-0089): its trunk
  takes a colour the root's id picks from twelve, and each later branch
  steps on round them, so roots don't all start alike, and neighbouring
  branches are far apart. The tree is centred in the rail.
- **A new canvas has a rail too**: a hollow dot where its first message will be, until its canvas has one.
  It is as wide as the rail it becomes, so the columns do not move when the
  first message lands.
- **A column wears its rail track's colour**, so you can see which branches are
  on screen and where they sit in the whole.
- **Clicking a message in the rail brings it into view**: in the column that
  shows it, or in a new column opened beside it. While you search, it leaves
  the search there (below).
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

### Search: a canvas's rail, each column its own matches (ADR-0101)

- **🔍 at the rail's top searches the canvas you are on**, titled "search this
  tree · /"; `/` outside a text box does the same. It opens a bar across the
  top of the rail and the columns, in a tint and a shadow of its own, which
  pushes them down. The 🔍 leads the bar, pressed, where it sat, titled
  "close search · Esc". A new canvas has no 🔍, and while the board is open
  over the columns, `/` is the board's own search's (ADR-0115), which finds
  canvases by their labels; this one finds words in one canvas's messages.
- **It finds a phrase, as you type it**: the words you type, in order, with
  any space between them, in any case. A match starts where a word starts,
  and every word but the last is whole; the last, which you may still be
  typing, may start a longer word, and the whole word is marked. "colum"
  finds "column" and "columns"; "rail" finds "the rail.", "rails" and
  "rail-view", never "trail"; "fix the col" finds "fix the column", never
  "fixes the column". It looks in every
  message on the canvas's rail, as written: people's, the agent's, and pine·trie's own
  lines. It does not look in tool calls or their output. A reply still being
  written is found once it is a message.
- **Until you type, nothing changes.** With the field empty, the columns and
  the rail are as they were.
- **Each column shows only its own matches**, laid over its thread: the
  messages it draws that match, oldest first. A match says who wrote it, how
  long ago (the date in its title), the ask it is part of
  (`in Ada: "Fix the rail…"`), and a snippet with each match marked. Between
  matches, a line says what was left out: "⋯ 12 messages". A column with
  none says "no matches in this thread". Its header counts them, "4
  matches", beside the thread's name. The composer and the work strip are
  under the matches with the rest of the thread, out of reach.
- **The rail lights the matches**: a dot or a capsule holding one is ringed,
  its title leading with its count, and everything else is dimmed. The
  columns' views are not outlined while you search.
- **The bar says what you are looking at**: the field, with **⌫** while it
  holds text, "9 matches · 2 on branches not open" (or "no matches"), and
  **done** at its end, titled "back to the threads · Esc".
- **⌫ clears; done closes.** ⌫ empties the field and keeps the bar, with the
  caret in it. **done**, the pressed 🔍, and Escape in the bar or a column's
  matches close it, and every column is where you left it: its thread stayed
  under the matches. Closing from the bar puts focus back on the 🔍.
- **Showing a message leaves the search.** Pressing a match closes the search,
  shows the message in its column, its ask's fold opened, and outlines it
  briefly in the column's colour. A pick on the rail, a dimmed one included,
  a mention from your inbox, or going to another canvas, a new canvas or the
  board leaves it too.
- **A search is this tab's**, never stored, and writes nothing. A column under
  a search does not mark its thread read: no one is reading it.

### Context, drawn

- A message the agent was asked shows as asked (a margin bar), and a divider
  marks **where each agent joined**, by name: `✦ amber-fox joined`, or
  `✦ copper-owl, from amber-fox` in a branch of an agent thread. Everything above
  it is now that agent's context.
- **What is on the canvas, as the agent was told it**: a run in a canvas is
  told the list of the canvas's cards, 50 at most, when it differs from the
  last the thread was told; "the agent was told the canvas: 4 cards"
  sits above its prompt and opens to the list. A card added or taken while
  the agent works reaches it as it works, never as a message queued.

### Who a message is for (ADR-0021)

- **A thread's mode is whether the agent works in it**, which is whether it has
  a lane. In an agent thread, a message that names no one asks the agent;
  in a chat, only `@agent` does (ADR-0158 names the two). Nothing is set or stored, so there is no
  rule to mark and no mode to toggle.
- **Mentions pick who a message is for.** `@agent` asks the agent. A message
  naming only people goes to them, in an agent thread too. A handle that names no
  participant (`@types/node`) is ignored. A person's handle is their name as
  shown, in lower case, keeping only letters and digits (in any script), `_`
  and `-`: `@adalovelace`, `@josé`, `@日本`. Someone who set no name is shown,
  and mentioned, by their email's part before the `@` (`@ada` for
  `ada@example.com`, ADR-0037). A name with no such character, or spelled
  `agent`, is refused: no mention could reach it.
- **The composer offers whom to mention as you type `@`** (ADR-0128), as it
  offers commands as you type `/`: `@agent`, the thread's members, the
  people, then the other threads' agents in reach, each with who it is
  ("this thread's agent", a person's name, "member", "another thread's
  agent"). Those whose handle starts with what you typed come first, then
  those that only hold it; you are never offered. Arrows move, Tab or Enter
  puts in the handle and a space, Escape hides the list. A handle typed in
  full, a `@` in code or inside a word (`ada@example.com`), offers nothing,
  so Enter sends.
- **Another thread's agent can be brought in** (ADR-0128). A
  mention can name the agent of a thread on any open canvas by its
  thread's name (`@amber-fox`); a person's name may not be a thread's. A
  mention in an inline code span or a fenced block is no mention, of an
  agent or a person.
  - **The first mention invites it**: it becomes a **member** of the
    thread, and the message goes where it would have gone without that
    mention, so "Please talk to @amber-fox" in an agent thread asks the
    thread's own agent. Where that is nobody, as in a chat, the agents it
    invites are asked. A member's mention asks it, and leaves the thread's
    own agent out, as a person's mention does.
  - **Members are read from the thread's path**: a branch has the members
    its thread had where it forked. The column's header names them ("with
    amber-fox"), a member out of reach as away ("slate-owl (Bea has it)",
    "(archived by Bea)"), and what agents talking from the thread spent
    ("agents used 38k of their 200k-token allowance"). An ask of a member out of reach is
    refused, saying why.
  - **The send button names them**: "invite amber-fox · send to agent",
    "send to amber-fox", "send to amber-fox +1".
  - **An agent asks another with its `ask` tool**, which never waits: its
    row reads "asked amber-fox". The asked agent works in its own thread:
    an "incoming from sable-meadow: 3 messages" line, then the ask, spoken by its
    asker. Its last message comes back as an answer, spoken by its thread's
    name; an answer to an agent's ask runs that agent again, and nothing
    else does. A row from a thread on another canvas names that canvas beside
    its speaker ("· Sync bug"), and opens it. An answer for a thread whose
    canvas was archived, or which was taken, since it asked is not sent: the
    answering thread says so. An ask for a busy agent waits in its dock as an ask card,
    which a held queue holds.
  - **An allowance of tokens** (200k unless the user config's `agents.budget`
    says otherwise) is set by the person's message the talk began from;
    the runs agents start spend it, and a spent one stops the run, wakes
    nobody, and says so in the thread.
  - **An agent cannot read another thread yet.** A `read_thread` tool,
    reaching as far as a mention does, is decided and not built. An allowance
    chosen in the composer, a top-up of a spent one, dismissing a member, a
    relayed run's end report in the thread that asked, and "talking in
    sable-meadow" in the asked thread's header are shelved (ADR-0160).
- **The send button says what the message will do**: "send", "send to Ada"
  ("send to Ada +2" for three), "send to agent", or, while the agent is busy,
  "queue up next", "queue after Bea" or "queue after yours", naming who
  queued the last card already waiting. It uses the host's own decision (`addressMessage`,
  over the column's thread), so it cannot promise a reply that will not come. When the
  send starts a thread and you have unfinished work bookmarks, a line left of the
  button says what its copy **starts from** ("starts from accepted work ▾"),
  and opens the choices: accepted work, or unfinished work, with how far that is
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

  Presence is thread-level: every column of the canvas you are on reports the
  thread it shows. Columns of other canvases report nothing, so a canvas's
  avatars, in the sidebar and on the board, are the people looking at it now.
  Which message someone has on screen waits until thread-level proves too
  coarse.

### Starting, branching, and stepping down

- **＋ canvas starts at the root** (ADR-0158), at the foot of the sidebar
  and on each board column: a new canvas whose one thread opens with
  `@agent ` typed, as a branch from an agent thread does. Enter after your
  message asks the agent and makes its lane; deleting `@agent ` makes the
  thread a chat. No choice is asked before the first message. Past a
  canvas's last column, ＋ makes a column of the canvas you are on instead
  (ADR-0138): an agent thread, its box starting with `@agent ` as well
  (ADR-0164), its ▾ a chat or a note column. Every thread with no lane
  asks the agent only through a mention, so a message that asks always
  shows it.
- **A new canvas is one from the moment it opens** (ADR-0126): its thread,
  not yet started, is a card on its canvas, and the canvas is in your sidebar
  at once, placed at the end of Topics from your list's ＋,
  of its own state from a board column's (ADR-0122). Its first send makes
  the root, and the board shows it from then: others find it there.
  Trashing it unsent with its bin sends the canvas to your trash with its thread,
  and the undo key, on no canvas, brings both back.
- **An empty session** shows the board, with nothing in it, and ＋.
- **A page with nothing in the sidebar** (a first visit, or a list you
  emptied) opens on the board, which shows every canvas to open: nothing opens
  a canvas by itself (ADR-0030).
- **`→` in a message's right margin opens a branch** as a column to its right,
  empty until something is sent there. What it opens appears to the right, so
  the button sits on that side. A branch starts as a chat; `@agent` there
  makes it an agent thread. **A branch from an agent thread starts with
  `@agent ` typed**, so going on with the agent is one Enter away; alone it
  sends nothing, and deleting it makes the branch a chat.
- **At an agent thread's end, `→` opens a branch too**, the same as on any
  other message: with `@agent ` kept, the agent's work forks there; with it
  deleted, a chat steps back down from the end, reading everything
  above. The agent thread's column keeps following its lane. At a
  chat's end `→` is hidden, since it would be the same as replying.
- Every one of these only opens a column. Nothing is written until the first
  send, and closing the column first leaves no trace.
- **An agent can propose branches** (ADR-0157): its `propose_branches`
  call is drawn as one card after its ask's work, at every density, never
  folded. Each row is a title and its brief's first line; a press on a
  title opens it to read or edit the brief, and × drops it (↺ keeps it
  again). Edits stay in your page until a press.
  - **Start N** opens a branch for each row kept, at the end of the run
    that proposed them, after the proposing thread in the proposal's
    order, and sends each `@agent <brief>` as your message: their runs
    start, folded.
  - **Open N** opens the same branches unsent, unfolded on your page.
    Each composer starts with `@agent <brief>`, on any of your devices,
    and is a card of yours only once you type in it. Everyone else sees
    them folded, with nothing in them.
  - Neither is drawn while the run that proposed them runs (the card
    says "waiting for the run to end"), nor in a column nothing may be
    written in (it says why): a button is shown only once a press can
    take. With every row dropped they stay, disabled, since ↺ undoes it. Once either is pressed the proposal is spent, for
    everyone: the card says "started by Ada" or "opened by Ada · 2
    unsent", and only Ada sees **Send K**, which sends each of her opened
    branches still unsent from its composer.
  - A branch opened from a proposal names its item in its fork row,
    `↰ amber-fox's proposal: “Fix the sync bug”`, and the press leaves a
    fact in the proposing thread, "⑂ 3 branches started from the
    proposal".

### Messages

- The speaker's name heads each human message; the agent's messages are marked
  as the agent's.
- **Tool calls are rows under the agent's message** (ADR-0107): what the call
  touched (`packages/threads/tree.ts`, `pnpm test`), and what it returned. The
  tool's word is a tag at the row's top right, apart from what it touched:
  what the call did, "ran", "read", "wrote", "edited", "searched",
  "looked for", "asked you" (ADR-0114, ADR-0172), with ✓ or ✗ beside it
  once the call ends. The model still calls its tools by their ids (`bash`,
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
- **A command's detail shows each statement's own output under it**
  (ADR-0204): what `cd x && make` printed under that line, and what the
  next statement printed under its own, failed redirections, subshells and
  a background job's lines written before the call returned included. A
  statement that printed nothing shows nothing, and one whose output was
  cut says "… earlier lines left out". The summary is the same as any
  row's. Where pine·trie cannot vouch for every byte (no observer, an
  older one, a call over its cap), the detail shows the output whole, as
  before; nothing it shows is ever split wrongly.
- **In story, a row says what its call is for** (ADR-0173): `shell`, `edit`
  and `write` calls carry an intent, the model's few plain words ("Run the
  unit tests"), and a story row leads with it where the command would be,
  the tag and ✓/✗ beside it. Its command is in its detail, and its button
  names it, "command · +335 lines of output"; the output's last five lines
  stay, so a row is as tall before its result as after. In raw a row shows
  its command, with the intent under it. A call with no intent (one from
  before, or another tool's) reads as it always has. Outline's line of what
  a running ask is doing says its call's intent, and so does a turn's
  revision title in your repo; a message's copy keeps the command.
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
  header (its `✦`, or its icon, ADR-0143) pulses, titled with the ask it
  works on, "the agent is working on Ada: "Fix the rail…"" (ADR-0106). In
  outline, the running ask's own line pulses instead of accepted work below. A
  short line pulses at the
  end of the column, centred, where its next text will appear. While a
  command that has run for half a second is still running, its row is
  outlined instead, with how long it has run beside its tag ("12s",
  "1m 05s"), and accepted work hides: the wait is the machine's, not the
  model's. A quicker command changes neither.
- **A canvas shown again draws its tool rows as they were left** (ADR-0123):
  a running command's row outlined, a row whose detail you opened or folded
  the same way.
- **A file dropped on a card, pasted into its box, or chosen with "share a
  file" is shared in the message** (ADR-0042, ADR-0151). Any file: it is
  uploaded as it arrives, and its link goes in where the cursor was, or at
  the end of a box without focus, staying put as others type:
  `![name](/blob/…)` for an image, `[name](/blob/…)` for anything else. The
  send button reads "uploading a file…" until it is done. A file dropped
  anywhere else is refused, never opened in the tab. Sent, a link to a file
  is a chip naming it, its format and size, warning when its bytes hold a
  location; a click opens an image or text beside the thread, and
  downloads anything else. The agent reads a text file quoted under the
  message, up to `shares.quoteBytes` (32 KiB), and is told of a larger or
  binary one, which it saves into its lane with `save_blob` to read. An
  image too large to send whole is drawn and read as its fitted copy; the
  pane, a download and `save_blob` give the original. Sent, the message draws the image at its stored size, capped
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
  focus (ADR-0043): *copy* first, then *comment* and *edit*, and `→` last,
  in the right margin, since what it opens appears to the right. Nothing is
  taken from the past (ADR-0132): a message is copied, and kept from the
  clipboard cell. Copy puts the message on the clipboard as markdown: its text as it was written, then
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
  which has no parent, the tool is *new canvas*: a new canvas holding its
  text, with `@agent ` in front when the message asked the agent and named
  it nowhere (ADR-0158). An agent's reply offers no edit:
  that would be a reply the agent never gave.

### A card's frame (ADR-0111)

- **Every text card is drawn in one frame**: a header, its box, and a
  footer. The header is what you drag it by, and what takes the card's
  focus: a click there focuses the card itself, outside its box, so Cmd+C
  and Cmd+X copy and cut it (ADR-0132). Its icon says what kind of
  card it is (✎ a text card), and it says where the card is (your message,
  note, queued, pinned, inventory), how it
  stands ("next", "held · 2nd in line", "not sent: …", "changed since the
  agent last read it") and who put it there ("by Bea"), each on one line,
  set apart by "·", what a narrow column cuts short ending in "…"
  (ADR-0179); then ⋯
  and its bin, which trashes it. A command's chip heads the body, above
  its box. The footer holds ↑ and ↓ in a list, and at most one primary
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
  there: the bench's put and trash, and a drag, move it.
- **Before your composer's first keystroke**, and in the box a new note or
  pinned card is written in, the frame says only where the card will be.
  That box offers no ⋯ even once its card exists: the card's moves are
  offered once it joins its list.

### Your message and notes (ADR-0048, ADR-0113)

- **What you type in a composer is your message**, a card on its thread
  that only you see. The first keystroke worth keeping (anything but a
  branch's `@agent `) makes it. It belongs to the thread, not the column:
  switching canvases, reloading, closing and reopening the column, or the
  host restarting, you find it where you left it, and it follows the
  thread as the thread grows, a thread not yet started's too (ADR-0126). Others writing at the
  thread's end show above it as "Bea is writing…".
- **A note is a card in a note column** (ADR-0116), which everyone in the
  canvas sees and anyone can type in; no agent reads it. A **note column** is
  a column of the canvas's: a title ("Notes" until someone renames it, from
  its header, for everyone) and its notes one under another, each folded to
  its first line until you click into it, headed "Ada's note · with Bea".
  ↑ and ↓ on a note, or Alt+↑/↓ in its box, move it in the column, as a
  queued card moves. Under the last note is a box, "write a note": the
  first keystroke worth keeping there makes a note at the column's end,
  and you go on writing it in that box until you leave it, when it joins
  the notes above; Alt+↑/↓ there moves it and takes you to it in the
  list. A note emptied is swept when the host next starts. It sits
  on the canvas in its place, folded until you open it, and moves and
  folds as a thread's column does. ＋ past the last column makes an empty
  one there.
- **A card leaving a thread's queue or pinned strip goes to the note column
  nearest the thread**, in the canvas's order, the one after it on a tie;
  with none, a note column titled "Notes" is made just after the thread.
  So does your message's **Move to notes**, a card the host could not send,
  and a card put or dropped on a thread's column. A card dropped on a note
  column is a note at its end. A card dropped on the canvas itself, on a
  folded column or past the last column, lands in a new note column made
  for it there; the undo key takes back both. Dropped on the composer a note becomes your
  message, and a message there with text takes the note's place, in one
  move the undo key outside a box undoes; an empty one is trashed. In a
  new branch, a message with text takes a card only from your inventory
  ("not moved: your message here holds text").
- **A media column holds images** (ADR-0182), for the team to see and
  compare: a column of the canvas's, titled "Images" until someone renames
  it, its images at its width, two to a row when it is two wide. Each image
  has a title (its file's name until renamed), its versions with ‹ › to step
  back through them, ◀ and ▶ and a drag to move it, a bin, and its
  comments, which say "on version 2" under a newer one. Files dropped
  between columns make one there, on a column put new images at its end,
  and on an image add a version; at an image's edge (a band of 24 px, or a
  quarter of a small image: top and bottom, or left and right two to a
  row) they go before or after it, a line drawn where. A file that is no
  image is left out, and said so. An image dragged to an image's edge moves
  there, in its column or another; the column scrolls near its top and
  bottom while one is dragged over it. An image dragged out of a message, a tool's row or the pane
  lands the same way, without uploading it again, and the pane's **put on
  canvas** makes a column after the thread, or, from its ▾, adds to one of
  the canvas's. ＋ past the last column makes an empty one. The agent's
  `put_image` puts an image from its lane, or adds a version. The agent is
  told each media column and its images' titles, never the images.
- **Marks say where you left something unsent** (ADR-0048): a small dot in
  your colour on its canvas's item in the sidebar, and on the rail at its
  thread's end, whether or not that thread's column is open. A canvas you
  closed is marked on ▦ and its canvas card; an archived canvas only on its
  canvas card, since its work is done. A note you own marks its canvas, not a
  thread's end. Only your own message and the notes you own count, and only while they hold text: emptied, sent or
  trashed, the dot goes. A bare `@agent ` is nothing typed.
- **Sending spends the card.** The box stays as it was until the host
  answers: written or running, the card is gone and the box empty; a
  conflict or a refusal leaves the card, so nothing is lost or put back.
- **A send to a busy thread queues your card above the line** (ADR-0048), as
  does a card with a command, even on an idle thread. Every move shows at
  once and is the host's to make (ADR-0059). A queued card is drawn
  in the column's dock, headed by its place in line ("next",
  "2nd in line", "held · next" while the queue is held) and who queued it,
  "queued · next · by Bea", with its command's chip when it has one. A
  command with nothing written folds its empty box away until the card
  holds the focus. Its ⋯'s **Move to notes**
  unqueues it. Anyone here
  can edit it until the host pops it to send it, when the lane is free, in
  order. An unqueued card goes back below the line, a note. Unqueue a card the host
  had already popped and your column says "already sent as Bea's message,
  before you unqueued it". A move someone else made first is undone on your
  screen, saying "not moved: Bea moved it first". A card the host could not
  send is back below the line saying "not sent: …" until it is queued again.
- **The queue's controls are its header's** (ADR-0048 step 7, ADR-0113),
  on any thread with an agent: **send queue (n)** releases a held queue;
  **pause the queue**, **unpause** and **move all back to notes** are in its ⋯. While
  the queue is held nothing in it is sent, so you can line up several steps on a
  quiet thread and let them go together. Notes the thread will read (a
  fact, ADR-0080) still go. **Sending removes the hold** (ADR-0113): on an
  idle thread whose queue is held, your send button reads **send all (n)**,
  and queues your message last and releases the queue in one step. On a
  running thread a send waits in the held queue. Unqueue all puts every
  queued card below the line at once, and the undo key outside a box puts
  them back.
- **A bin on a card trashes it** (ADR-0111, ADR-0177), wherever it is:
  your message, a note, a queued or pinned card, a comment; so does
  Ctrl+Shift+Backspace in its box. In your inventory, the bench's **trash**
  and Delete on a selected slot do. × never trashes: it closes. Where you
  did it, the column says "trashed · ⌘Z brings it back", and the undo key
  does, for a week; then the host deletes it.
  Trashing someone else's card leaves them a trace, as a move does.
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
  inventory?": **keep in inventory** (focused, the default), **trash**,
  which the undo key reverses, or **cancel**. Keep moves every card in the branch with
  text into your inventory, and closes the branch once each is there; with
  too few empty slots it says so ("not kept: needs 2 slots, 1 free") and the
  branch stays open.
- **A new branch's first message** leaves any other card in it as a note
  below it.

### Pinned cards (ADR-0048 step 5)

- **A pinned card says what a thread is for**, and the agent reads it on
  every run. It sits in a strip at the top of the thread's column, under the
  header, and stays there as the messages scroll. A new canvas or a new branch
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
  and Escape or clicking away closes it. Alt+↑ or Alt+↓ there moves the
  card among the pinned cards and takes you to it in the strip. It takes no
  pasted image, as no card that exists does: paste one into your message,
  then **Pin** it.
- **↑ and ↓ on a pinned card, or Alt+↑ and Alt+↓ in its box, move it among
  the thread's pinned cards**: the agent reads them in that order.
- **Anyone here can edit a pinned card**, as a queued one. Each is headed
  "pinned · by Bea", and shows its size, "~120 tokens", since a long one costs
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
- **Pinned to the canvas**, a card is read by every thread's agent in the
  canvas, after the thread's own. **Pin to the canvas** in a card's ⋯ puts it
  in the canvas column; unpinned, it goes to the nearest note column. A run
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

### Your inventory (ADR-0048 step 4, ADR-0171)

- **A panel of your own, floating over the columns**, opened and closed by
  **inventory** in the footer (which counts your cards). It sits in the
  middle of the screen by default; drag its top bar and it settles left,
  centre or right, and this device remembers where. Only you see it, on
  every root and device; nobody else can move a card into or out of it.
- **It never changes size as you use it** (ADR-0171): a frame two columns
  wide, the bag of slots and the bench beside it, under a header and over
  one status line. Selecting, opening a card, a notice or a copy moves
  nothing. Narrower than two columns, it is one column, the bench taking
  the bag's place while a card is open on it.
- **The header** says "inventory · 8/12", holds the clipboard chip and its
  **save to your inventory** (below), and **×**, which closes the panel.
- **The status line** under the bag and the bench says the newest notice
  ("trashed · ⌘Z brings it back", "inventory full"), and keeps its height when it says nothing.
- **A fixed grid of 12 slots, two wide and six high**, the first nine
  numbered 1–9. Each slot shows its card compact, as every card is drawn in
  a slot whatever its kind: a strip in your colour, its kind's icon and its
  author's circle (a thread's icon), then two lines, a text card's first
  lines, a reference's quote and the thread it is from, a thread's name and
  the first line of where it ended. A thread's slot says whether it stopped
  or has cards queued (ADR-0124). Cards keep their slots, gaps included, on
  every device. Dropping a card on a slot that holds one swaps the two, and
  so do Alt+arrows. Holding more than 12 (an undo brought one back), you
  see each, in rows past the sixth, and putting one more away is refused "inventory
  full" until you hold 12 or fewer.
- **The bench**: click a slot, or move with the arrow keys or `hjkl` while
  the panel has focus, to select it, and the bench beside the grid, on the
  side away from where the panel is docked, shows its card one column wide,
  read only; an empty slot says so ("slot 4 · empty: drop or paste a card
  here"). Above it, always, a bar (ADR-0177): **put**, which puts the
  card in the column you were last in (a thread on the canvas you are on,
  after that column), and **trash**, both greyed on an empty slot.
  **Enter, a click on the bench or on the card already selected, opens it
  there**, editable, the caret in its box; a reference opened shows **Edit
  as text**, and a thread its path read only, with no composer, queue or
  run. Only its holder opens it: a link to it anywhere else says "Bea has
  it". **×** on the open card, or **Escape**, closes it back to read only,
  the card kept in its slot; Escape with none open closes the panel. A
  click that ends a selection of the card's text opens nothing. A slot has
  no × of its own: **Delete** or Backspace on a selected slot trashes its
  card.
- **Who opened it closes it.** Opened by you (its toggle, a link to a
  thread you hold, an undo that shows it), it stays until you close it:
  **×**, Escape, or the toggle; a click elsewhere leaves it open, since you
  work in the columns while it is. Putting a card away while it is closed **peeks**: it
  opens for the card's landing and closes again, unless you move your
  pointer over it, focus is in it, you are dragging a card, or you press
  its toggle, which keep it open.
  A refusal opens it until you act elsewhere, so you can read why.
- **It opens and closes in motion**, growing from its toggle and shrinking
  back into it; with less motion asked for, it fades.
- **A card held over the closed toggle in a drag opens it**, and dropped on
  the toggle, it is put away into a free slot.
- **Put away** moves a card into your inventory (ADR-0083, ADR-0172):
  Ctrl+Shift+I in its box or on its header, **Move to your
  inventory** in its ⋯ (marked with the inventory's box and an arrow into
  it, put away's one icon wherever it is offered), or a drag of its header
  onto the panel. A card put away lands in the selected slot if that is empty, else
  the first empty one, and flies there; one put away while the
  panel is closed peeks at it. With no empty slot it is refused with
  "inventory full". **A drop or a paste aimed at a filled slot replaces its
  card**, which goes to your trash in the same undo step (ADR-0133); a card
  that may not be trashed there is not replaced ("not replaced: the card
  in that slot can't be trashed"), and a thread's copy lands only in an
  empty slot. Nothing nobody aimed at is trashed.
- **Copy, cut and paste** are the system clipboard's (ADR-0132), and the
  inventory holds only what you take:
  - **Cmd+C** (Ctrl+C elsewhere) copies anything you can read: a selection
    as its text; with nothing selected, a focused table's bar its table, a
    message selected in its column (`j`/`k`, or a click) the message, a
    focused card the card, the clipboard cell its copy. It moves nothing,
    opens nothing, is never refused for room and is no undo step. In a
    read-only column too.
  - **Cmd+X** on a focused card you may trash cuts it: a copy, then a
    trash to your trash, one undo step. On the past it does nothing.
  - **Cmd+V** lands what the clipboard holds where focus is, one undo step:
    in a text box, text as itself and a copied message, block or card as a
    link to it; on a column, a note column or a slot, a selection or text
    from another app as a text card keeping where it came from, a message
    or a block as a reference, a card as a copy of it (a thread's copy at
    its end as you copied it, a note column or a canvas as a reference to
    it). The first paste after a cut moves the cut card itself out of your
    trash. Cmd+Shift+V pastes the text alone, where the browser gives a
    paste for it.
  - A copy carries pine·trie's own data beside its text, so a paste in
    another tab or browser still lands as a card; another app gets the
    text, and a copy from another host lands as text.
  - **The clipboard cell**, a chip in the panel's header, shows what you
    last copied in this tab ("last copied here"): a
    copy made in another app shows there once you paste it. It is no slot
    and takes no drop; **save to your inventory** pastes it into a free
    slot. Saving a message or a block takes those two steps: copy, then
    save.
- **A reference** names a message, a table or a range of a message's
  text, with its quote (ADR-0126). It shows as a chip; selected, its quote;
  opened, its quote and thread, and **Edit as text**, which makes it a text
  card you can change, in its place and slot, one undo (a paste replacing
  it, so a full inventory takes it too). Put, it leaves your hand as any
  card does. The agent reads each linked message, table or quote under the
  message that links it.
- **Comments** (ADR-0126): a message's **comment** opens its margin under
  it with a new note focused. Everyone on the canvas reads it; the agent does
  not. Shut, the message shows how many comments it has (💬 2); a press
  opens them, **+ comment** adds one, **close** closes them. A comment's ⋯
  has **Send to the agent, quoting this comment**, which queues the comment on its thread, under
  a link to the message, so the agent reads it once with what it is about;
  the comment stays. Queued, the reference shows in the dock as a queued
  message does, with ↑ ↓, a bin and a ⋯ that moves it back to the notes or into
  your inventory. With a column's messages focused (a click on one), `j`
  and `k` select a message, Enter opens its comments, `c` comments on it,
  Escape shuts them, and Cmd+C copies it.
- **Put** moves the selected card to the notes of the column you were last
  in: Ctrl+Shift+O, the panel's **put** button, or a drag out
  of the panel onto a column: a note in the note column nearest its thread,
  or, onto a note column, at its end. Dropped on a
  composer, it becomes your message there. Held over a canvas in the sidebar,
  or over ▦, a drag opens it while a ring around it fills. The bench's
  **trash**, or Delete on a selected slot, trashes its card; the undo key
  brings it back.
- **Undo a move** with Cmd+Z (Ctrl+Z elsewhere) while no box has focus;
  Cmd+Shift+Z, Ctrl+Shift+Z or Ctrl+Y redo it (ADR-0066). It undoes your
  newest move in the canvas you are on, from any of your tabs, after a reload
  or a restart too. As it acts it shows where the card went back: the
  panel, the thread's column, or, for a thread not yet started, its card's
  column unfolded. If anyone moved the card since, it is refused, saying
  who, and nothing moves. Closing a branch is undone whole, its card and
  your message back; a new canvas, closed empty, is gone for good.
  Sends are final; a paste, **Copy to this canvas**, **Copy to your
  inventory**, **Edit as text** and **Send to the agent, quoting this comment** are each undone
  whole, and a copy to the clipboard changes nothing to undo. On no canvas, the undo key undoes your moves
  outside any canvas: trashing from your inventory. An archived canvas's moves cannot be
  undone, and are forgotten 7 days after it was archived.
- **Undo a swap** with the same keys while the panel has focus: this tab's
  newest swap goes back, unless those slots have changed since.
- **A refusal is said where you acted**: in the panel for a card put away into the
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
| every tree in one rail, one after another | one canvas at a time, with its own rail (ADR-0029, ADR-0116) |
| a column on another root, with no stripe and no fork dot | a column from another root has its root's tree on the rail beside the others (ADR-0116) |
| the rail's `+`, and Start Chat and Start Agent in place of a composer | ＋ canvas (ADR-0158) |
| ＋ agent, with conversation in its menu, at the sidebar's foot | ＋ canvas, its thread's box starting with `@agent ` (ADR-0158) |
| the task, the task column, Backlog, Doing and Done | the canvas, a topic or a task by its state, the canvas column, Topics, Active and Archive (ADR-0158) |
| a tab bar shared by everyone, with no close for yourself | the sidebar, yours on every device, with **×** (ADR-0030, ADR-0122) |
| a new root by anyone appearing as a tab | the board shows its canvas, and who is in it; you open it (ADR-0122) |
| the Archive tab, and the header's people | the board: every canvas in a workflow state, Done the archive (ADR-0122) |
| Cmd+C taking a reference into your inventory; a message's **take**; a table's or an image's ❝ | Cmd+C copies to the clipboard alone; keep, from the clipboard cell (ADR-0132) |
| Cmd+X taking a card into your inventory | Cmd+X cuts it: a copy, then a trash (ADR-0132) |
| a reference staying in your hand when put, and the put key in a text box | every card leaves your hand when put; Cmd+V types a link (ADR-0132) |
| a drop on a filled slot landing in the first empty one | the drop replaces the slot's card (ADR-0133) |
| a 3 × 6 inventory of near-square slots, a reference's slot saying only "a quote" | 12 compact slots, two wide, every kind in one shape (ADR-0171) |
| a preview beside the grid, and a card opened over its neighbours | the bench: the selected card read only, opened in place there (ADR-0171) |
| an inventory as wide as what it showed, closed only by its toggle | a fixed frame, closed by ×, Escape or its toggle, opening in motion (ADR-0171) |
| a card's face and whole | compact and full, each a box of its own size (ADR-0171) |
| × that trashed a card, and a slot's × on hover | a bin that trashes; × only closes; the bench's trash, and Delete on a slot (ADR-0177) |

With no control moving a lane, the `navigate` command had no caller and was
deleted with `prompt` and `branch`. Lanes now never move at all (ADR-0120).

## Data

Every part of this is a read of what the document already holds, except the
board's records (ADR-0122); a card's text is its own document (ADR-0048).

- **A column** shows a thread (ADR-0117). Its path is `projectTranscript` of
  the thread's end (`threadEnd`); the part after its fork point is the
  suffix below the column to its left.
- **The rail** is the tree itself, from `parentId`, drawn in id order, which is
  creation order (uuidv7).
- **A thread's mode** is its lane; **names** are `pinetrie.participant` values.
- **A root** is a root of the tree index (an orphan counts as one); a canvas's
  canvas holds threads of one root or several (ADR-0116). **Your list** is
  your own document (`open:<you>`, ADR-0122), each canvas's id to an order
  key, written only by your tabs: the canvases in it that are not archived,
  plus the canvas you are on.
- **The board and the footer** read presence (people, and the thread each
  is in) and the lanes (the agent's running threads). **Mentions of you** are the sends whose
  mentions `address` resolves to you. **What you have seen** is kept in your
  attention document (`attention:<you>`, ADR-0077), on every device of
  yours: an entry id (`mentionsSince`), at or before which every mention is
  seen, and the ids of later ones you have seen.
- **The board** is the team's (ADR-0122, ADR-0126): a host-written
  workflow (`pinetrie.workflow`, the open states in order, then the
  archive), and each canvas's card on it, in a state at a rank there; who
  moved it there and when is its card's history. A canvas in the archive is
  archived; the host refuses commands that would write in it (ADR-0029).
  A move on the board is undone by its mover's undo key on no canvas, unless
  it crossed the archive's edge: archiving and restoring are the board's.
- **Which canvas you are on, each canvas's view (which of its columns you
  unfolded, how each reads, what a thread you opened starts with) and
  whether the board is open** are view state, kept in the browser per
  browser tab, with
  the device's latest for a new one, and never in the document (ADR-0027,
  amended by ADR-0029, ADR-0030 and ADR-0122).

## Deferred, but designed for

- **The Machine page** (ADR-0210): the footer's machine status (above)
  opens it (`#machine`): each thread's lane, the machine, the host, and
  what can be done. A red cause that needs a choice is in the inbox too.
- **What else a canvas holds** (ADR-0116): file cards showing a source's
  file. Threads from any root, note columns and media columns (ADR-0182)
  are built (above).
- **What is left of cards and the dock** (ADR-0111, ADR-0113): a thread
  card's body on the board drawn from its pinned cards' first lines (today
  its first line, under a title); and who is in a note column now, which
  needs a presence field of its own.
- **Narrow screens**: the stacked sequence described above, with the sidebar
  collapsed to each canvas's icon (ADR-0088, ADR-0143) and the footer to ▦,
  what needs you and you (ADR-0122); built after the wide layout works. The
  column's pane is its first step (ADR-0078): over a narrow window it covers
  the page, and ← goes back to the thread. Below 56rem the sidebar narrows and
  the strip shows its first states only.
- **What's new since you looked** (ADR-0030 defers it): how far you read
  each thread is kept, in your attention document (ADR-0077), and a column
  draws its "since you were here" line from it. Still to do: unread marks on
  the sidebar's items, a "3 new" count on ▦, and a "what's happening" panel
  listing canvases by activity, from the same marks.
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
3. **Unread tracking** is a per-person "last read" position: how far you read
   each thread, in your attention document on every device of yours
   (ADR-0077), not presence, which decays.
4. **Columns scroll independently.** A shared vertical scroll kept every branch
   level with its fork point, but could not show forks far apart together, and
   its connector lines crossed sibling columns.
