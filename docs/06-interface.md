# Interface: a tab per root, columns for reading, a rail for shape

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
   one level. Pineta needs it at any depth.
3. **No thread is special.** The data has no "main thread"; the interface should
   not invent one. Whatever you put first is what reads as the trunk. Roots
   are peers too: you open the ones you work in, as tabs (ADR-0030).
4. **Show context, don't describe it.** What the agent will read is a path: the
   column shows it, and marks where the agent joined.
5. **Say the effect, not a mode name.** "send to agent" says what
   happens. "Working session" is a name someone has to learn. So there is no
   mode to set: the send button says what each message will do (ADR-0021).
6. **Every control is a choice the user made.** Nothing appears because of
   internal state.

## Layout

```
 pineta   Ada · connected                                   (B)(C)  (✦ 2)   @ 2
 Archive │ Fix the sync bug ◉ × │ Release notes ·Bea × │ Q3 planning × │ ＋ agent ▾
━━━━━━━━━┷━━━━━━━━━━━━━━━━━━━━━━┷━━━━━━━━━━━━━━━━━━━━━━┷━━━━━━━━━━━━━━━┷━━━━━━━━━━━
┌ rail ┐┌ column 1 ──────────────┐┌ column 2 ─────────────┐┌ column 3 ──────────┐
│ ●    ││ Ada                    ││▌from Ada: "Say…" (blue)││▌from agent (green)  │
│ │    ││ Say exactly: OK  ●blue ││ Bea                   ││ Ada                │
│ ├──● ││ agent: OK              ││ an aside              ││ aside of aside     │
│ │  │ ││ Ada                    ││ agent: …      ●green  ││ agent: …           │
│ │  ● ││ just a note            ││ Bea                   ││                    │
│ ●    ││ Ada: @Bea have a look →││   what about X?       ││   agent: …         │
│ ◉    ││ Ada: @agent … ◉replying││                       ││                    │
│      ││ ┌──────────────────────┐││ ┌───────────────────┐││ ┌────────────────┐ │
│      ││ │ send to agent…  send │││ │ reply in thread…  │││ │ …              │ │
│      ││ └──────────────────────┘││ └───────────────────┘││ └────────────────┘ │
└──────┘└────────────────────────┘└───────────────────────┘└────────────────────┘
```

### The header: who is here, and what mentions you (ADR-0030)

Your tabs are your view; the header shows what is happening in the rest of
the session, from live data only, as a document editor shows the people in it.

- **People here:** an avatar per person with a live presence entry, in their
  colour. Hovering names them and the thread they are in; a click opens that
  thread as your tab, with a column on their path. You are never shown among
  them.
- **The agent:** one avatar while it works, pulsing, with the number of
  threads it is working in. A click lists them, and a row opens one. Idle, it
  is not shown.
- **A menu you opened stays open until you close it.** The header's avatars
  and counts come from live data, but when what one stands for goes while
  its menu is open (a person leaves, the agent finishes, the last offer is
  taken), the menu says so ("The agent has finished") and its trigger stays
  until you close it (principle 6).
- **`@` is your inbox**: the messages that mention you, newest first, each
  with who, the thread, and the start of the message. A row opens that thread
  as your tab, with a column on the message; a message in an archived root
  opens that root's preview in the Archive tab. The count is the mentions you
  have not seen. One is seen when you open it from the inbox, when it is drawn
  in a column of the tab you are on, or when you **mark all seen**. A seen
  mention stays in the inbox; a filter shows only the unseen.
- **The inbox is this device's**, shared by its tabs and kept across reloads.
  A new device, or a cleared browser, starts from its first load, with no
  backlog.
- **You:** your avatar, at the far right, opens your profile (ADR-0037): your
  name, and the handle it gives you as you type it; your email; and **Not
  you? Sign in as someone else**, which forgets who this device says you are
  and asks again. A rename is sent on Enter or **save**, and Escape or a click
  elsewhere discards it. A name no mention could reach is refused before it
  is sent.
- **Nothing opens a tab by itself.** A mention is a notification: you choose to
  open it.

### Root tabs: the roots you have open (ADR-0029, ADR-0030, ADR-0045)

A conversation's context is its path to its root, so nothing in one root is
ever in the context of another. That is where the screen splits.

- **A root tab shows one root's tree**: its rail, and its columns. Every column
  in a tab shares the root.
