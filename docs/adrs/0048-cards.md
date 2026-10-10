# ADR-0048 — Everything unsent is a card, and a card stays where you put it

- **Status:** Accepted
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/rules/TECHNICAL.md`
- **Evidence:** S19, S24, S28, S58, S64, S69, S75, S76, S82, S90, S92, S101,
  S107
- **Supersedes:**
  - ADR-0025: notes on messages are removed, with their records, done and
    reopen, the notes index and the rail's squares; what you write is a card.
  - ADR-0026: a queued message is a queued card, which anyone can edit or
    unqueue; the take is one synchronous step on the host (S69).
- **Amends:**
  - ADR-0020: what waits for a busy lane is a queued card, written by clients
    and taken by the host; nothing waits in `pinetrie.outbox`, which is gone.
  - ADR-0023: clients write cards, the cards document and each card's text,
    directly; the host writes pi's tree, and a card only to spend it.
  - ADR-0024: `editing`, the note a seat was editing, is removed with notes.
  - ADR-0037: the host writes a record of each seat's person (`pinetrie.seat`)
    as it connects, so a text's writers can be named after they leave.
  - ADR-0043: no note sits below a message, and the row of tools is copy, edit
    (or new tab), `→`.
  - ADR-0046: every agent thread's `<rules>`, a lane of its own or not, holds
    one more fixed line, first: the team pins cards to say what it wants from
    the thread, they appear in `<pinned-cards>` blocks, and the latest block
    holds. It is constant, so a lane's prompt still stays the same between
    runs.
  - ADR-0056: a Stop with a message card queued holds the thread's queue, so
    the run's end sends nothing until someone releases it.
  - ADR-0082: a held queue does not hide Resume. Its cards wait for a release,
    not for this turn; cards queued and not held still do.
- **Revised:**
  - 2026-10-02: a queued card is *unqueued*, not stopped; "stop" is a run's
    word (ADR-0056).
  - 2026-10-02 (with Duane): the drawer is the *inventory*, a floating panel
    that snaps left, centre or right; take is Ctrl+Shift+I and put
    Ctrl+Shift+O; it crosses sessions, a page per session; it replaces the
    fold plan's private inventory.
  - 2026-10-03 (with Duane): closing a fresh column keeps its cards in your
    inventory by default, and discard stays final (*Closing a column*); a
    fresh column's first send carries its other cards to the new message, the
    host's write (*Physics*, 1); clipboard copy and cut of cards wait for the
    key system's redesign (*Input*).
  - 2026-10-04 (S92, with Duane): *Pinned cards and the agent*: each run's
    cards entry restates every pinned card and names those unpinned since; it
    goes in with the run's prompt, only when the cards changed; pi's
    compaction carries it; the run waits for its sender's text; a branch
    starts with no pinned cards.
  - 2026-10-05 (with Duane): "+ pin" is in the column's header while a thread
    has no pinned card.
  - 2026-10-05 (with Duane): who contributed to a card waits for Kyneta: step
    1's attribution stays until Kyneta can name the writers whose text still
    stands without pine·trie unwrapping Yjs (*Who contributed*).
  - 2026-10-05: *Other people*: where history and traces live, an unpin
    treated as an unqueue, "on your screen" as an open column, a trace seen as
    deleted by the host, and the 30-day sweep.
  - 2026-10-05 (with Duane): step 7, in *The column, read as time*, *Physics*
    and *Input*: a held queue, Stop holding it, unqueue all, reordering queued
    and pinned cards, and the wait while someone types in the next card.
  - 2026-10-09 (with Duane, ADR-0116): a note moved by someone else leaves no
    trace. A note column is everyone's scratch, so traces are left only at
    queued and pinned places (*Only shared places leave traces*).
- **Amended by:**
  - ADR-0052: Cmd+Z in a card undoes only that card's steps, never the tab's
    last step wherever it is, and undoing a move first shows where it acts.
  - ADR-0059: a card's place has one owner at a time, the session's host or a
    person's inventory; the host writes places, and moves between owners are
    handoffs it applies or refuses; the inventory is a document of slots that
    only its person's tabs write; the cards document goes.
  - ADR-0066: moves are undone by the host's Kyneta stacks, one per person and
    root, whole or refused (*Undo is Kyneta's* covers moves too, on the host);
    step 4's decision 11, the page's own history of moves, is withdrawn.
  - ADR-0083: a person *takes a card into the inventory*, and the host *pops
    the next queued card* to send it; "take" alone names neither.
  - ADR-0111: a card has one anatomy in every place (header, body, footer),
    coloured by its place; its moves are one "Move to ▸" in its ⋯; × discards
    it, and the undo key brings it back; the composer is your open drafting
    card, and the line is drawn.
  - ADR-0113: a card below the line is a note, laid out on its thread's notes
    board, a shared grid; a composer shows only its owner's card; "add to
    queue" on an idle thread holds the queue, and a send from the composer
    releases it.
  - ADR-0116: a card can be pinned to a task, and read by every thread of it.
  - ADR-0117: a card in an inventory is its holder's alone, and links to it
    say who has it.
  - ADR-0126: a card's history is of its content as well as its places, and a
    trace is one way of drawing it.
  - ADR-0128: an agent can queue a card, in another thread's dock, by asking
    that thread's agent while it is busy.

Steps 1 to 7 are built, but for step 6's contributors, which wait for Kyneta.
Probe 2 is answered by S69, probes 1 and 4, for the inventory, by S75 and S76,
and probe 5 by S92; S107 found a real model acts on the pinned cards it reads,
a retired one included.

**Context.**

The composer keeps its text in React state (`useState` in
`packages/client/composer.tsx`). The columns of other root tabs are
unmounted (`packages/client/TECHNICAL.md`, "Columns of other tabs are
unmounted"), so switching tabs throws away what was typed, and so does a
reload.

The bug points at something larger. A developer supervising several agents
switches context all the time: another tab, an agent finishing, the next
morning. Each switch costs whatever they were holding in their head, and the
composer is the only place to put it down. It serves at least six purposes:

1. the next instruction, half-formed;
2. a follow-up to a run still going;
3. a thought for another thread, typed here because this box was nearest;
4. a plan of several steps, to send one at a time;
5. notes to yourself: what to check in the offer, what to ask Bea;
6. staging: pasted logs, images and snippets, collected before writing.

Only the first is "the next message here". Someone who loses a paragraph once
starts keeping a scratch file in another app, and their planning leaves
pine·trie, where no agent or collaborator can see it.

pine·trie already has most of the pieces, as separate things: notes on messages
and shared drafts (ADR-0025), queued notes (ADR-0026), the fold plan's private
inventory, and the composer. Each has its own rules. What a person needs is one
concept that lowers the cost of learning the whole system, and the relief of
finding what they left exactly where they left it, changed only by signals
worth investigating.

Three principles guided the design:

1. **I put it there, so I know where it is.** Nothing moves by itself. A move
   made by someone else leaves a signal where the thing was.
2. **Everything operates under the same physics.** One kind of object, one set
   of verbs, the same rules everywhere.
3. **User input is sacred.** Nothing typed is lost: not on a tab switch, a
   reload, a host restart, a closed column or a discard.

**Decision.**

*The concept.* **The tree is what was said; cards are what you're thinking.**
A message is the past: frozen (ADR-0004), in the tree, read by the model. A
card is the present and the future: live text, somewhere you put it. The model
reads a card only above the line: a pinned card on every run, a queued one when
it is taken and becomes a message. Everything unsent is a
card: the composer's text, a draft, a queued step, a thought. "Note" is renamed
"card" everywhere, UI, code and docs, with nothing kept for compatibility.

*Places.* A card is always in exactly one place, and its place decides what
happens to it and who sees it.

| place | a card there is | who sees it |
|---|---|---|
| pinned, at the top of a column | about the whole thread: its direction, what everyone working in it should hold in mind | everyone, and the agent on every run |
| the tree | sent: it is a message now | everyone, and the agent |
| above the line, at a thread's end | queued: the agent takes these in order | everyone, and the agent once taken |
| below the line, at a thread's end | drafting: only people move these | everyone |
| your inventory | yours, going nowhere | you |

**Visibility comes in three nested rings, and position says which:** your
inventory is yours; below the line is the team's; above the line, pinned cards,
messages and queued cards, is the team's and the agent's. Moving a card up
widens who sees it, and moving it down narrows it. There is no setting for
who reads a card: a thought only for the team goes below the line.

- **Cards belong to a thread, not a column.** A column is your window; the
  thread is the shared thing. A tab switch, a reload or a second device mounts
  a new column on the same thread and finds the same cards: this is what fixes
  the bug. A card follows its thread as the thread grows, resolved through
  `threadOf` as drafts are today (`noteAt`, `packages/marginalia/note.ts`).
  Where a conversation forks at its end, the card follows the side `threadOf`
  counts as the thread; in agent work, the lane decides.
- **A place can hold several cards.** Usually one pinned card and one drafting
  card; nothing stops two people each pinning one, or one person drafting the
  next instruction beside a card about the bigger picture. "+ card" in the
  composer asks for another drafting card; the one you were writing is drawn
  above the box with the column's other cards. "+ pin" opens a box that
  makes a pinned card: in the strip once it has one, else in the column's
  header, since the empty strip shows only while a card is dragged.

*The column, read as time.*

```
┌ column ─────────────────────────┐
│ Fix the sync bug                │  title (ADR-0039)
│ ┌ pinned ─────────────────────┐ │  the thread's direction;
│ │ what we're after, and why   │ │  the agent reads it every run
│ └─────────────────────────────┘ │
│ Ada: …                          │  past: messages, frozen
│ agent: … ◉ running              │  now
│ ▢ queued: run the tests         │  next: the agent takes these
│ ▢ queued: then write the plan   │
│ ━━━━━━━━━━━ the line ━━━━━━━━━━ │
│ ▢ drafting: next action…        │  maybe: only people move these
│ ▢ drafting: bigger picture      │
└─────────────────────────────────┘
```

- **The line is the only commitment.** Above it the agent reads and will act;
  below it only people read and touch the cards. Queueing moves a card above the line and
  unqueueing moves it back below. Staging several steps is putting several cards
  above it.
- **The agent takes the top queued card.** It is the only move no person
  makes, and it is what queueing means.
- **An unqueued card stays in its column**, just below the line, a draft again.
  It never returns to someone's composer (ADR-0026's concern), because it
  never left the thread.
- **The usual case looks as it does today.** The composer is the one drafting
  card; a second appears only when someone asks for one.

*Queue control* (*amended in place, step 7, 2026-10-05, with Duane*):
- **Staging is a held queue.** Anyone can hold a thread's queue, and anyone
  can release it. While it is held the host pops no message card from it,
  and a send there waits in it, so people can line up several cards on an
  idle thread and let them go together. The hold is the host's record
  (`pinetrie.queue-hold`), so it lasts until a release, across a restart.
- **Stop holds the queue when a message card waits in it**, so stopping a
  wrong turn does not send the next step unseen. With nothing queued, Stop
  holds nothing, or the correction sent after it would be held too. Resume
  shows beside a held queue: its cards wait for a release, not for the turn.
- **A held queue still lets facts go** (ADR-0080): a fact is nobody's
  instruction and starts no run.
- **The next card waits while someone types in it.** Each keystroke in a
  card says so in presence (`typingIn`), and it lapses 3 s after the last;
  the host pops no top card someone is typing in, and pops it once the
  typing lapses. There is nothing to release. A host that has just started
  has heard no typing, so a card being typed in as it starts can go.
- **Unqueue all** takes every message card queued on the thread back below
  the line, as the queue is when the host gets it, in one step one undo
  reverses. It does not release a hold.
- **Reordering** moves a queued card up or down its queue, or a pinned card
  among its thread's pinned cards. It changes only the card's order: who
  queued it and who placed it stay, so it leaves no trace and no history
  event. A queued card never passes a fact, since a fact says what already
  happened. A reorder names the two cards it goes between, as its sender
  saw them, and is refused when they have changed.

*Physics.*

1. A card is always somewhere, and only a person moves it, except the agent
   taking the top queued card. *Amended (step 4):* a fresh column's first
   send also moves the column's other cards, to drafting at the message it
   wrote; the column has become that thread's, and the cards stay in it on
   screen. That is the host's write, so it keeps each card's placer.
2. Its place decides what happens to it.
3. **Two verbs move cards: take and put.** Take moves the focused card into
   your inventory; put moves the inventory's selected card to where you are focused.
   You move, and the card rides in your bag, as in a game.
4. **Taking from the past copies.** Taking a message, or a selection in one,
   makes a new card with its text. The message loses nothing.
5. **In place, a card has its own actions:** send (Enter, as today), queue,
   unqueue, reorder (Alt+↑/↓, or the card's ↑ and ↓). These are what a card
   does, not where it goes. *Amended in place, step 7:* Alt+↑/↓ is taken
   only in queued and pinned cards' boxes, which lose a Mac's Option+↑/↓
   caret move; the composer and drafting cards keep it.
6. A card looks and edits the same in every place.
7. Every move can be undone, except send: the tree is immutable, so a sent
   card is spent.

*Input.* Each input is a way of making the same moves, so each has full
fidelity by construction.
- **Keyboard:** take is Ctrl+Shift+I (in) and put Ctrl+Shift+O (out); plain
  letters would clash with typing. On a Mac, Ctrl is not Cmd, so neither
  clashes with the browser; elsewhere Ctrl+Shift+I opens developer tools and
  Ctrl+Shift+O bookmarks, and whether a page can claim them is for step 4's
  plan to measure. Put onto a column lands below the line, since that
  commits nothing. The profile lists the keys. The rest of the keys (opening
  the inventory, selecting a slot from anywhere) wait for a redesign of the
  key system.
- **Drag:** take and put in one gesture. Dropping on the inventory takes;
  dragging out of it puts. Holding a card over a root tab opens that tab, so a
  card can cross tabs.
- **Clipboard:** copy makes a new card where it is pasted; cut moves it.
  *Deferred (step 4) to the key system's redesign:* Cmd+C and Cmd+X belong
  to text.
- A test holds the fidelity: every place a drag can drop on is reachable by
  put, and every place put reaches accepts a drop. *Amended in place, step
  7:* so reordering has no drop target; it is the keys and the card's ↑ and
  ↓, until the key system's redesign.

*The inventory* is a game's inventory: a panel floating over the columns,
centred by default, and open while you work in them, since nothing pauses.
- **It covers the middle of the screen, not its edges.** Cards are dropped
  near the top (the tab bar, pinned cards, later a board) and the bottom
  (queued cards, the line, the composer) of every column; the middle holds
  messages, which are read and taken from, not dropped on.
- **It snaps left, centre or right.** Dragged by its frame, it settles at
  the nearest, so it is always somewhere you can predict. The choice is the
  device's (`localStorage`), not the session's.
- **A move shows where it went:** a taken card flies into its slot, and a
  put one flies out to where it lands. Taking while the inventory is closed
  shows it briefly, the card landing, then closes it.
- **A fixed 3 × 6 grid.** A slot is an address, the same on every device ("my
  plan is top-left"); a small screen scales the grid, not the addresses.
- **Cards keep their slots, gaps included.** Take fills the selected slot if
  it is empty, else the first empty one in reading order. Put empties the
  slot. Dropping on an occupied slot swaps the two.
- **A slot shows its card's first line**, its author's colour and its marks;
  selecting it shows the whole card beside the grid.
- **Keys:** the first nine slots are labelled `1`–`9`; arrow keys and `hjkl`
  move through the grid while the inventory has focus; a chord (such as
  Alt+1–9) selects a slot from anywhere.
- **Full means full:** take is refused with "inventory full". The whole inventory
  fits in one look, and the limit asks you to tidy. More room can come if
  18 proves too few.
- **Nothing arrives by itself:** no sections, no headers, nothing sorted for
  you. Change shows as marks on cards.
- **It is yours on every tab and device**, stored under you (the person,
  ADR-0037), and shown only to you. That is not a security claim; it is your
  bag.
- **It crosses sessions, a page per session.** A session shows its own
  page, and other sessions' pages are not shown by default. A page is
  stored with its session, on its host, under you. Step 4 builds this
  session's page; reaching the others waits for a client that reaches
  several hosts.
- **It is the fold plan's inventory.** Fold drops a card standing for a branch
  at a thread end, with the same put.

*Other people.*
- **Every card in a shared place is shown to everyone**, in full, and anyone
  can type in it. Who wrote in a card is read from its operations: each
  carries its seat's `clientID`, and the host writes a record of each seat's
  person as it connects (`pinetrie.seat`), so anyone can name a card's writers
  after they have left (S58). Nobody stores a contributors list. *This is
  provisional:* it reports whoever's operations the text holds, which undo
  does not change. From step 6, who contributed is a projection of the
  card's history (below), and it replaces this for the heading, a sent
  message's "with", and marks.
- **Anyone can move a card in a shared place.** Only your inventory is yours
  alone, so nobody is locked out because you put something somewhere.
- **A trace** stays where your card was when someone else moved it: "Bea sent
  this →", "Bea queued this", "Carl took this". It leads to the card, and only
  its placer sees it. It appears only when all of these hold:
  1. you were the last to put the card there;
  2. it left its place (reordering within a short list is not leaving, and
     gets no mark at all);
  3. you did not see it go: its column was not on your screen, as presence
     reports (ADR-0024);
  4. it is not the card's expected fate: the agent taking a queued card is
     what queueing means.

  An unqueued card has not left its place; it gets a mark on itself
  ("unqueued by Bea"). A trace is gone once seen, as a seen mention is (ADR-0030).
  Traces at one spot collapse into one ("3 cards moved by Bea").

  *Amended in place (step 6):*
  - **Only shared places leave traces**: drafting, queued and pinned; since
    ADR-0116, queued and pinned only, a note column being everyone's
    scratch. Nobody
    else moves a fresh column's card, which only its owner's column draws,
    or a card in someone's inventory.
  - **An unpin is treated as an unqueue.** The card goes back below the
    line in the same column, so it leaves no trace, and gets a mark on
    itself ("unpinned by Bea").
  - **"On your screen" is a column open at the card's thread end**, as
    presence reports. A column scrolled out of view still counts as seen; a
    hidden or closed page does not, which is the case traces are for.
  - **"Gone once seen" means the host deletes it.** A trace drawn in a
    column you can write, in a page you can see, is reported seen, and the
    host deletes its record, so it is gone on every device. The column
    keeps drawing it until it unmounts. Seen is not kept in
    `attention:<writer>` (ADR-0077): that document keeps every write for
    good (S101), and the trace's record would stay stored.
  - **A trace whose card is back where it was goes**, as an undo returns
    it. Traces no one has seen are swept after 30 days.
  - **Only the placer is shown a trace**, but every client holds the
    records, as with the inventory. That is not a security claim.
- **Each card keeps its history:** created by, typed in by, moved, queued,
  unqueued, taken, sent. That is its provenance, reached from the card and
  from a trace. Someone taking your card into their inventory is recorded there,
  not notified. *Amended in place (step 6):* a card's history and its traces
  are host records in the session's document (`pinetrie.card-history`, keyed
  by the card, and `pinetrie.trace`, keyed by its own id), not fields of the
  places: that document grows for good (S90), and a field every event
  changes would refuse each whole undo of a move (S82). A card's history is
  deleted with the card; a trace outlives it ("Bea sent this →" leads to
  the message). Each event says who moved the card, from where to where,
  and when; what the move was called is read from the two places. Typed in
  by is the card's writers, shown beside its history, with no events.
- **Who contributed to a card is a projection of its history**: each edit,
  a deletion as much as typing, and each undo and redo, by its author. A
  person contributed while any edit of theirs still stands, so undoing every
  edit you made removes you, and redo brings you back. No client can keep
  this as a cache: each tab undoes on its own (ADR-0052), so only the
  history knows what still stands across tabs and devices. It lasts as long
  as the card. Someone else editing away all your text, rather than your
  undoing it, removes you too (2026-10-05, with Duane).

  *Deferred (2026-10-05, with Duane):* the projection waits for Kyneta. Yjs
  records who typed each character but not who deleted it, and pine·trie
  reaches even the first only by unwrapping Kyneta (`textClients`), so it
  has asked Kyneta for a read of the writers whose text still stands. When
  that lands, contributors become those writers, and a deletion counts for
  no one: someone who only deleted in a card is not named. Until then,
  step 1's attribution stays for the heading and a sent message's "with",
  and marks do not count cards you contributed to. Keeping a log of each
  person's edits in pine·trie, which would also credit deletions, was
  rejected as large for what it adds.

*Closing a column.*
- **A thread's column:** closing it moves nothing. Its cards stay on the
  thread, others still see them, and your tab's mark and the rail's show
  they are there.
- **A fresh column** (an unsent branch, a new tab) has no thread until its
  first message is sent, so its cards have no shared place and nobody else
  sees them. Closing one whose cards hold text asks **keep in inventory**
  (the default) or **discard**. Keep moves each of them into your
  inventory, and can be undone: the undo reopens the column. Discard is
  final: an undone discard would bring back a card no column shows. Keep is
  refused, and the column stays open, when your inventory has too few empty
  slots. One with nothing typed closes silently. To leave it for a minute,
  switch tabs: that keeps everything. (*Amended in place, step 4.*)

*Marks.* A root tab is marked when it holds an unsent card of yours with
text, and so is the thread's end on the rail, whether the thread's column is
open, scrolled away or closed: a drafting card sits after its thread's last
message, and the rail shows every thread. A column itself is not marked,
since its composer shows the text when it is on screen. A root whose tab you
closed is marked on the Archive tab and its row. An archived root marks only
its row: archiving says its work is done, so what is left in it is not
somewhere you were going back to.
Drafting and fresh cards count; a card counts by its text, not its record.
Only yours: it answers "where was I?", and is not a busy indicator. Yours is
the cards you own, and from step 6 also every card you contributed to (a
projection of its history, below), so you can follow a card you helped
write. A card is
marked when someone else edited or unqueued it, when its thread moved on since
you wrote it, and when a reminder on it is due.

*Pinned cards and the agent.* Pinned cards are, figuratively, the thread's
system prompt: the agent reads every one on every run.
- **Where they go in the context.** The system prompt holds one fixed line
  saying that the thread's pinned cards follow in `<pinned-cards>` blocks and
  the latest one holds, in every agent thread's `<rules>`; the cards' text
  goes in with each run's prompt. The system prompt stays the same on every
  request, as ADR-0046 already requires, so an edited card does not throw
  away the prompt cache for the whole conversation (S92). *Amended in place,
  step 5:* not "near the end of the context", which loses the cache on every
  request.
- **What the agent read is in the tree** (ADR-0004). When a run starts and
  the thread's pinned cards differ from those the model last read on the
  run's path, the host writes one cards entry, which pi writes with the
  run's prompt, in the commit that admits the run (`prompt([cards,
  message])`). It restates every card pinned now and names, by its first
  line, each card unpinned since ("no longer applies"), so the latest entry
  is all that holds. A run whose cards have not changed writes none. That
  entry is also what the model reads, so the tree records the context and
  supplies it in one place. On screen it is a small marker above the run's
  prompt, not a message.
- **pi's compaction keeps them in view.** pi compacts in the middle of a
  run; a hook carries the newest cards entry summarised into the retained
  tail, so the compaction entry holds the cards the model reads after it.
  If the hook fails, pi compacts on its own and the next run restates them.
- **A run reads the cards as they were when it started.** A send carries
  each pinned card's text version as its sender had it, and the run waits
  for it, at most 2 s, then reads what the host holds. An edit during a run
  reaches the next one, and until then the card is marked "changed since
  the agent last read it".
- **Anyone can steer.** Anyone can edit a pinned card, and so change what the
  agent works towards, as anyone can edit a queued card. The card's history
  records who did.
- **A card shows its size**, quietly, since a long one costs tokens on every
  run.
- **A branch starts with no pinned cards**, and its first run tells the
  model its parent's no longer apply: the branch shares its parent's path,
  which carries the parent's cards entries. That entry is quiet: the column
  draws nothing for what it retires. A branch that wants its parent's
  direction takes a copy and pins it. *Amended in place, step 5:* it did
  inherit them, read-only.
- **A conversation thread** has no agent, so its pinned cards are the team's
  until someone asks the agent, whose first run reads them.

*Undo is Kyneta's* (`createUndoStack`, `@kyneta/exchange`; below). It is
multiplayer-sound: it reverses my operations as they now stand among everyone
else's, which a stack of naive inverses does not.
- **Text, inside a card:** your keystrokes, never a collaborator's. A
  collaborator's text typed inside yours survives your undo.
- **Place:** take, put, queue, unqueue, discard, and moves in the inventory. A
  place is restored only while it still holds what your step wrote: if Bea
  moved the card after you, your undo leaves her move alone.
- **One gesture is one step**, across every document it wrote: a take that
  changes a card's place and your inventory is undone at once. Typing joins the
  step before it while you keep typing in one place.
- **Cmd+Z** in a card undoes through the same stack (`useText`'s `undo`
  option), and so does Cmd+Z elsewhere on the page, for moves. *Amended by
  ADR-0052: each card has its own history, and Cmd+Z in its box reaches
  only that.*
- **The stack is per tab, and in memory** (*amended by ADR-0052: Cmd+Z in a
  card undoes only that card's steps*). Kyneta keeps a stack in a
  document that one runtime writes, and a browser keeps no store
  (ADR-0037), so a tab's stack lasts until the tab reloads or closes. What
  undo reverses is kept, since cards themselves are stored; only the list of
  steps is lost. Storing the stack is one option away (a store under the
  tab), if a reload that forgets undo proves to hurt.

Discarding is a change of value and undo its inverse, so nothing is destroyed
and there is no retention period to choose. Undo reaches as far back as the
history kept; compaction (S24) is the limit. Sending is the one step undo
cannot cross, and it is already the one the design calls final.

*Storage: Kyneta, written by clients.* (*Amended by ADR-0059: texts and
inventories are written by clients; places only by the host, through
handoffs. S75 found that a place does not merge.*) **Clients write cards directly. The host
acts only at the boundary with pi**, sending a card and taking a queued one,
where the card becomes a message in the immutable tree.
- Kyneta's undo covers only operations a client made itself, so cards written
  through host commands, as notes' records are today, could not use it.
- The session stays authoritative JSON (ADR-0023; the `json` substrate,
  `packages/schema/index.ts`), with CRDTs where people type together. Cards
  are where people type and move things together, so they live in CRDT
  documents: one per session for the shared places (each card's place, owner,
  placer, marks; *amended, step 6:* history and traces are session records,
  *Other people*); one per person for the inventory; and each card's text
  in its own Yjs document (`TextDoc`, `packages/schema/text.ts`, shared with
  notes). Step 1 built the first and the third (`CardsDoc`,
  `packages/schema/card.ts`). Clients write a card whole once, and only its
  fields after: a whole-record write concurrent with the host's spend brings
  the card back, where a field write loses to it (S58).
- **The host resolves what clients create.** Without a `resolve` for the
  cards document and `card:` documents, a card the host never opened would be
  neither stored nor relayed (S58). A tab's undo document is rejected, and
  neither shared nor accepted: each tab's stack is its own.
- The host's write policy checks invariants (`canAccept`) instead of carrying
  out commands. ADR-0023 becomes: tabs write cards and presence; the host
  writes pi's tree.
- **The race at the boundary.** ADR-0026's serial executor orders a take
  against a cancel; with cards written by clients, the host taking a queued
  card and someone unqueueing it are concurrent. Once the host's take is
  written, it wins: the card is spent, and the unqueue leaves a mark,
  "already sent".

*Removed.* Notes in the tree: a note below a message (ADR-0043), origin notes,
done / reopen / "changed since done", the notes index, and the rail's note
squares. The `pinetrie.note` records and their lifecycle. Compose together as an
action of its own, since every drafting card is shared. The fold plan's private
inventory. A branch from `→` still carries a conversation about a message,
and a pinned card can quote one.

**Consequences.**

- The tab-switch bug is fixed by the first card, not by a cache: the text
  lives on its thread, in a document, and outlives any column.
- pine·trie's host gets smaller where cards are concerned: no commands, codec
  fields or handlers for composing, drafting, cancelling or reordering. The
  host's work is the boundary, and the policy's invariants. (*Amended by
  ADR-0059: the host takes handoffs.*)
- The model's view stays reproducible: it reads messages and pinned cards,
  and what it read of the cards is an entry in the tree.
- The prompt gains one fixed line (amending ADR-0046's block), and each
  run's context gains the pinned cards near its end.
- Every card's text is a Yjs document, never compacted while live (S24).
  Storage grows with use until Kyneta compacts live Yjs, as ADR-0026 already
  accepted for queued notes.
- Undo comes from Kyneta, not from pine·trie's code: pine·trie chooses each
  stack's scope and wraps each gesture.
- Cards' places need a CRDT document, not `json`: Kyneta's undo over a
  plain document is a strict one-writer stack, and a write by anyone else
  ends it. (*Amended by ADR-0059: places are the host's `json`, and a
  move is undone by the reverse handoff.*)
- The order of work follows what hurts most (switching root tabs, then coming
  back the next day, then an agent finishing elsewhere):
  1. the drafting card that survives a tab switch, a reload and a host
     restart, with undo from the start;
  2. marks for your unsent cards on root tabs and columns;
  3. notes become cards: notes in the tree removed, queued notes become queued
     cards, the take/unqueue race;
  4. the inventory: grid, take and put, drag, keys;
  5. several cards per place, and pinned cards read by the agent;
  6. traces and card history, and who contributed, projected from it (for
     marks, a card's heading and a sent message's "with"; traces and history
     built, who contributed waits for Kyneta, *Who contributed*);
  7. queue control: staging, reordering, unqueues (built: *Queue control*);
  8. later: reminders (inventory cards that light up when due and reach your `@`
     inbox, separate from the queue), conditions on queued cards (ADR-0026),
     the agent suggesting next steps as drafting cards, and a summary of what
     happened while you were away.

*What Kyneta provides.* Asked for while this ADR was written, and now in the
build pine·trie links (`/kyneta/workspace/pineta`, bookmark `needed-by-pinetrie`):
"selective, durable undo across documents".
- **`createUndoStack({ exchange, docId, key, scope })`**
  (`packages/exchange/README.md` § Undo, `TECHNICAL.md` § Undo stacks):
  `gesture(fn)` makes one step of every local commit on a document in
  `scope`; `typing(fn)` joins the step before by the typing policy;
  `undo()` and `redo()` return false when nothing stands. A commit outside a
  gesture is someone else's write, rebased over.
- **The algorithm** (`packages/schema/TECHNICAL.md` § Undo): a record names
  content by identity and survives a reload; text and lists are rebased by
  operational transform; a value is restored only while it holds what the
  step wrote; a revert is its own inverse, so redo needs no logic of its own.
  One conformance suite runs it on plain, Loro and Yjs documents, live and
  after a reload. Ephemeral documents (presence) are not undoable.
- **Durability**: the stack is a document with a write-ahead note, so a crash
  mid-undo is finished on the next load without applying anything twice.
  Without a store it lasts the session.
- **`useText(ref, { undo: stack })`** (`packages/react/README.md`): Cmd+Z,
  Cmd+Shift+Z and Ctrl+Y, typing grouped, the caret moved to what was
  undone. Without a stack, `useText` swallows Cmd+Z, as it does in a note's
  editor today.
- Measured from pine·trie's lane: one gesture writing two `NoteDoc` documents,
  then a write outside it at the front of the first. Undo emptied the second
  and left the first holding only the other write; redo restored both.
- **Redo of a step of several commits to one text puts them back in reverse
  order** (S58, addendum): after a run of keystrokes, Cmd+Z then Cmd+Shift+Z
  scrambled the last word. Fixed in Kyneta: "a step of several commits to one
  text undoes and redoes in order" (S64).
- **An undo never creates a document**: it opens a step's documents with
  `exchange.open`, and skips a part whose document is not held. A host's
  destroy leaves each client's copy, so each client destroys its own once
  the host lets go of the document and the card's record is gone (S64).
- **Undo and redo by document** (`undo({ docs })`, `redo({ docs })`): the
  newest step that wrote the given documents, even under steps elsewhere.
  Steps conflict by what they write, down to record keys, and a new step
  clears the redo steps it conflicts with and those built on them (S64,
  addenda 2 and 3). ADR-0052 rests on it.

*Probes before a plan*, each recorded in `docs/findings/`. S58 answered 3, and 4
for the drafting card; S69 answered 2, and 1 for a queue's order (a field
on each card, not a list per thread); S75 and S76 answered 1, and 4 for
moves (a place does not merge: a place in a session is the host's, moved
by handoffs it applies or refuses, and your inventory is a document only
your tabs write; a new ADR will say so); S92 answered 5 (the cards entry
goes in with the prompt, `prompt([cards, message])`, and the system prompt
and pi's system messages both lose the cache on an edit):
1. **Places as a CRDT:** a movable tree (Loro) or a place field per card. Two
   people move one card at once, and a card moves while being typed in.
   Which converges to something a person would accept?
2. **The take/unqueue race:** the rule above holds, and the unqueuer's client
   shows "already sent".
3. **A spent card's document:** destroy or keep its text after a send. S28
   found a refused write unrecoverable; measure what a client still holding
   the replica sees.
4. **Undo in pine·trie's shape:** two browser tabs as two people, over the
   host's exchange. One takes a card while the other types in it, and one
   moves a card the other then undoes a move of. A second tab's stack is its
   own.
5. **What the agent read:** writing a changed pinned card's text as an entry
   when a run starts, and what pi allows there (a custom entry outside a run,
   S19). Placing the cards near the end of the context through pi, and
   measuring that the prompt cache holds when a card changes between runs.
   How a branch's context gathers the pinned cards inherited at its fork.

*Still open:* whether a person-wide activity log is wanted beyond each
card's history; how a client reaches other sessions' pages, since each
session has its own host and store (`.pinetrie/pinetrie.db`) and a browser
reaches one host; and how a card moves between pages, since its text is a
document on its session's host (a copy, then a delete, and an undo across
two hosts).

**Alternatives rejected.**

- **Keeping the composer's text in browser storage** (`tab-state.ts`). It
  survives tab switches and reloads with no host work, but not a new device,
  and it leaves the composer a thing apart from drafts and queued notes.
- **A private composer document per person and place, with a host-written
  record** (Phases 2–7 of `PLAN-2026-09-29-branch-prefill-and-composers`).
  It fixes the bug but adds a fourth kind of unsent text with its own rules,
  commands and handlers, and host-written records rule out Kyneta's undo.
- **"Note" as the name.** It is already in the code, and is both verb and
  noun, but the design is about placing and moving things, and a card is an
  object in a way a note is not. One name, not two.
- **Keeping notes below messages as another place.** Annotating a message
  where it sits is lost, but a branch already carries a conversation about a
  message (ADR-0025 said so), and a pinned card can quote one. The tree stays
  only what was said.
- **One shared draft per thread end** (ADR-0025). The usual case is one
  message, but at critical moments several things need tracking at once.
- **Only a card's owner may move it.** That keeps "I put it there" but locks
  collaborators out of shared places. Traces keep the first without the
  second.
- **A lift-and-move keyboard mode, or a "move to…" picker.** Take and put move
  you instead of the card, with the keys you already use to get around.
- **A drawer sliding out from the side.** Dragging to and from it is easy,
  but it covers or pushes aside a whole column, top and bottom, where cards
  are dropped. A panel rising from the bottom, as in many games, covers
  every composer.
- **An inventory placed anywhere by dragging.** Snapping to three places
  keeps it predictable, and needs no position kept per screen size.
- **A list, or a free canvas, for the inventory.** A list has no addresses; a
  canvas is hard to use from the keyboard and grows messy. A fixed grid gives
  addresses and works with every input.
- **Returning an unqueued card to its sender's inventory.** It would move by
  itself, out of the place everyone saw it in.
- **Undo as our own stack of inverse commands.** Unsound with other people
  editing, and a retention rule for discarded cards would be needed. Kyneta's
  operations already carry the algebra.
- **A toggle per pinned card for whether the agent reads it.** It suits the
  cautious person, but it is a second rule beside position, and the card
  would need a label to say which way it is set. With position as the rule,
  the cautious person puts a card below the line.
- **Pinned cards in the system prompt.** The natural reading of "the
  thread's system prompt", but an edited card would change the prompt's
  prefix and throw away the cache for the whole conversation.
- **A branch copying its parent's pinned cards**, to change on their own.
  It fits "cards belong to a thread", but the branch's path above the fork is
  its parent's as it was. Taking a copy covers the rare exception. Inheriting
  them read-only, as this ADR first said, was dropped too (step 5): the
  branch's column would show cards nobody in the branch pinned or can
  change.
- **One undo stack per device, shared by its tabs.** Cmd+Z in one tab could
  undo a move made in another, and Kyneta's stack is a document that one
  runtime writes, while each tab is its own runtime.
- **Storing each tab's stack now** (IndexedDB, under an id kept in
  `sessionStorage`), so undo survives a reload. It would give the browser a
  store, reversing part of ADR-0037, for a need not yet felt. It is a
  store option on the stack if it is wanted later.
