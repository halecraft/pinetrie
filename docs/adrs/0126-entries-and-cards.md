# ADR-0126 — The past is entries, the present is cards, and what the host computes from entries is derivations; a card is an identity, a place and content

- **Status:** Accepted (Duane, 2026-10-10)
- **Area:** `docs/glossary.md`
- **Amends:**
  - ADR-0048: a card's history is of its content as well as its places, and a
    trace is one way of drawing it.
  - ADR-0080: a fact is a card of its own kind, only ever queued, not a text
    card with no text.
  - ADR-0106: a run has an ask, the message that started it; who stopped a run
    is a fact in its thread, not a `pinetrie.stop` record.
  - ADR-0116: a task is a card, placed on the board, whose surface is its
    canvas; a column is how a card on a canvas is drawn, not a card; a text
    card dropped on a canvas lands in a note column made for it.
  - ADR-0124: selecting a card in the inventory previews it, read only, at one
    column's width; Enter opens it; a take's stop is a fact card, not a stop
    record.
  - ADR-0066: a discard is undone from its discarder's trash, and one made on
    no task from a history of theirs outside any task.
- **Revised:**
  - 2026-10-10 (S145): Cmd+C on a selection no range names, as one across
    formatting, copies what is selected as the browser does and takes nothing,
    rather than taking the whole message.
- **Amended by:**
  - ADR-0128: an ask card is a kind of card of its own, only ever queued,
    which a person may reorder and nobody moves.
  - ADR-0132: Cmd+C copies to the clipboard and takes nothing; Cmd+X cuts;
    nothing is taken from the past; a reference put from your hand leaves it,
    as every card does.
  - ADR-0134: any column closes, its card to the trash of the place it left,
    which records that place; a task's trash is the task's, seen by anyone the
    card was seen by there.
  - ADR-0138: `open-thread` also opens a new root's first thread in a task the
    session holds, its card where a drop on the canvas would land.

**Context.**

- **There is no word for what is in a thread.** Storage says *entry*, the
  transcript says *message* (roles `chat`, `assistant`, `update`, `land`,
  `behind`), the column groups *asks*, *rows*, *tool rows*, *fork rows*,
  *segments* and *folds*, and digests, stops and verdicts are *host
  records*. The glossary named none of them as the general word, and "row"
  also means a places row, a board row and an SQL row.
- **A card is a place more than a thing.** `CardRecord` is a text card, a
  thread card or a note column, and `PLACES_OF` says where each kind may
  be. What a card holds, how it is drawn, and what can be done with it are
  decided component by component.
- **Cards are made five ways.** A person's text card, note column and
  thread copy go through `planMake`; a thread at its first message
  (`planThreadCard`), a note column for a card with nowhere to go
  (`toNotes`), a fact's card (`planFactCard`) and a split's card
  (`agent-commands.ts`) each build their record by hand.
- **Some things act like cards and are not.** A task is "the board's card"
  in the glossary, but it has its own `BoardPlace`. A fact is a text card
  with no text, so the host needs a refusal (`fact`) to keep people from
  moving it.
- **Copies are inconsistent.** A thread's copy keeps its source
  (`ThreadOrigin`). A message taken into the inventory becomes a bare text
  card that does not know where it came from, and a text card cannot be
  copied. The smallest piece of the past you can take is a message or a
  text selection: a table in a reply could be shared only by a screenshot.
- **The inventory does not show what you selected.** A grid cell shows the
  card's face, and the card opens whole only on Enter.
- **"Mark" means two things.** ADR-0045's mark is a task's title;
  `card-marks.ts`'s marks are the pips that show where your unsent text is.
- **"Workspace" means three.** A lane's jj workspace (ADR-0032), the pnpm
  workspace of this repo, and the page's main area (`#workspace`, beside
  the sidebar), which a page such as the profile covers.
- **The board has no owner in the words.** It is the host's session's,
  and a host is a machine: once hosts federate, the people who share a
  board may be on several.

**Decision.**

*Three layers.*

