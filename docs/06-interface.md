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
5. **Say the effect, not a mode name.** "send · agent will reply" says what
   happens. "Working session" is a name someone has to learn. So there is no
   mode to set: the send button says what each message will do (ADR-0021).
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
│ ●    ││ Ada: @Bea have a look →││   what about X?       ││   agent: …         │
│ ◉    ││ Ada: @agent … ◉replying││                       ││                    │
│      ││ ┌──────────────────────┐││ ┌───────────────────┐││ ┌────────────────┐ │
│      ││ │ ask the agent…  send │││ │ reply in thread…  │││ │ …              │ │
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

### Who a message is for (ADR-0021)

- **A thread's mode is whether the agent works in it**, which is whether it has
  a lane. In agent work, a message that names no one asks the agent; in a
  conversation, only `@agent` does. Nothing is set or stored, so there is no
  rule to mark and no mode to toggle.
- **Mentions pick who a message is for.** `@agent` asks the agent. A message
  naming only people goes to them, in agent work too. A handle that names no
  participant (`@types/node`) is ignored. A person's handle is their name as
  shown, in lower case, keeping only letters and digits (in any script), `_`
  and `-`: `@adalovelace`, `@josé`, `@日本`, `@guest-x4bu`. A name with no
  such character, or spelled `agent`, is refused: no mention could reach it.
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

  Presence is thread-level: every open column reports the thread it follows.
  Which message someone has on screen waits until thread-level proves too
  coarse.

### Starting, branching, and stepping down

- **At the root, two ways to start**, because there is no context yet: a person
  declares a purpose. **Start Chat** opens a conversation. **Start Agent** opens
  a column whose messages ask the agent unless they name someone, so its first
  message creates the lane. An empty session offers both in place of a
  composer; afterwards, the rail's `+` offers them above the root threads.
- **`→` in a message's right margin opens a branch** as a column to its right,
  empty until something is sent there. What it opens appears to the right, so
  the button sits on that side. A branch starts as a conversation; `@agent`
  there makes it agent work.
- **At an agent thread's end, `→` steps back down**: a conversation continuing
  from there, reading everything above. The agent thread's column keeps
  following its lane. At a conversation's end `→` is hidden, since it would be
  the same as replying.
- Every one of these only opens a column. Nothing is written until the first
  send, and closing the column first leaves no trace.

### Messages

- The speaker's name heads each human message; the agent's messages are marked
  as the agent's.
- **Tool calls are rows under the agent's message** (ADR-0022): what the call
  touched (`read packages/core/tree.ts`, `bash pnpm test`), then ✓, ✗, or …
  while it has no result, with the result folded away. A result is its own
  entry in the tree, but it belongs to its call, so it adds no message and no
  rail dot.
- **While the agent works, its column shows it live**: the reply as it is
  written, and each running command's output, kept scrolled to its end.
  **Stop** ends the turn; messages waiting are then taken.
- A message's tools (cite, and `→` in the margin) appear on hover or focus;
  beneath it stay only branch buttons and citation counts.
- **Cite** stays an action on a message or a text selection. A reference draws
  as a link between columns when both ends are open, and as a count otherwise.

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
- **The notes index**, *notes (n)* at the top of the rail, lists every note,
  newest first, by its first line, state and writers; filters show drafts,
  open, done, changed since done, and mine. A row opens its note's column.

## What goes away

| today | replaced by |
|---|---|
| "follow the newest" | columns grow on their own; there is no hidden anchor |
| "reading a thread · sending replies here" | every column's composer sends at its own path |
| "make this a conversation" in a bar | nothing: a thread's mode is whether the agent works in it (ADR-0021) |
| "⑂ 1 branch · 2 messages" with a hidden list | the rail, and a coloured fork dot in the column |
| "switch to this path" (`navigate`) | nothing: sending attaches where you are reading |

The last row mattered for `PLAN-2026-09-26-thread-lanes`: with no control moving
a lane, the `navigate` command had no caller and was deleted with `prompt` and
`branch`. Lanes now never move at all (ADR-0020).

## Data: nothing new

Every part of this is a read of what the document already holds; a note's text
is its own document (ADR-0025).

- **A column** is a client-local anchor entry. Its path is `projectTranscript`
  of `followTip(anchor)`, or, once it is bound to a lane, of the lane's tip;
  the part after its fork point is the suffix below the column to its left.
- **The rail** is the tree itself, from `parentId`, drawn in id order, which is
  creation order (uuidv7).
- **The lit path** is the agent's run's path: the agent's lane tip while
  `activeRuns` has its lane.
- **A thread's mode** is its lane; **names** are `pineta.participant` values.
- **Which columns are open, and in what order**, is view state, never written.

## Deferred, but designed for

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
