# ADR-0132 — Copy, cut and paste are the system clipboard's, and the inventory holds what you take: the past is copied, the present is moved, and one planner decides what lands

- **Status:** Accepted (Duane, 2026-10-11)
- **Area:** `docs/glossary.md`
- **Evidence:** S151
- **Amends:**
  - ADR-0126: Cmd+C copies to the clipboard and takes nothing; Cmd+X cuts;
    nothing is taken from the past; a reference put from your hand leaves it,
    as every card does.
  - ADR-0127: a thread also reaches another task by a cut and a paste.
  - ADR-0066: a paste, a creation, enters its paster's history in the task it
    lands in, so the undo key takes it back.
- **Revised:**
  - 2026-10-11 (S151): Cmd+Shift+V pastes the text alone where the browser
    gives a paste for it (Chromium, Firefox; WebKitGTK gives none); a paste
    into the inventory needs a free slot, as a take does.
- **Amended by:**
  - ADR-0133: a drop or a paste aimed at a filled slot replaces its card,
    which goes to your trash in the same undo step; only a gesture with no
    slot of its own (a take, keep) needs a free one.

**Context.**

- **Copying fills the inventory.** ADR-0126 made Cmd+C on an entry, a
  block or a selection take a reference into your inventory as well as
  write markdown to the system clipboard (`planTakeReference`). So every
  copy opens the inventory panel for a moment, adds a card that only ×
  removes, and is refused "inventory full" at 18 cards even though the
  clipboard was written. People expect a copy to change nothing they can
  see.
- **Copy has two meanings.** A message's ⧉ writes the clipboard alone;
  its **take**, a table's ❝ and Cmd+C also take. A selection is taken
  only when a range of the message's text names it, so a selection
  across bold copies and one beside it also takes.
  In a column that cannot be written, Cmd+C on a focused message does
  nothing while ⧉ works (`onEntryKey` returns before it).
- **Cut does not cut.** Cmd+X outside a text box takes the focused card
  into your inventory and writes nothing, so a Cmd+V after it pastes
  whatever the clipboard held before. Cmd+C on a card does nothing.
- **What was copied comes back in two shapes.** Cmd+V pastes the
  reference's markdown; the put key puts a link. ADR-0126 left open how
  the clipboard carries a card's shape back into pine·trie.
- **ADR-0048 deferred the clipboard.** "Copy makes a new card where it is
  pasted; cut moves it" waited for the key system's redesign, with Cmd+C
  and Cmd+X left to text. This is that design.
- **S151 measured the clipboard** in Chromium, Firefox, WebKitGTK and
  Safari. A copy's own data rides in `text/html` through every path:
  another origin, another browser, the system clipboard. A custom type
  rides only within one browser, and WebKit keeps it to one origin.
  `copy`, `cut` and `paste` fire on a focused element that is not a text
  box, with nothing selected, in all four, with no workaround. Nothing
  but a paste reads the clipboard without a prompt or a refusal.
- **A drag engine is being designed beside this one** (in another
  thread, with Duane), in which a drag reports its source, its target and
  its modifiers, and a planner decides what the drop does. Paste and drop
  land things in the same places, so they need one planner.

**Decision.**

*Two kinds of thing, two holders.*

- **The past is copied; the present is moved.** An entry, a block or a
  range of a message's text never changes: it can be copied, linked and
  commented on, never moved, cut or taken. A card (a text card, a note, a
  reference, a thread card, a task card, a card in an inventory or a
  trash) is present: it has one place, and moves change it.
- **The clipboard is a tool.** It holds one copy of one thing, owns
  nothing, has no limit, and is the system clipboard. pine·trie only adds
  its own data beside the text.
- **The inventory holds what you take.** It owns present cards, has its
  18 slots, and is yours alone, as ADR-0048 and ADR-0124 have it.

*Six verbs.*

