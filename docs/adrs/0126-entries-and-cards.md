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
  - ADR-0116: a task is a card, whose surface is the board; a text card
    dropped on a canvas lands in a note column made for it.
  - ADR-0124: selecting a card in the inventory previews it, read only, at one
    column's width; Enter opens it.

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

- **Every place is a surface of some content or person**: the board, of
  task cards; a task's canvas; a thread's dock (its queue, its pinned
  cards, your message); a note column; an entry's margin; a person's
  inventory. A place is its owner, its surface, and a rank there.
- **A place decides the audience**: who sees a card there, and whether the
  agent reads it never, once or on every run.
- **A task is a card.** Its content is the task, and the board's workflow
  states are its surface.
- **A comment is a note on an entry**, in the entry's margin, seen by
  people and never read by the agent, like any note. To tell the agent,
  queue it, or a reference to it, and the thread's end consumes it.
- **A fact is a card of its own kind**, only ever queued, until its
  thread's end consumes it. Nobody can move it because no other place
  takes its kind, so the refusal `fact` goes.
- **A drop resolves to a place.** A card dropped where its kind cannot be
  lands in a container made for it there: a text card on a canvas lands
  in a new note column, as a note sent to a task with none already does
  (`NotesTarget`).

*How cards come and go.*

- **One rule makes every card**, a person's or the host's: the host is
  one more author.
- **A thread's live end consumes a card**: a send, a spin into a new
  thread (ADR-0111), a fact popped. The card ends, and the entry it became
  is the record.
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

- **Every kind has four renderings**: **face** (a folded column's strip, a
  grid cell), **normal** (one column wide), **wide** (two columns),
  **whole** (an open column, or the pane). Each kind draws all four, so no
  surface finds one missing.
- **The kind's signals and the place's never cross**: a card's icon and
  shape say its kind, its frame's colour says its place (`cardFrame`).
- **Selecting a card in the inventory previews it**: its normal rendering,
  read only. Enter opens it.
- **Entries are selected and addressed as cards are**: keys move among
  them as among a grid's slots, and each can be copied, linked and
  commented on. They are never placed.
- **Signals are one family**, each named for what it says: unsent text of
  yours (the pips, today's card marks), needs you (ADR-0077), running,
  done.
- **Arrangement is shared and attention is personal.** A canvas's order
  and its cards' widths are everyone's; which columns you fold and what
  your pane shows are yours.

*Keys.*

- **Cmd+C** (Ctrl+C elsewhere) on an entry, a block or a selection takes a
  copy into your inventory, and writes it as markdown to the system
  clipboard.
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
- **Left open**, for the plan that builds this:
  - which card a column is when it steps through the alternatives at a
    fork, which is shared state;
  - whether an unsent branch (`fresh`) and a discarded card (`gone`) are
    surfaces of something, as every other place is;
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
- **A task outside the card model** (`BoardPlace`, now). It is a second
  system of places, moves, history and undo for something that moves as a
  card does.