- **Entries are the past.** An entry is immutable, has an author and a
  time, and is in a thread. It is a **message** (a person's or the
  agent's, whose content is **blocks**: paragraphs, tables, code, images,
  tool calls with their results) or a **fact** (what the host recorded:
  a catch-up, an acceptance, the base's news, a stop). Nothing rewrites
  the past: to change it, you **fork**, before an entry to edit it
  (ADR-0043) or after it to branch.
- **Cards are the present.** A card is an identity, one place, and
  content. Its content's kind decides where it can be, what can be done
  with it, and how it is drawn.
- **Derivations are computed from entries.** The host keeps them and
  replaces them as entries grow: a digest, a verdict. The agent never
  reads one and nobody moves one. One a model made says so.
- **There are no annotations.** A comment on an entry is a note in that
  entry's margin. Who stopped a run is a fact.

*Words for the past.*

- **A thread** is a path of entries, from its fork to its end, and a live
  end that consumes cards.
- **A run has an ask**, the message that started it, and holds the entries
  the agent wrote in answer, with any fact steered into it (ADR-0080).
- **A fork** is a point, at an entry, where threads diverge. It is not an
  entry.
- **"Row", "fold" and "segment"** are how a column draws entries, never
  what a person reads as a kind of thing. **"Record"** is a stored value
  (`CardRecord`, anything in `records`), never the past.

*Places.*

- **Three relations, kept apart.** A card is **placed on** one surface. A
  card **has** the surfaces its content gives, none or several. How a
  card is **drawn** is decided by the surface it is on, the width its
  place gives it, and the person looking. The first two are data; the
  third is the view, and no surface is a view.
- **Every place is on a surface of some content or person**, at a rank
  there:

  | owner | its surfaces |
  |---|---|
  | a team | its board, of task cards |
  | a task card | its canvas; its pinned cards |
  | a thread card | its dock (its queue, its pinned cards, your message); a margin for each of its entries |
  | a stack card | its pile, of thread cards |
  | a note column | its list, of notes |
  | a person | their inventory; their trash, of what they discarded |

- **A column is a view**: a card on a canvas, drawn whole. It is no card
  and no surface.
- **A place decides the audience**: who sees a card there, and whether the
  agent reads it never, once or on every run.
- **A board is a team's.** A team is the people who share a board, its
  tasks and, later, its sources and runners. A person and a team are the
  two **parties**: every surface is some content's or a party's.
- **A task is a card**, placed on the board, whose surface is its canvas.
  Opened, it is drawn whole: its canvas's cards as a strip of columns.
- **An unsent branch or a new tab is a thread card not yet started.** A
  column already mints its thread's id as it opens (ADR-0117); its card is
  made then, on its task's canvas, and your text is your message on its
  dock. Its first send writes its first entry. Closing its column before
  then discards it.
- **A discarded card is in its discarder's trash**, one for each person,
  until an undo brings it back or the host sweeps it. It remembers the
  task it left, or none: the undo key finds it from its discarder's
  history of moves for that task, or, for none, from their history
  outside any task.
- **A stack is a card holding two or more threads of one root**, one of
  them on top:
  - **Its column draws its top thread whole**, with a control at each
    entry where a thread of the stack leaves the top's path, naming every
    thread that leaves there. Choosing one puts it on top. Which is on top
    is shared.
  - **Only the top runs.** The others' queues are held, as in an
    inventory (ADR-0124), and the stack shows no signal of them. A stack
    whose top is running is refused a change of top: stop it, or pull it
    out.
  - **Dropping a thread onto a column stacks them**, making a stack when
    the column was a lone thread's. Dropping it between columns places it
    there. A stack left with one thread is dissolved in the same gesture,
    so a lone thread is never a stack of one.
  - **The column's header is the stack's grip** and the control at a fork
    is one thread's: taking the column takes the stack and every thread in
    it; taking at the control takes that thread alone.
  - **A copy of a stack copies its top thread.** A link to a thread in a
    stack puts it on top.
- **A comment is a note on an entry**, in the entry's margin, seen by
  people and never read by the agent, like any note. To tell the agent,
  queue it, or a reference to it, and the thread's end consumes it.
- **A fact is a card of its own kind**, only ever queued, until its
  thread's end consumes it. Nobody can move it because no other place
  takes its kind, so a move of a fact is refused as any card's to a place
  its kind is never in, `no-place`. Only a reorder of a fact, or past one,
  is refused `fact`: a fact says what already happened, so nothing queued
  may jump ahead of it.
- **A drop resolves to a place.** A card dropped where its kind cannot be
  lands in a container made for it there: a text card on a canvas lands
  in a new note column, as a note sent to a task with none already does
  (`NotesTarget`).

*How cards come and go.*

- **One rule makes every card**, a person's or the host's: the host is
  one more author.
- **A thread's live end consumes a card**: a send, a fact popped. The
  card ends, and the entry it became is the record. A spin into a new
  thread (ADR-0111) sends its card to its spinner's trash instead, so the
  undo key can lift the thread back into it; the thread's record names the
  card it was spun from.
- **A copy records its origin**, for every kind, as a thread's copy does.
  Copying from the past (an entry, a block, a selection) makes a card.
- **One gesture is one undo step**, whatever it does: a drop that makes a
  note column and moves the card into it is undone whole.
- **A card's history is of its content as well as its places.** What the
  page draws of it, such as a trace (ADR-0048), is the interface's choice.
- **Taking from the past is not offered.** It would mean forking before an
  entry and leaving it out: rewinding, an act of its own, which needs its
  own design.

*Addresses and references.*

- **An address names something and, optionally, its version**: a thread,
  an entry, a block, a range of text, a card. With a version it is a
  snapshot; without one it follows its target. An entry never changes, so
  an address of one is both.
- **A reference is a card holding an address.** A link, a quote and a
  transclusion are its renderings (below), chosen where it is drawn, not
  when it is made. Editing a reference makes it a copy, which records its
  origin.
- **One addressing serves links, quotes, comments and mentions.** An image
  in text (`/blob/<sha256>`) is already an address.

*Renderings.*

- **Every kind is drawn at three levels of detail**: **face** (a folded
  column's strip, a grid cell, a mark in a margin), **normal** (the card
  itself, bounded: a note in its list, a preview), **whole** (all of it: a
  column, the pane). Each kind draws all three, so no surface finds one
  missing.
- **Width is the place's, not a level of detail**: a card on a canvas is
  one column wide or two (`CardWidth`), whole either way.
- **The surface decides the level**:

  | surface | its cards are drawn |
  |---|---|
  | the board | normal, as tiles; a task opened is drawn whole |
  | a canvas | whole, as columns at their width; a face where you folded it |
  | a pile | its top whole, as the stack's column; the others by their faces at the controls |
  | a list, a dock | normal |
  | a margin | a face at the entry; normal when opened |
  | an inventory | faces in the grid; the selected one normal; opened, whole |
- **The kind's signals and the place's never cross**: a card's icon and
  shape say its kind, its frame's colour says its place (`cardFrame`).
- **Selecting a card in the inventory previews it**: drawn normal, one
  column wide, read only. Enter opens it.
- **Entries are selected and addressed as cards are**: keys move among
  them as among a grid's slots, and each can be copied, linked and
  commented on. They are never placed.
- **Signals are one family**, each named for what it says: unsent text of
  yours (the pips, today's card marks), needs you (ADR-0077), running,
  done.
- **Arrangement is shared and attention is personal.** A canvas's order,
  its cards' widths and each stack's top are everyone's; which columns you
  fold and what your pane shows are yours.
- **The stage is the page's main area**, beside the sidebar: it shows the
  board or a task's strip, and a page such as the profile covers it.
- **"Workspace" is jj's and pnpm's word alone.** Nothing of pine·trie's
  is called one.

*Keys.*

- **Cmd+C** (Ctrl+C elsewhere) on an entry, a block or a selection takes a
  reference into your inventory, and writes it as markdown to the system
  clipboard. The past never changes, so a reference to it is the copy. A
  selection is what you copy: one that no range of the message's text
  names is copied as the browser copies it, and nothing is taken.
- **Cmd+X** on a card takes it into your inventory.
- **Cmd+V in a text box pastes markdown**, as it does anywhere.
- **The put key puts the card in your hand**, your inventory's selected
  slot, where focus is: into a text box as a reference, onto a surface as
  the card. A reference stays in your inventory after a put, as a tool
  does in a game; a card of the present leaves it, as a consumable does.
  Its face says which.

*What can change.*

- **The past never changes.** A card changes when its place and its
  viewer permit it, and when there is a runner able to do the work
  (ADR-0119): a thread in an inventory does not run because no runner is
  there, not because it is past.

**Consequences.**

- **Nothing is built by this ADR.** Its words go into the glossary as
  accepted and not yet built, each becoming current as its part lands.
- **`CardRecord` becomes an identity, a place and content**, and
  `PLACES_OF` is keyed by content's kind, with a fact and a task among the
  kinds. Tasks move into the places document: a store migration
  (ADR-0096).
- **A stop is a fact card**, queued as the run stops and consumed at the
  thread's end, so the agent's next run reads who stopped it. A stored
  `pinetrie.stop` cannot become an entry where it happened, since the past
  is not rewritten: the migration deletes them, and those runs read
  "stopped" with no name, as runs stopped before stops were recorded do
  (`AskOutcome`, `by: null`).
- **Digests and verdicts keep their records**, as derivations.
- **"Host record" is a storage word**, for anything in `records`, not a
  kind of thing a person reads about.
- **ADR-0048 is past its amendment limit** (`scripts/unconsolidated.ts`),
  and this adds one more: it is due a restatement.
- **`fresh` and `gone` stop being places of their own**: an unsent
  branch's text is your message on a thread card not yet started, and a
  discarded card is in a person's trash. A thread's card is made as its
  column opens, not with its first message (`planThreadCard`, now).
- **The page's main area is renamed the stage**, in code (`#workspace`,
  `showsWorkspace`) and in its living docs, with the code.
- **"Note column" names a card by its view.** It is a card whose content
  is a list of notes. The name stays for now.
- **Stacks are not built by the plan that builds the rest.** They wait
  for forking in one column to be designed.
- **Left open**, for the plan that builds this:
  - whether the host deletes only what no reference reaches, keeping the
    rest in the archive, in place of today's sweeps;
  - whether Kyneta's history is kept untrimmed, which snapshot references
    to the present need, and how a secret is then redacted;
  - private conversations: a task only you see, where threads run, beside
    an inventory, where nothing does;
  - which chord is the put key, and how the system clipboard carries a
    card's shape back into pine·trie.

**Alternatives rejected.**

- **An annotation as an entry hanging off its subject.** It would be part
  of the past and of no path, and a comment wants to be edited. A note in
  an entry's margin is the same thing with a place, and needs no new kind.
- **"Synthetic entry" for derivations.** A digest is rewritten until
  final and a verdict is replaced each run, so they are not immutable; and
  "synthetic" means made by a model, which the agent's own messages are
  too.
- **Messages as cards.** Taking one would fork before it and leave it out,
  dropping everything after it from the column. People taking something
  from the past mean to copy it.
- **Deciding link or copy when it is made.** You know how you want it
  only where you use it. An address with an optional version is both, and
  its rendering is chosen there.
- **Cmd+V as put.** In a text box, people expect it to paste text.
- **Refusing a text card on a canvas** (`no-place`, now). It makes the
  person build the container first; the drop can make it.
- **A trash for each task.** A card discarded on no task, from an
  inventory, would have none, and nothing could undo its discard.
- **"The host's" board.** A host is a machine, and a team may span
  several once hosts federate.
- **"Workspace" for the board's owner or the stage.** It is already
  jj's and pnpm's, for things a person in a lane meets every day.
- **Every thread on a canvas in a stack**, most of them stacks of one.
  A stack of one looks and acts as its thread does: a card nobody can
  see, which every link and take must look through.
- **A column as a card, or as a surface.** It is how a card on a canvas
  is drawn; calling it either confused a card's data with its view.
- **Four renderings, width among them.** Width is the place's, and a
  column two wide is as whole as one.
- **A task outside the card model** (`BoardPlace`, now). It is a second
  system of places, moves, history and undo for something that moves as a
  card does.
