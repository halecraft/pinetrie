# ADR-0111 — Everything you move is a card on a surface; a text card put on the board becomes a thread card

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `docs/06-interface.md`
- **Evidence:** S139
- **Amends:**
  - ADR-0048: a card has one anatomy in every place (header, body, footer),
    coloured by its place; its moves are one "Move to ▸" in its ⋯; × discards
    it, and the undo key brings it back; the composer is your open drafting
    card, and the line is drawn.
  - ADR-0112: a board item is a thread card; a text card put on a board state
    becomes a conversation root there, which the undo key lifts back into the
    card while the root holds only that message; "your list" is the sidebar,
    which shows your open threads.
- **Revised:**
  - 2026-10-08 (S139): a queued card's primary action is none, since ADR-0113
    put the one control in the queue's header; the undo key's lift reads the
    cards its step moves before it reverts them.
- **Amended by:**
  - ADR-0113: the drafts leave the column for the notes board; the column's
    foot is a dock of the queue, the line and your message, whose queue header
    says what happens next and holds the one control for it.
  - ADR-0116: a thread card is a thread, held by a task or an inventory; a
    text card on a board state starts a task.

**Context.**

- **A card has no look of its own.** ADR-0048 says a card looks and edits the
  same in every place (Physics 6), but no place draws it the same way. A
  queued card is a box with a dashed left edge, then a row of five buttons of
  one colour and three sizes: ↑, ↓, unqueue, take, history. A drafting card
  is a box with a row of pin, history, take and its send. Nothing tells a
  queued card from a drafting one but that edge.
- **The composer is half a card and half a menu.** It is a drafting card
  (ADR-0048: "the composer is the one drafting card"), but it is drawn as a
  box under a row of "+ card", pin, history, take and "send to agent", with
  the offer strip, Stop or Resume, and the queue's controls between it and
  the other drafting cards. "+ card" sets your card aside above that strip,
  so it reads as your text jumping away.
- **The line is not drawn.** Above it the agent will act; below it only
  people do (ADR-0048). The column shows neither the line nor which side a
  card is on.
- **Some buttons act on a card, some on its place, and they look alike.**
  "+ card", "+ pin", hold, release and "unqueue all" act on a place; pin,
  unqueue and take move one card; send acts on its text.
- **A card cannot be removed where it is.** Only the inventory's remove
  deletes one, so clearing an empty queued card means take, open the
  inventory, remove.
- **"take" on a queued card reads as "do this now".** It takes the card into
  your inventory (ADR-0083).
- **The board's items behave as cards and are not called cards.** Each
  drags, has a ⋯ with "Move to ▸", Move up and Move down, and shows its
  signals before its label. ADR-0112 avoided the word because "card" meant
  unsent text.
- **An idea already becomes a thread.** A fresh column's card becomes a root
  on its first send (ADR-0048, Physics 1, amended in step 4), but no object
  on screen shows that happening, and a card in your inventory cannot be put
  on the board to start one.
- **"Your list" is vague.** People call it the sidebar.

**Decision.**

