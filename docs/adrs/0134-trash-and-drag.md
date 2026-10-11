# ADR-0134 — A column's header is its handle: ⋯ and × on every column, × trashes into the trash of the place a card left, and one pointer engine drags everything

- **Status:** Accepted (Duane, 2026-10-11)
- **Area:** `docs/06-interface.md`
- **Evidence:** S153
- **Amends:**
  - ADR-0040: a column's header ends in ⋯ and × on every column; ⇲, ⠿ and ⇤
    leave it, and the whole header drags.
  - ADR-0126: any column closes, its card to the trash of the place it left,
    which records that place; a task's trash is the task's, seen by anyone the
    card was seen by there.
  - ADR-0127: a thread dropped on a task in the sidebar moves to that task's
    canvas and keeps running; Fold joins the column's ⋯.

**Context.**

- **A column's header had four controls at its right, and which showed
  depended on the column.** ⇲ (a drag onto an inventory slot), ⋯, ⇤
  (fold) and × on a thread not yet sent; ⇲ ⋯ ⇤ on a started thread; ⋯ ⇤
  on a note column; and ⠿ before the name when the canvas had two columns
  or more. People read the missing × as a fault.
- **Only a thread not yet sent could close** (ADR-0126). A started thread
  left a canvas only by being taken into an inventory, which stops its
  run and hides it from everyone else. Nothing cleared a canvas of what
  nobody reads any more without that.
- **Two drag systems shared one header.** Reordering was a pointer drag of
  the header (`use-column-drag.ts`), which cannot leave the strip; ⇲ was
  an HTML drag (`CARD_MIME`), which can, with the browser's translucent
  snapshot and none of the strip's feedback. Text cards and tasks drag by
  HTML drag too (`card-frame.tsx`, `use-root-drag.ts`).
- **A trash was each person's** (ADR-0126), and a card in one stored
  `holder` and `task` beside each other. Only the discarder could undo a
  discard, and a link to a trashed thread said "Bea has it". ADR-0126
  rejected a trash for each task because a card discarded from an
  inventory would have none.
- **Every drop zone is already a value read from data attributes**
  (`DROP_ZONE` with `targetOfElement`, `ROOT_DROP_ZONE` with
  `rootTargetOfElement`), and a drop's effect is planned purely
  (`planPut`, `planRootDrop`).

**Decision.**

*The header.*

- **Every unfolded column's header ends in ⋯ and ×**, threads (sent or
  not) and note columns alike. ⇲, ⠿ and ⇤ are gone.
- **Fold is an item of ⋯**, in a section of your own apart from the
  items that change the canvas for everyone. A folded strip gains
  nothing: a click unfolds it, and its actions wait until then.
- **The whole header is the column's handle.** A press anywhere in it
  that moves past the drag threshold drags the column; one that does not
  is a click, on whatever it pressed. Text fields and an open menu start
  no drag.
- **Alt+← and Alt+→ move the column one place**, with focus anywhere in
  it outside a text box, where Alt+arrows move by word. ⋯ lists no moves.
- **The task column is unchanged**: it is first, has no ×, and keeps its
  own fold.

*×.*

- **× trashes the column's card**, for everyone, at once, with no question:
  a thread running or not, sent or not, its composer empty or not, and a
  note column with its notes. Trashing a thread stops its run, as taking
  it does (ADR-0124). The undo key brings it back, as it does any
  discard (ADR-0066).

*The trash.*

- **A card in a trash records the place it left**, and nothing else
  decides where it is: `{ kind: "trash", left }`, `left` any place but a
  trash. Who trashed it is the card's placer, as for any move. A discard
  names only `trash`; the host fills `left` from where the card is.
