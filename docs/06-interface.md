# Interface: columns for reading, a rail for shape

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
   not invent one. Whatever you put first is what reads as the trunk.
4. **Show context, don't describe it.** What the agent will read is a path; draw
   that path lit and everything else not.
5. **Say the rule, not a mode name.** "Agent replies: always" says what happens.
   "Working session" is a name someone has to learn.
6. **Every control is a choice the user made.** Nothing appears because of
   internal state.

## Layout

```
┌ rail ┐┌ column 1 ──────────────┐┌ column 2 ─────────────┐┌ column 3 ──────────┐
│ ●    ││ Ada                    ││▌from Ada: "Say…" (blue)││▌from agent (green)  │
│ │    ││ Say exactly: OK  ●blue ││ Bea                   ││ Ada                │
│ ├──● ││ agent: OK              ││ an aside              ││ aside of aside     │
│ │  │ ││ Ada                    ││ agent: …      ●green  ││ agent: …           │
│ │  ● ││ just a note            ││ Bea                   ││                    │
│ ●    ││ ─ from here: agent     ││   what about X?       ││   agent: …         │
│ │    ││   replies when @agent ─││                       ││                    │
│ ◉    ││ Ada: @agent … ◉replying││                       ││                    │
│      ││ ┌──────────────────────┐││ ┌───────────────────┐││ ┌────────────────┐ │
│      ││ │ say something…       │││ │ reply in thread…  │││ │ …              │ │
│      ││ │ seen by Ada, Bea     │││ │ agent will reply  │││ │                │ │
│      ││ └──────────────────────┘││ └───────────────────┘││ └────────────────┘ │
└──────┘└────────────────────────┘└───────────────────────┘└────────────────────┘
```

### Columns: a path each

- **A column is one path through the tree**, from the root to a leaf, read top to
  bottom. Its composer sends at its last message.
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
- **The shared part of paths is shown once.** A column shows only what follows
  the deepest entry it shares with any column to its left; its header says where
  it came from.
- **A column grows as replies arrive.** It follows its own tip to the newest
  message below it, including the agent's reply, which may have been written on
  another lane (`followTip`). A branch off an earlier message, however new,
  never pulls it away. This replaces "follow the newest".
- **Making a branch the main thread is moving its column to the left.** Nothing
  in the document changes; which path reads as the trunk is a view choice, kept
  client-side, like selection today.
- **Closing a column** removes it from the view, never from the document. Its
  branch is still in the rail.
- Each column's composer sits at its foot. The rail scrolls on its own.
- On a narrow screen, columns stack as a back-navigable sequence (the macOS
  Finder column view on a phone), with a breadcrumb of fork points.

### The rail: the whole tree, compactly

- A git-graph strip at the left edge draws every branch that exists as a line,
  and every message as a dot, in tree order.
- **Open columns are highlighted** in the rail in their colours, so you can see
  which branches are on screen and where they sit in the whole.
- **Clicking a branch in the rail opens it as a column**, or scrolls to it if it
  is open.
- **Activity shows in the rail**: a pulsing dot where the agent is replying, a
  mark where a branch has messages you have not read.

The rail is E; the lit column is T. Seeing both at once is the product.

### Context, drawn

- **When the agent is replying, the path it reads is lit**: that column from the
  root to the message it is answering, including the part shown in columns to
  the left. Everything else dims. This is the E/T distinction, visible while it
  matters.
- A message the agent was asked shows as asked (a margin bar), and the thread
  marks **where the agent joined**, since everything above it is now its context.

### Rules where they start

- The reply rule is a **marker in the thread at the entry it is set at**:
  "from here, the agent replies only when @agent is mentioned", or
  "from here, the agent replies to every message". A new session starts with the
  agent replying to every message, and needs no marker.
- **Changing the rule is an action on a message** ("agent replies from here:
  always / when @mentioned"), so where it applies is never hidden.
- The composer states the effect before each send, as today: **seen by** whom,
  and **"agent will reply"** when it will. It uses the host's own decision
  (`compelledResponder`), so it cannot promise a reply that will not come.

### Messages

- The speaker's name heads each human message; the agent's messages are marked
  as the agent's.
- **Branch from here** is an action on any message but a column's last: it
  opens a new column at that message with an empty composer, and the branch
  exists once something is sent. On the last message, replying is the
  column's own composer.
- A message's tools (cite, branch, the reply rule) appear on hover or focus;
  beneath it stay only branch buttons and citation counts.
- **Cite** stays an action on a message or a text selection. A reference draws
  as a link between columns when both ends are open, and as a count otherwise.

## What goes away

| today | replaced by |
|---|---|
| "follow the newest" | columns grow on their own; there is no hidden anchor |
| "reading a thread · sending replies here" | every column's composer sends at its own path |
| "make this a conversation" in a bar | a rule set on a message, with a marker there |
| "⑂ 1 branch · 2 messages" with a hidden list | the rail, and a coloured fork dot in the column |
| "switch to this path" (`navigate`) | nothing: sending attaches where you are reading |

The last row matters for Phase 7 of `PLAN-2026-09-26-humans-in-the-tree`: once no
control moves a lane without sending, the `navigate` command has no caller and
is deleted with `prompt` and `branch`.

## Data: nothing new

Every part of this is a read of what the document already holds.

- **A column** is a client-local anchor entry. Its path is `projectTranscript`
  of `followTip(anchor)`; the part after its fork point is the suffix below the
  column to its left.
- **The rail** is the tree itself, from `parentId`, drawn in id order, which is
  creation order (uuidv7).
- **The lit path** is the agent's run's path: the agent's lane tip while
  `activeRuns` has its lane.
- **Rule markers** are `pineta.thread` values; **names**, `pineta.participant`.
- **Which columns are open, and in what order**, is view state, never written.

## Deferred, but designed for

- **Presence** (its own plan): avatars in the rail at the branch each person is
  reading, and "typing" in a column's composer.
- **Shared composition**: a draft anchored at any message appears in that
  column, and in the rail as a pending dot.
- **Narrow screens**: the stacked sequence described above; built after the wide
  layout works.

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