| verb | key | on | does |
|---|---|---|---|
| **copy** | Cmd+C (Ctrl+C elsewhere) | anything you can read, past or present | writes it to the clipboard. Moves nothing, opens nothing, is never refused for room, enters no undo history |
| **cut** | Cmd+X | a card you can discard | a copy, then a discard to your trash: one gesture, one undo step |
| **paste** | Cmd+V | where focus is | lands what the clipboard holds: a new thing that keeps its origin. The first paste after a cut moves the cut card out of your trash instead |
| **take** | Ctrl+Shift+I | a card whose kind may be in an inventory | moves it into your inventory, into a free slot of its 18 |
| **put** | Ctrl+Shift+O | the card in your hand | moves it out of your inventory to where focus is |
| **discard** | × | a card | moves it to your trash |

*Laws.* Each verb is offered exactly where its law holds, decided from
the card's kind (`KINDS`) and its place, so nothing offers what would be
refused for being the wrong kind:

- **Copy and paste never move a card.** Take, put, cut, discard and a
  drop move one; a paste after a cut moves the card it cut.
- **The inventory changes only by take, put, discard, a paste into a
  slot and a drop.** A copy never reaches it, so only what enters a slot
  needs a free one.
- **The clipboard changes only by copy and cut.**
- **Cut is offered where discard is.** On the past there is nothing to
  cut, and Cmd+X does nothing. A thread is cut as any card is.
- **Every change to the present is one undo step**, a paste among them.
  A copy changes nothing.
- **Put moves every card.** A reference in your hand leaves it when put,
  as a text card does (`KINDS.reference.put` goes). To land one thing
  many times, copy it and paste.

*What lands.* A paste lands what was copied by where it lands:

| copied | into a text box | onto a surface (a canvas, a note column, the board, a slot) | in another app |
|---|---|---|---|
| a selection of text | the text | a text card holding it, with its origin | the text |
| an entry or a block | a reference, as a link at the caret | a reference card | its markdown |
| a card | a reference, as a link at the caret | a copy of it where its kind has a copy, else a reference to it | its text; a thread or a task as a link |
| text from another app | the text | a text card | |

- **A selection is text** everywhere: copied, pasted and dragged, it
  stays text, whatever it was selected from.
- **Cmd+Shift+V pastes the text alone**, wherever the browser gives a
  paste for it (S151: Chromium and Firefox do, WebKitGTK does not).
- **Paste and drop are one planner.** `planPut` becomes one function of
  a source (a card, or an address of the past), a target (`PutTarget`)
  and how (move or copy). A paste calls it with copy; a drop with move,
  or copy while Alt is held; the past is only ever copied. The drag
  engine draws what it returns.

*The carrier* (S151).

- **A copy writes three types**, in the `copy` or `cut` event: the text
  as `text/plain`, which is what another app gets; the thing as HTML in
  `text/html`, its outer element carrying `data-pinetrie`; and
  `application/x-pinetrie`, the same JSON. That JSON holds what was
  copied (its address or card), a nonce for the copy, and the text it was
  written with.
- **A paste reads the custom type first, then `text/html`**, parsed (never
  matched as a string: WebKit writes it again in its own form), then the
  text. Pine·trie's data counts only when the paste's `text/plain` is the
  text it was written with: a rich editor can carry `data-pinetrie` back
  on text someone changed.
- **The clipboard events do the work**, not the async Clipboard API,
  which no engine lets a page read without a prompt or a refusal.
  `navigator.clipboard` stays only for a button's copy, which has no
  event (`useCopy`).
- **Dragging carries nothing out of the page.** The drag engine is the
  page's own; the clipboard is the way to another tab or app.

*The clipboard cell.*

- **The inventory panel shows the clipboard in a cell of its own**,
  beside the grid, not one of its slots: the last thing copied in
  pine·trie, drawn as its face.
- **Keeping the past takes two steps**: copy it, then drag the cell onto
  a slot, or press its **keep**, which pastes it there as a reference.
  The clipboard is one system and the inventory another; the cell is
  where you cross.