- **Whose trash it is follows from `left`**: the owner of the surface it
  left (ADR-0126's table). A canvas or a task's pinned cards: the task's.
  A note: its note column's. Your message, a queued or pinned card, a
  margin: its thread's. An inventory: its holder's. The board: the
  team's. A trash belongs to its owner and moves with it: a thread
  trashed or moved to another task takes its own trash along.
- **Who sees a trashed card follows from `left`**: whoever saw it there.
  Your message, discarded, is in its thread's trash and still yours
  alone.
- **Restoring moves the card back to `left`**, at its old rank. Where
  `left` can no longer take it (its owner is in a trash or gone, or your
  composer holds a newer message), the restore is refused and says why.
  A note discarded before its note column was trashed is in that column's
  trash, and comes back with it.
- **The task column lists its canvas's trash**: the columns trashed from
  it, newest first, each with who trashed it and "deleted in N days".
  Anyone on the task restores one from there. An archived task's list is
  read only. A trashed card's own trash (a thread's discarded pinned
  cards, a note column's discarded notes) is not listed; the undo key and
  its owner, restored, reach it.
- **A trashed thread is held by nobody.** Sends in it are refused, as in
  an inventory. Links to it, its fork rows and those of branches from it,
  say it is in the trash and restore it.
- **Every card in a trash is deleted a week after its discard**
  (`TRASH_KEEP_MS`), threads and note columns included, with the cards in
  its own trash. A thread deleted so takes its lane, its bookmark and any
  open offer with it; its messages stay in their root, where other
  threads' paths may run through them, and a link to it says "deleted".

*Moving a column elsewhere.*

- **Dropped on an inventory slot**, a thread is taken there, its run
  stopping (ADR-0124). A note column there is refused: it lives only on a
  canvas.
- **Dropped on a task in the sidebar**, a column moves to the end of that
  task's canvas, for everyone, and a running thread keeps running; the
  host tells it it moved. You stay on the task you were on.
- **Dropped between tasks in the sidebar**, a column makes a new task
  there holding it, as a text card's drop makes one from its text
  (ADR-0111).
- **Held over a task in the sidebar or over ▦**, the drag opens it, as it
  does now, and a drop on that canvas puts the column where it lands.

*One drag engine.*

- **Every drag that starts in the page is a pointer drag of one engine**:
  columns, text cards (their frames and inventory slots) and tasks (board
  cards and sidebar rows). HTML drag and drop is gone, except as a drop
  target for files dragged in from the desktop onto a picture field,
  which only the browser's drag can bring. The browser's own drag of
  selected text is not ours, and stays as the browser makes it.
- **The engine reports a source, a target and the keys held**, each
  pointer frame; a pure planner returns what a drop there would do, as a
  value (moves, copies, or refused and why). The engine draws that
  answer and, on a drop, carries it out. A target is found under the
  pointer with `elementFromPoint` and the drop zones' own attributes, the
  dragged layer letting the pointer through.
- **It is drawn as the person moves**, at the display's rate:
  - past the threshold, what is dragged lifts: it follows the pointer,
    and its header (or its card face) rises, shadowed, and leans with its
    speed. A column itself only translates: scaling, rotating or
    shadowing a long column, or moving a light copy over the strip, costs
    frames on a slow machine (S153);
  - along the strip, its neighbours slide apart to open the gap it would
    land in;
  - leaving the strip, a column shrinks to its card face, its icon and
    name, about a slot's size; back over the strip, it grows again;
  - a target it would land on lights, an inventory slot opening and a
    sidebar task filling a ring over the delay before it opens; a target
    that refuses it greys;
  - dropped, it flies into place; cancelled by Escape or a refused drop,
    it springs back home.
- **Touch is not decided here.** Whether a short press can start a drag
  on iOS Safari while a swipe still scrolls is S154's question, still
  open; until it is answered, a touch only scrolls and taps.
- **With reduced motion**, the same states show without springs or
  flights.

**Consequences.**

- **Every column offers the same two controls**, and any of them can be
  cleared from a canvas, recoverably for a week.
- **A thread changes task in one drag and keeps running.** The page's
  path through the inventory (ADR-0127) stays for a thread you mean to
  put away.
- **Trashing is shared.** A column someone trashed disappears for
  everyone, and anyone on the task can bring it back. Undo stays each
  person's own history of moves (ADR-0066).
- **The stored trash place changes shape.** Records in the old one stop
  decoding; they are at most a week old, and a record migration deletes
  them, since a sweep cannot read a row that does not decode.
- **`holderOf` no longer counts a trash** as anyone's holding; a trashed
  thread is a state of its own, which every gate that refused a held one
  refuses too.
- **The HTML drag handlers in the page go**: `CARD_MIME`, `ROOT_MIME`,
  `dragCard` and `startRootDrag`. Each drag's planner stays as it is.
- **Nothing drags out of the page.** A card reaches another tab or app
  through the clipboard, not a drag.
- **The drag holds the display's rate on a slow machine** (S153: ten
  long columns, the CPU throttled four times) with the column moved flat,
  `elementFromPoint` costing under half a millisecond a frame; the lift's
  first frame is set up at the press, before the threshold, since it is
  the one long frame of a drag.
- **Nothing drags by touch yet.** Dropping HTML drag and drop loses
  little there, since its touch support was weak; S154's probe is ready
  for when an iPhone is at hand.

**Alternatives rejected.**

- **× only for a thread not yet sent** (ADR-0126). Clearing a canvas
  needed the inventory, which stops a run and hides the thread from
  everyone else.
- **× as fold**: the folded strip stays on the canvas, so nothing is
  cleared.
- **× as Move to your inventory**: it hides shared work in one person's
  inventory, and there is already an item for it.
- **Each person's trash, as before.** Only the discarder could bring back
  a column the whole task shared, and nobody else could find it.
- **A trash place storing whose trash and which task beside each other.**
  Two facts that can disagree, with each other and with where the card
  was. `left` is the one fact the rest follow from.
- **Restoring to the nearest place that still takes the card.** Each kind
  needs its own rule for where that is; a refusal that says why needs
  none.
- **Moves in ⋯ (left, right, first, last)** as the keyboard's way to
  reorder. Four items for what a drag and Alt+arrows already do.
- **HTML drag and drop for everything.** The browser owns the drag image,
  the cursor and the cancel animation, `dragover` fires at its own pace,
  and touch support is weak. Hiding its image to draw our own fights
  Safari's `setDragImage` and Firefox's `drag` coordinates.
- **A pointer drag in the strip and an HTML drag beyond it.** A script
  cannot start an HTML drag partway through a pointer drag, so one
  gesture cannot cross from one to the other.
