# ADR-0171 — A card is drawn compact, normal or full, each a box of its own size; your inventory is two columns, a bag of compact slots and a bench, in a frame that never changes size

- **Status:** Accepted (Duane, 2026-10-18)
- **Area:** `docs/06-interface.md`, `docs/glossary.md`,
  `packages/interface/TECHNICAL.md`, `packages/web/TECHNICAL.md`
- **Evidence:** S242, S243, S241
- **Amends:**
  - ADR-0126: the three levels of detail are compact, normal and full, and
    each is a box of a fixed shape: compact half a column, normal one column,
    full one or more. A kind fills compact as a value, drawn by one component.
    A folded strip and a shut margin's count are no level. The inventory draws
    compact slots and its selected card on a bench.
  - ADR-0048: the inventory is a 2 × 6 grid of 12 slots, not 3 × 6. A take
    while it is closed peeks, and the panel closes by ×, Escape and its
    toggle, opening and closing in motion.
  - ADR-0124: a thread's slot shows its name, then the first line of where it
    ended, and its status as a badge.
  - ADR-0132: the clipboard cell is a chip in the panel's header, with its
    keep.
  - ADR-0111: in your inventory, × discards on the bench as everywhere;
    leaving the open card is Escape or selecting another slot.

**Context.**

- **The panel changes size as you use it.** It is as wide as its content
  (`.inventory { width: max-content }`). The preview is added beside the
  grid on a selection and removed on an empty slot; a notice ("discarded ·
  the undo key …") is appended under the body. Each makes the panel jump,
  wider or taller, under the pointer.
- **Slots are near square, cards are not.** A slot is `8rem × 5.5rem` in a
  six-wide grid, so a text card's first three lines wrap at about 20
  characters. A card's text is a line of prose.
- **One card is drawn in three places.** A slot draws its face, the
  preview beside the grid draws it normal and read only, and Enter opens
  it whole and editable in a box laid over its neighbours from the slot's
  corner. The place you read it is not the place you edit it, and the
  open box looks like an edit in place that did not fit.
- **The levels have no shape.** ADR-0126's face, normal and whole are each
  total over kinds (`RENDERINGS` with `satisfies`), but a face is any
  component its kind writes, sized by the surface. A reference's face is
  a chip naming its kind (`addressWords`: "a quote"), so six references in
  six slots look the same. "Face" also names a folded column's strip,
  which is the column's header turned on its side (ADR-0137), and a shut
  margin's count, which is a signal.
- **Nothing closes the panel but its toggle.** It has no ×, and Escape
  does nothing to it. A take while it is closed opens it for twice a
  card's flight and closes it whatever the person does, a refusal ("inventory
  full") included, whose words go before they are read. It appears and
  goes in one frame.

**Decision.**

*Three sizes.*

- **A card is drawn compact, normal or full**, the words in types, CSS and
  docs: `Detail` is `"compact" | "normal" | "full"`, and "face" and
  "whole" go.
- **Each size is a box, its shape the size's, not the surface's**:

  | size | its box | where |
  |---|---|---|
  | compact | half a column wide (13.1rem), 4rem high: a header row, then two lines; text past them is cut | an inventory slot; a column dragged off the strip takes its box |
  | normal | one column wide, its height capped | the bench, a dock, a list, an open margin |
  | full | one column or more wide, scrolling | a canvas's column, the bench's open card |

  The sizes are CSS custom properties, half and whole of the column's
  width. A surface lays out in multiples of them and sets no card's size.
- **A kind fills compact; it does not draw it.** Compact is one value
  (`Compact`: the kind's icon, the place's tone, a mark, a lead line, a
  second line or none, a badge or none) that a total table of every drawn
  kind builds, and one component draws. The lead and the second line are
  one flow, the second dimmer, cut at two lines together (S241): a long
  first line takes both, so a text card shows about 65 characters. A
  kind's compact:

  | kind | lead | second line | badge |
  |---|---|---|---|
  | text | its first line | its second | its slot's 1–9 |
  | reference | its quote's opening words, its kind's words until the quote is read | the thread it is from | its slot's 1–9 |
  | thread | its name | the first line of where it ended | stopped, n queued |
  | note column | its title | how many notes it holds | |
  | fact, ask | its line | | |

- **A folded column's strip and a shut margin's count are no size.** The
  strip is the column folded (ADR-0137); the count is a signal. Neither is
  drawn by a kind's renderings.

*The inventory.*

- **A fixed frame, two columns wide**, the sum of its sizes: the bag, one
  column holding a grid two compact slots wide and six high, and the
  bench, one column. Its size depends on the viewport alone: no
  selection, notice or card changes it. Its top is 30vh, or higher where
  that would put its foot under the footer (S241).
- **12 slots, 2 × 6**, the first nine keyed 1–9. A slot is still an
  address, the same on every device, and full still means full: no spill
  over. Cards held in a slot past the twelfth when this lands move to the
  first empty ones. A person holding more than 12 sees each, in rows past
  the sixth, until they are put or discarded, and every take is refused
  "inventory full" until they hold 12 or fewer.
- **The bench draws the selected slot**: its card normal and read only, or,
  for an empty slot, what the slot is ("slot 4 · empty: drop or paste
  here"). Arrow keys and `hjkl` move the selection while focus is in the
  bag, and the bench follows without taking focus. **Enter, or a click on
  the bench, opens the card there**: full, in the bench's box, editable
  where its kind is, the caret in its text box, or for a kind with none
  focus on its first control. A click that ends a text selection in the
  bench selects, and opens nothing. Escape, from the bench or the bag,
  folds it and gives focus to the selected slot (S242). A reference
  opened shows **Edit as text**; a thread its path read only and
  **put**.
- **× discards on the bench too**, as on a slot and everywhere else
  (ADR-0111). Leaving the open card is Escape or another slot.
- **Narrower than two columns**, the panel is one column: the bag, and the
  bench in its place while a card is open, Escape giving the bag back.
  The slots keep their addresses.
- **The header holds the panel**: "inventory · 8/12", the clipboard chip
  ("last copied: …") with its **keep**, and ×. It is still the handle a
  drag docks it by.
- **A status line under the bag and bench keeps one line's height**, empty
  or not; a notice replaces the one before it.

*Open and closed.*

- **Whoever opened it closes it.** Opened by the person (the toggle, a
  link to their own held thread, an undo that shows it), it stays open
  until they close it: ×, Escape with focus in it, or the toggle. A click
  elsewhere does not close it: it stays open while you work in the
  columns (ADR-0048).
- **Opened as a side effect it peeks**: a take while it is closed opens
  it, the card lands, and it closes. A pointer over it, focus in it or a
  drag over it during a peek keeps it open, as if the person had opened
  it: the peek's close looks, when it comes, at whether it still peeks
  (S243). The pointer must move: a panel opened under a still pointer is
  not engaged by it. Its toggle pressed during a peek keeps it open too. A refusal keeps it open until the person acts elsewhere.
- **A card held over the closed toggle in a drag opens it** while a ring
  around the toggle fills, as a canvas in the sidebar opens.
- **It opens and closes in motion**: growing from its toggle and shrinking
  back into it, in 200 ms, the column fold's time (ADR-0137); under
  reduced motion it fades. It is always drawn, hidden while closed, so
  its close has frames to run in (S243).
- **A card flying into it flies on the page, not in the panel**: from
  where it was to its slot's place as laid out, while the panel grows,
  the card in the slot shown once it lands. Flown inside the growing
  panel, it starts hundreds of pixels from where it was (S243).

**Consequences.**

- The panel is as wide as a card two columns wide on a canvas, and a slot
  as wide as half a column; a column dragged off the strip shrinks to a
  slot's box (ADR-0134), compact's size.
- Every kind has the same compact anatomy because one component draws
  it, and no kind can draw a compact of another shape. A lead with no
  text is a unit test's to catch, as a type cannot.
- The rename touches every surface's code and the glossary's row for the
  levels, and `cardDetail`'s mapping of a fold to a level goes.
- Someone with 13 to 18 cards held finds them past the grid, and must
  tidy before the next take.
- A note column is 20rem wide and a thread's column 28rem: half a column
  is half of a thread's.

**Alternatives rejected.**

- **Three slots wide:** feels more like a game's grid, but the bag is a
  column and a half, and the panel no whole number of columns.
- **18 slots, or a spill-over past 12:** 18 compact slots make the panel
  taller than many screens, and a spill-over is a drawer nobody opens,
  which "full means full" is there to prevent.
- **Chests, a slot holding a grid of its own:** they fit the game and keep
  slots as addresses, but are a new kind with nested slots and moves on
  the host. They wait until 12 proves too few.
- **Editing as soon as a card is selected:** arrow keys moving the
  selection would land in text.
- **The clipboard cell at the top of the bench:** it would change the
  bench's height by what was copied.
- **Keeping each kind's own face component, with a size check:** a check
  in a browser proves the box, but not that every kind says what it is
  in it; one value and one component do both.