- **It says what it knows.** No page can read the clipboard before a
  paste, so the cell is pine·trie's memory of its last copy, headed "last
  copied here". A paste that brings something else (no carrier, or
  another copy's) replaces what the cell shows.
- **Nothing is dropped on the cell.** Copy is the one way in.

*Take.*

- **Take has one icon and one key everywhere it is offered**: the
  inventory's box with an arrow into it, and Ctrl+Shift+I; put is the box
  with an arrow out, and Ctrl+Shift+O. A copy is ⧉ everywhere.
- **Nothing is taken from the past.** A message's **take** and a block's ❝
  go: the past offers ⧉, comment and branch.

*Drag.*

- **A drop lands what a paste would**, at the same target, by the same
  planner. A present card dragged moves; with Alt held it copies, the
  drag showing which as Alt changes. The past dragged copies.
- **The past is dragged by a handle** (an entry's or a block's), not by
  its text. A selection's own drag stays the browser's, carrying text.

**Consequences.**

- **Nothing is built by this ADR.** Its words go into the glossary as
  accepted and not yet built, each becoming current as its part lands.
- **What goes when it is built:** copy opening the inventory, and "inventory
  full" on a copy; Cmd+X as take; `planTakeReference` and the
  `copySelection` intent's take; the message's **take** and a block's ❝;
  `KINDS`' `put`; the `showInventory` effect's brief show on a copy.
- **One file in the page reads and writes the clipboard**, the browser's
  side of it: the events, the three types, parsing `text/html`. What a
  copy writes and what a paste means are pure, in `packages/interface`,
  and a check keeps every other file in `packages/web` off
  `clipboardData` and `navigator.clipboard`. Pasted images go through it
  too.
- **A paste in a text box sees what was copied.** A card or an entry
  pastes there as a link; a selection, or text from elsewhere, as the
  text, as today.
- **Pastes become undoable**: "sends and copies are final" no longer
  holds of a paste, which makes a card. A copy still enters no history.
- **A cut thread follows the trash's rules for threads.** Today only a
  thread not yet started can be discarded, so only such a thread can be
  cut. Once a started thread can be trashed, it can be cut, and a paste
  on another task's canvas moves it there.
- **A cut card is in your trash until it is pasted**, and swept after a
  week like any discard.
- **The put key and Cmd+V are two hands**: the inventory's selected slot
  and the clipboard. Each lands by the same planner.
- **Left open**, for the plan: the clipboard cell's exact place in the
  panel and its face for each kind; the HTML each kind writes; the
  wording of "last copied here".

**Alternatives rejected.**

- **Copy takes a reference too** (ADR-0126). It made the most common
  gesture there is open a panel, fill a grid and fail at 18.
- **The clipboard as a slot of the grid.** It would count against the 18
  and be moved, swapped and discarded like a card it is not.
- **Cmd+X as take.** People expect a cut to remove the thing and put it on
  the clipboard; a take does neither.
- **Refusing Cmd+X on a thread, suggesting a take.** A thread is a card
  like any other; where it can be discarded, it can be cut.
- **Taking from the past in one step.** It would cross from the clipboard
  into the inventory in one gesture, the boundary this draws.
- **A custom type alone as the carrier.** Safari and WebKitGTK drop it
  across origins, and every engine drops it across browsers (S151).
- **The async Clipboard API.** Chromium had not answered a write after
  3.4 s, Firefox refuses custom types, and reading prompts or is refused
  everywhere (S151).
- **A package for the clipboard.** S151 found one way that works in all
  four engines (both carriers, the HTML parsed), with no workaround; one
  file in the page and pure functions beside the planners keep the
  boundary without a manifest.
- **Dragging between apps** (HTML5 drag and drop). The drag engine is the
  page's own, and the clipboard already carries a copy out.
- **Selections dragged as the past.** The browser's drag of selected text
  would fight a drag started on the same text, and a selection is text.