- **Your tabs are yours:** the roots you have open, in the order you opened
  them. **×** closes one for you and writes nothing; opening it again brings
  its columns back. A root you start opens as your tab; a root someone else
  starts does not, and reaches you through the header, a mention, or the
  Archive tab.
- **A tab's label** is its title, else its first message's first line, cut
  short. **Rename** in the tab's `⋯` turns the label into a field: Enter or
  leaving it saves the title for everyone, Escape cancels, and an empty title
  brings back the first line. A title is a mark on the root (ADR-0045), and
  names the root wherever it is shown: the header, the inbox, the Archive
  tab.
- **A tab shows what happens in it while you are elsewhere:** a pulse while the
  agent is working there, and small avatars of the others reading there. For
  the roots you have not opened, the header shows the same. A small dot in
  your colour marks a tab holding something you typed and have not sent.
- **Archive is in a tab's `⋯` menu**, saying what it does: "hide for
  everyone; restore from Archive". The `⋯` shows on the tab you are on, and on
  any other root tab while it is hovered or focused. Archive is for work that
  is done; **×** is for putting a tab away yourself. The Archive item is
  disabled while the agent works in that root or messages wait there, with
  the reason. Archiving
  writes a record, and takes the root out of every tab bar; no message
  changes.
- **If someone archives the tab you are on**, it stays while you are there,
  read-only, saying who archived it, with **Restore**. It leaves the bar when
  you switch away.
- **With many tabs**, the bar scrolls; Archive and ＋ stay put.

### The Archive tab

The leftmost tab. It finds roots, so it is a list, not a rail with columns.

- **A row per root, open or archived:** its label, last activity, who wrote in
  it, its messages, and its state. Filters: archived, open, mine.
  Search over each root's label, so its title, and its message text.
- **Selecting a row previews it:** that root's rail, and one read-only column
  that a pick on the rail moves. Its composer is disabled, and none of the tools that
  write are there: edit, branch, mark. Copy stays, since it writes nothing. In place of sending it offers
  **Restore** for an archived root, and **Open** for an open one. Once the
  inventory exists (planned with fold), picking up will work here, since it
  writes nothing; what is picked up is folded into an open root.
- **Restore** opens the root as your tab and switches to it; for everyone
  else it is simply no longer archived. **Open** opens an open root as your
  tab. Restoring is the only way to write in an archived root; the host
  refuses anything else there.

### The add tab

The rightmost tab, drawn as an empty tab: a split button, **＋ agent**, with
**conversation** in its menu. A conversation at the root is the rarer start,
so it is the one behind the menu. What each does is under "Starting" below.

### Columns: a path each

- **A column is one path through its tab's tree**, from the root to a leaf,
  read top to bottom. Its composer sends at its last message.
- **Opening a branch adds a column to the right**, starting after the fork. An
  aside of an aside opens a third column.
- **A column's header says who works in it and where it came from**
  (ADR-0040). Its first row names the agent working there, `✦ amber-fox` in
  the column's colour, which leads to where that agent started. While the
  composer's next send would start one, the agent to come is named already
  (ADR-0057), with `✦ new agent` only until its name arrives. A conversation
  shows nothing there, since a message goes to people. Its second row, for a column
  that forks, names the fork, `↰ Ada: “Say exactly…”`, and clicking it brings
  the fork point into view.
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
- **A column grows as replies arrive.** It follows its own tip to the newest
  message below it, including the agent's reply, which may have been written on
  another lane (`followTip`). A branch off an earlier message, however new,
  never pulls it away. This replaces "follow the newest".
- **Columns are reordered by dragging their headers.** Whichever column is
  first shows its whole path, so moving a branch to the far left makes it read
  as the trunk. Nothing in the document changes: which path reads as the trunk
  is a view choice, kept client-side, like selection today. A grip (⠿) leads
  each header, and is the keyboard's way to do the same: ←/→ move a column one
  place, and Home/End move it to either end.
- **Closing a column** removes it from the view, never from the document. Its
  branch is still in the rail. A root tab's only column has no close, since
  the tab would show that path again; a new tab's closes the new tab. The
  cards at a thread's end stay with the thread.