*Cards and surfaces.* The workspace is built from two shapes. **A card** is
something you pick up and put down. **A surface** is somewhere you put it.
Every surface takes a drop and a put, as ADR-0048's fidelity rule has it.
There are two kinds of card: a **text card** is unsent text (ADR-0048's
card), and a **thread card** is a root (ADR-0112's item). Messages are not
cards: they are the past, and lie flat in their thread; taking a copy of one
makes a text card, as now.

*A card's anatomy*, the same for both kinds and in every place:

- **The header is its grip and its signals.** Dragging it moves the card. It
  holds the card's icon, its state ("next", "2nd in line", "held",
  "sending…", "Bea is typing", "not sent: …", a command's chip), who put it
  there, a ⋯ for its rarer actions, and, on a text card, × to discard it.
- **The body is its content**, edited in place on a text card.
- **The footer has at most one primary action**, filled in the card's
  colour, and small icon buttons of one size for frequent tools, such as ↑
  and ↓ in a queue. Everything else is in the ⋯.

*A text card is coloured by its place*, which says who reads it (ADR-0048's
three rings):

| place | colour | icon | primary action |
|---|---|---|---|
| your inventory | yours | bag | put |
| drafting, below the line | neutral | pencil | send, or queue: its label says where the card goes |
| queued, above the line | blue: the agent reads it once | its place in line | none: the queue's header holds the one control (ADR-0113) |
| pinned | violet: the agent reads it every run | pin | none |

A command is a chip in the header, not a colour. A fact (ADR-0080) stays a
plain line: nobody moves or edits it. No card takes its thread's colour.

*A text card's moves are one menu.* Pin, unqueue, take and queue are each a
move to another place, so the ⋯ holds **Move to ▸** (queue, pinned, drafts,
inventory) and **History**, and drag makes the same moves. **×** discards
the card wherever it is, the inventory's remove included, and the undo key
outside a box brings it back: Physics 7's "every move can be undone, except
send" counts a discard as a move.

*A surface has a header too*, for what acts on the surface: a queue's
"held by Bea", **release** and **unqueue all**; drafts' **+ card**; the
pinned strip's **+ pin**; a board state's ＋. The line is drawn between a
thread's queue and its drafts:

```
QUEUE · held by you                release · unqueue all
  [queued card]
  [queued card]
━━━━━━━━━━━━━━━━━━━━━━ the line ━━━━━━━━━━━━━━━━━━━━━━━
DRAFTS                                          + card
  [Bea's card, folded]
  [your card, open]
```

*The composer is your open drafting card*, with the same header, body and
footer. Other cards in the drafts fold to their header and first line, and
open when focused. **+ card** folds yours into the drafts and opens a new
one. The offer strip and the run's controls leave the space between them.

*A thread card* is a root, in the same frame:

- **Header:** its status mark (ADR-0077), its title, ⇡ when work is ready,
  your dot when it holds something you typed, and its ⋯ (Move to ▸ a state,
  Move up, Move down).
- **Body:** what the thread is for: its pinned cards, else its first message.
- **Footer:** who wrote in it, and who is reading there.

A thread card is neutral: its status mark carries the signal.

*A text card put on a board state becomes a thread card.* The put starts a
conversation root in that state (ADR-0112: a backlog item is a conversation
root), whose first message is the card's text, by whoever put it; the card
is spent, as a send spends it. "＋ agent" and a fresh column make the same
change, from a card that has no place yet. The undo key lifts the thread
card back into the text card, where it came from, and deletes the root,
while the root holds only that first message; once anyone replies there or
the agent starts, it is sent like any message.

*The sidebar shows your open threads.* "Your list" is renamed **the
sidebar**, and what it holds **your open threads**. Opening a thread card
does not move it: it stays on the board, which shows you reading there, and
the sidebar draws it folded to its header. Closing it there writes nothing
shared and puts nothing anywhere (ADR-0112's ×).

*Deferred:* a thread card dropped into a text card or the inventory, as a
link to the thread.

**Consequences.**

- One card component draws every text card, and the board and the sidebar
  draw thread cards in the same frame. The composer, the queued card's and
  pinned card's editors, and the inventory's slot share it.
- "take" leaves a card's footer; "take into your inventory" is a Move to ▸
  item, the drag and Ctrl+Shift+I.
- A discard becomes a move the host can undo, so a discarded card's record
  and text are kept until the undo stack lets go of them; the close ask's
  discard stops being final.
- Deleting a root is new. Nothing deletes a root today (ADR-0004: the tree
  is immutable, but a root with one message and no reply has said nothing
  anyone answered).
- A board state becomes a put target for text cards: the inventory's put
  and the fidelity test (`put-target.test.ts`) reach it.
- `docs/06-interface.md`, the glossary and the code rename "your list" to
  the sidebar and board items to thread cards (`BoardItem`, `open-list`),
  when this is accepted.
- The run's controls and what goes next are not settled here: where Stop,
  Resume and release sit, and how the column shows what will happen next,
  is a decision of its own, made on this anatomy.

**Alternatives rejected.**

- **One frame, two kinds that never change into each other.** Thread cards
  and text cards would look alike, but an idea in your inventory could not
  become a thread by being put on the board. The point is that things feel
  tangible: what you hold is what you start.
- **Unsent cards staying on the board as backlog items** (ADR-0112 rejected
  it too). A card put on the board becomes a root at once, so the board
  still holds one kind of item and an idea still has a place to be
  discussed.
- **The composer as a plain box, with card chrome only once text is set
  aside.** Lighter, but it keeps the composer half a card.
- **Colour by thread.** The colour says who reads a card, which its place
  decides; the thread is already the column it is in.
- **Opening a thread as taking it off the board into the sidebar.** A root
  is everyone's: taking it into a place of yours would take it from
  everyone (ADR-0112).
- **"Your list" and "desk" as names.** "Your list" says nothing about what
  it lists; "desk" asks people to learn a metaphor for a sidebar.
- **Pin, unqueue and take as buttons on every card.** Each is a move; as
  buttons of one colour and size they crowded out the card's one primary
  action.
