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
5. **Say the effect, not a mode name.** "send · agent will reply" says what
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
│      ││ │ ask the agent…  send │││ │ reply in thread…  │││ │ …              │ │
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

### Root tabs: the roots you have open (ADR-0029, ADR-0030)

A conversation's context is its path to its root, so nothing in one root is
ever in the context of another. That is where the screen splits.

- **A root tab shows one root's tree**: its rail, and its columns. Every column
  in a tab shares the root.
- **Your tabs are yours:** the roots you have open, in the order you opened
  them. **×** closes one for you and writes nothing; opening it again brings
  its columns back. A root you start opens as your tab; a root someone else
  starts does not, and reaches you through the header, a mention, or the
  Archive tab.
- **A tab's label** is its first message's text, cut short, until a mark names
  it (ADR-0028).
- **A tab shows what happens in it while you are elsewhere:** a pulse while the
  agent is working there, and small avatars of the others reading there. For
  the roots you have not opened, the header shows the same.
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
  it, its messages and notes, and its state. Filters: archived, open, mine.
  Search over message text.
- **Selecting a row previews it:** that root's rail, and one read-only column
  that a pick on the rail moves. Its composer is disabled, and none of the tools that
  write are there: branch, edit, mark, cite. In place of sending it offers
  **Restore** for an archived root, and **Open** for an open one. A citation is written where its author is reading,
  which here is the archived root. Once the inventory exists (planned with
  fold), picking up will work here, since it writes nothing; what is picked up
  is cited or folded into an open root.
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
- **Colour, not lines, links a branch to its parent.** Each open branch takes
  its rail track's colour: its column's header carries a stripe of it and names
  the fork ("from Ada: 'Say exactly…'"), and the fork point in the parent column
  shows a dot of it. Hovering either end highlights the other; clicking the dot
  scrolls to the branch's column. Sibling branches off one column never cross,
  as drawn lines would.
- **Each column scrolls on its own.** A new column opens scrolled so its first
  message is level with its fork point; after that it scrolls freely. Forks far
  apart (message 2 and message 95 of a long trunk) are both readable at once.
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
  the tab would show that path again; a new tab's closes the new tab.
- Each column's composer sits at its foot. The rail scrolls on its own.
- On a narrow screen, columns stack as a back-navigable sequence (the macOS
  Finder column view on a phone), with a breadcrumb of fork points.

### The rail: a root's tree, compactly

- A git-graph strip at the left edge draws every branch in the tab's root as a
  line, and every message as a dot, in tree order, except for uneventful
  stretches (below). The tree is centred in the rail.
- **A new tab has a rail too**: a hollow dot where its first message will be,
  and the notes toggle, disabled. It is as wide as the rail it becomes, so the
  columns do not move when the first message lands.
- **A column wears its rail track's colour**, so you can see which branches are
  on screen and where they sit in the whole.
- **Clicking a message in the rail brings it into view**: in the column that
  shows it, or in a new column opened beside it.
- **Uneventful stretches are capsules** (ADR-0031). A message is always its own
  dot if it is the root's first message, a branch's first message, a fork, a
  thread end, a note's message, a thread end someone else follows, where the
  agent is replying, or the end of a column you have open. Three or more other
  messages in a row are one capsule on their track: 2 rows long for 3–9
  messages, 3 for 10–99, 4 for 100–999. It is hollow when only the agent
  wrote in it, solid when only people did, and filled at half strength for
  both; its
  tooltip gives the counts, failed tool calls included. Clicking
  it opens the message at that point of the run: near its top, the first;
  three quarters down, the message three quarters through. The column is where
  it is read.
- **Activity shows in the rail**: a pulsing dot where the agent is replying, a
  mark where a branch has messages you have not read.

The rail is E; the column is T. Seeing both at once is the product.

### Context, drawn

- A message the agent was asked shows as asked (a margin bar), and the thread
  marks **where the agent joined**, since everything above it is now its context.

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
- **The send button says what the message will do**: "send", "send · to Ada",
  "send · agent will reply", or "queue · agent replies after Bea". It uses the
  host's own decision (`address`, over `threadOf`), so it cannot promise a
  reply that will not come.
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
  while it has no result, with the result folded away. A result is its own
  entry in the tree, but it belongs to its call, so it adds no message and no
  row on the rail.
- **While the agent works, its column shows it live**: the reply as it is
  written, and each running command's output, following its end as a column
  does.
  **Stop** ends the turn; messages waiting are then taken.
- A message's tools (cite, and `→` in the margin) appear on hover or focus;
  beneath it stay only branch buttons and citation counts.
- **Cite** stays an action on a message or a text selection. It is attached at
  the end of the column it was used in. A reference shows as counts: "↗ cites
  n" on the message it is attached to, and "↙ cited by n" on what it cites.
  Neither leads anywhere yet, and the agent does not read references
  (ADR-0017). A link drawn between columns when both ends are open was
  designed, but never built.

### Notes, and drafting together (ADR-0025)

- **Any message can be opened for editing**, the agent's replies included:
  *edit* is among its tools. It becomes a **note**, drawn in place of its text
  as a card everyone can type in at once. The card's header says its state,
  who has written in it, and who is editing it now. The message itself stays as
  sent, which is what the agent read.
- **Compose together**, under a column's composer, starts the thread's shared
  draft with whatever is typed. There is one draft per thread end: another
  person's column following that thread shows "Ada is drafting the next
  message · join". *Send* on the draft sends it as a reply from that column,
  with the send button's usual effects: it may queue, or be a conflict, which
  keeps the draft. It then reads "Ada, with Bea".
- **Done** makes a note read-only; *reopen* makes it editable again, and a
  reopened note, once edited, reads "changed since done". A sent draft is done.
- **While the note being edited is scrolled out of view**, a bar at the top of
  its column leads back to it.
- **On the rail, a note's message is a square.** A closed branch's button
  counts its notes: "⑂ 6 messages · 1 note".
- **The notes index**, *notes (n)* at the top of the rail, lists the notes in
  the tab's root, newest first, by its first line, state and writers; filters
  show drafts, open, done, changed since done, and mine. A row opens its
  note's column.

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
archive record (ADR-0029); a note's text is its own document (ADR-0025).

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