- Each column's composer sits at its foot. The rail scrolls on its own.
- **Above the composer, a work strip says what became of the agent's files**
  (ADR-0040): an agent on its own copy shows its offer in plain words ("2
  files ready"), with **take** and its bookmark, which a press copies; one
  working directly says "changes land directly in your working copy", and
  warns while another agent works in the same directory. Its **⋯** menu
  holds **bring up to date**, and when your edits and the offer conflict,
  **resolve in the thread** does the same: each puts the command on your
  card at the thread's end, making one if you have none, and focuses it: the composer shows "→ bring
  up to date", with a × that sends it as a plain message instead. What you
  write is what the agent should do with the new work (ADR-0055).
- **A column widens to review its offer** (ADR-0047). The offer's line opens
  the review to the right of the thread, which keeps its place and width: a
  file list when there is more than one file, and one scroll of every file's diff, each file's head pinned
  while its diff is in view, with the files that conflict and those you are
  editing flagged.
- On a narrow screen, columns stack as a back-navigable sequence (the macOS
  Finder column view on a phone), with a breadcrumb of fork points.

### Asks: a message to the agent, and what was done for it (ADR-0056)

An **ask** is a message that started a run, together with that run: a
person's message to the agent, a land message or a stack message. A message
for people only is not one. Nothing about an ask is stored; it is read from
the tree.

- **A column is read at one of three densities**, chosen in its header, kept
  with the column and never written. A new column opens in story.

  | density | an ask shows |
  |---|---|
  | **outline** | its message, and one line: how it ended, or what it is doing, and its digest |
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
- **Since you were here.** Each device remembers, per thread, where its
  column's end was when you left it at its end: switching tabs, hiding the
  page or closing it. Coming back, a dashed line, "since you were here",
  marks the first message after it. It takes no room.
- **A summary, when digests are on** (`{ "digests": { "enabled": true } }` in
  `~/.config/pineta/config.json`): a model's two or three sentences on an
  ask's work, under its digest line, set apart from the agent's words. It is
  refreshed at most once a minute while someone reads the running thread,
  written once more when its run ends, and read by no agent.

### The rail: a root's tree, compactly

- A git-graph strip at the left edge draws every branch in the tab's root as a
  line, and every message as a dot, in tree order, except for uneventful
  stretches (below). The tree is centred in the rail.
- **A new tab has a rail too**: a hollow dot where its first message will be.
  It is as wide as the rail it becomes, so the columns do not move when the
  first message lands.
- **A column wears its rail track's colour**, so you can see which branches are
  on screen and where they sit in the whole.
- **Clicking a message in the rail brings it into view**: in the column that
  shows it, or in a new column opened beside it.
- **Uneventful stretches are capsules** (ADR-0031, ADR-0056). A message is
  always its own dot if it is the root's first message, a branch's first
  message, a fork, a thread end, a thread end someone else follows, where
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

The rail is E; the column is T. Seeing both at once is the product.

### Context, drawn

- A message the agent was asked shows as asked (a margin bar), and a divider
  marks **where each agent joined**, by name: `✦ amber-fox joined`, or
  `✦ copper-owl, from amber-fox` in a branch of agent work. Everything above
  it is now that agent's context.

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
- **The send button says what the message will do**: "send", "send to Ada"
  ("send to Ada +2" for three), "send to agent", or, while the agent is busy,
  "queue up next", "queue after Bea" or "queue after yours", naming who
  queued the last card already waiting. It uses the host's own decision (`addressChat`,
  over `threadOf`), so it cannot promise a reply that will not come. When the
  send starts an agent, a chip beside the button says where it will work ("on
  a copy ▾"), and opens the choices.
- **Who else is here** (ADR-0024) shows where there is room for it:
  - the **rail** rings the dot at the end of each thread someone else follows,
    in their colour, with a count when several do; hovering names them. The
    dots are 8 px, so the rail marks and the header names;
  - a **column's header** shows small avatars of the others following its
    thread: this is "seen by", naming only others, and nothing when you are
    alone;
  - the **composer** says "Bea is typing…".

  Presence is thread-level: every column in the tab you are on reports the
  thread it follows. Columns in other tabs report nothing, so a tab's avatars
  are the people looking at it now.
  Which message someone has on screen waits until thread-level proves too
  coarse.

### Starting, branching, and stepping down

- **At the root, two ways to start**, because there is no context yet: a person
  declares a purpose. Both are on the add tab. **＋ agent** opens a new tab
  whose column asks the agent unless a message names someone, so its first
  message creates the lane. **Conversation**, in its menu, opens a new tab
  whose column is a conversation.
- **A new tab is yours until its first send**, as any fresh column is. It sits
  beside ＋, labelled "new agent" or "new conversation", and closing it leaves
  no trace. Its first send makes the root, and the tab becomes that root's
  tab. Others find the root in the Archive tab, and see you in it from the
  header.
- **An empty session** shows only the Archive tab and ＋, and points at ＋.
- **A page with nothing stored** (a new browser, or a first visit) opens on
  the Archive tab, which lists every root to open: nothing opens a tab by
  itself (ADR-0030).
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
- **Tool calls are rows under the agent's message** (ADR-0022): what the call
  touched (`read packages/core/tree.ts`, `bash pnpm test`), then ✓, ✗, or …
  while it has no result, with the result folded away. A long or multi-line
  command is cut in the label, and the opened row shows it whole in its
  place. A result is its own
  entry in the tree, but it belongs to its call, so it adds no message and no
  row on the rail.
- **An image a tool read is drawn in its row** (ADR-0051), which opens on
  its own, capped at 10rem tall. The image takes the place of the caption
  ("Read image file [image/png]"), which is its tooltip; a click on the
  summary shows it whole, and a click on the image opens it in a new tab.
- **While the agent works, its column shows it live**: the reply as it is
  written, and each running command's output in its own row, open, following
  its end as a column does. Each becomes the committed message or result in
  place, and a column at its end does not get shorter while the agent works
  (ADR-0044).
  **Stop** ends the turn, and records who pressed it under the ask
  (ADR-0056); cards queued are then taken.
- **A column says what its agent is doing** (ADR-0054), and none of it moves
  the column. While the agent works, the mark before the thread's name in the
  header (its `✦`, or its banner, ADR-0053) pulses, titled with the ask it
  works on, "the agent is working on Ada: "Fix the rail…"" (ADR-0056). In
  outline, the running ask's own line pulses instead of the line below. A
  short line pulses at the
  end of the column, centred, where its next text will appear. While a
  command that has run for half a second is still running, its row is
  outlined instead, and the line hides: the wait is the machine's, not the
  model's. A quicker command changes neither.
- **A tab shown again draws its tool rows as they were left** (ADR-0049):
  a running command's row open, a row you opened or closed the same way.
- **Pasting an image into a composer puts it in the message** (ADR-0042).
  It is uploaded as it is pasted, and its markdown, `![name](/blob/…)`, goes
  in where the cursor was; the send button reads "uploading image…" until
  it is done. Sent, the message draws the image at its stored size, capped
  at the column's width, and a click opens it in a new tab. The agent is
  given the image itself, after the text. An image no longer stored refuses
  the send, and the text comes back to the box.
- **A message's tools are one row** over its top right, shown on hover or
  focus (ADR-0043): *copy* first, then *edit*, and `→` last, in the
  right margin, since what it opens appears to the right. Copy puts the
  message on the clipboard as markdown: its text as it was written, then
  each tool call it made, the command or path and its whole output. It
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

### Drafting cards (ADR-0048)

- **What you type in a composer is a card on its thread.** The first
  keystroke worth keeping (anything but a branch's `@agent `) makes it. It
  belongs to the thread, not the column: switching tabs, reloading, closing
  and reopening the column, or the host restarting, you find it where you
  left it, and it follows the thread as the thread grows. A new tab's or a
  new branch's card belongs to its column until its first message is sent.
- **Everyone at a thread's end sees everyone's cards there**, above their own
  composer, headed "Ada's draft · with Bea", and can type in any of them and
  send it. A card sent by someone other than its owner is the sender's
  message, "with" the others who wrote in it.
- **Marks say where you left something unsent** (ADR-0048): a small dot in
  your colour on its tab, and on the rail at its thread's end, whether or not
  that thread's column is open. A root whose tab you closed is marked on the
  Archive tab and its row; an archived root only on its row, since its work
  is done. Only your own cards count, and only while they
  hold text: emptied, sent or discarded, the dot goes. A bare `@agent ` is
  nothing typed.
- **Sending spends the card.** The box stays as it was until the host
  answers: written or running, the card is gone and the box empty; a
  conflict or a refusal leaves the card, so nothing is lost or put back.
- **A send to a busy thread queues your card above the line** (ADR-0048), as
  does a card with a command, even on an idle thread. A queued card is drawn
  after the thread's last message, headed "queued by Bea · 1st in line", with
  "→ bring up to date" when it has the command, and **unqueue**. Anyone here
  can edit it until the host takes it, when the lane is free, in order. An
  unqueued card goes back below the line. Unqueue a card the host had already
  taken and your column says "already sent as Bea's message: it was taken
  before you unqueued it". A card the host could not send is back below the
  line saying "not sent: …" until it is queued again.
- **Cmd+Z in a box undoes only that box's card**, never anything in another
  column or tab (ADR-0052). After you undo past a card's first keystroke,
  the box is empty and Cmd+Shift+Z there brings the card back.
- **Cmd+Z and Cmd+Shift+Z** undo and redo your own typing in a card, never
  someone else's. Each tab has its own history, which a reload forgets.
- **Closing a new branch that holds text asks** "discard what you typed?";
  discarding is final.

## What goes away

| today | replaced by |
|---|---|
| "follow the newest" | columns grow on their own; there is no hidden anchor |
| "reading a thread · sending replies here" | every column's composer sends at its own path |
| "make this a conversation" in a bar | nothing: a thread's mode is whether the agent works in it (ADR-0021) |
| "⑂ 1 branch · 2 messages" with a hidden list | the rail, and a coloured fork dot in the column |
| "switch to this path" (`navigate`) | nothing: sending attaches where you are reading |
| every tree in one rail, one after another | a tab per root, each with its own rail (ADR-0029) |
| a column on another root, with no stripe and no fork dot | nothing: a tab's columns share its root |
| the rail's `+`, and Start Chat and Start Agent in place of a composer | the add tab: ＋ agent, or conversation |
| a tab bar shared by everyone, with no close for yourself | your tabs, with **×** (ADR-0030) |
| a new root by anyone appearing as a tab | the header's avatars and `@`; you open it |

The last row mattered for `PLAN-2026-09-26-thread-lanes`: with no control moving
a lane, the `navigate` command had no caller and was deleted with `prompt` and
`branch`. Lanes now never move at all (ADR-0020).

## Data

Every part of this is a read of what the document already holds, except the
archive record (ADR-0029); a card's text is its own document (ADR-0048).

- **A column** is a client-local anchor entry. Its path is `projectTranscript`
  of `followTip(anchor)`, or, once it is bound to a lane, of the lane's tip;
  the part after its fork point is the suffix below the column to its left.
- **The rail** is the tree itself, from `parentId`, drawn in id order, which is
  creation order (uuidv7).
- **A thread's mode** is its lane; **names** are `pineta.participant` values.
- **A root** is a root of the tree index (an orphan counts as one). **Your
  tabs** are the roots in your layout's open list that have no `archived`
  record, plus the root you are on.
- **The header** reads presence (people, and the thread each is in) and the
  lanes (the agent's running threads). **Mentions of you** are the chats whose
  mentions `address` resolves to you. **What you have seen** is kept in the
  device's `localStorage`, never in the document: an entry id (`since`), at or
  before which every mention is seen, and the ids of later ones you have seen.
- **The archive** is a host-written `pineta.archive` value per root: its state
  (`archived` or `restored`), who changed it and when (ADR-0029). The host
  refuses commands that would write in an archived root.
- **Which tab you are on, your open roots and each root's columns** are view
  state, kept in the browser per browser tab, with the device's latest for a
  new one, and never in the document (ADR-0027, amended by ADR-0029 and
  ADR-0030).

## Deferred, but designed for

- **Narrow screens**: the stacked sequence described above, with the tab bar as
  a switcher above it; built after the wide layout works.
- **What's new since you looked** (ADR-0030 defers it): a last-read position
  per root gives unread marks on tabs, a "3 new" count in the header, and a
  "what's happening" panel listing roots by activity. It can reuse the
  inbox's storage and its rule for "seen".
- **The inbox, grown:** **done** to take a handled mention off it; other kinds
  of item, such as the agent finishing what you asked; one inbox per person
  across devices, once a person has an identity; browser or system
  notifications, which need permission.
- **The review, grown** (ADR-0047): side-by-side diffs; a review of one turn,
  its revision record's commit, through the same URLs; "ask about this" on a
  hunk, which puts its path, line and quoted lines into the column's
  composer; on narrow screens, the review as one more step in the stacked
  sequence; the agent's edit tool rows drawn as diffs, if pi's results carry
  them.

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
