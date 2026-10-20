# ADR-0177 — A bin trashes a card and × only closes; your inventory's bench holds put and trash, and its slots have no ×

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`,
  `packages/web/TECHNICAL.md`
- **Amends:**
  - ADR-0111: a card is trashed by a bin, drawn, never by ×; × on a card open
    on your inventory's bench closes it, as Escape does.
  - ADR-0134: a thread not yet started is trashed from its header by a bin,
    not ×.
  - ADR-0171: the bench has a bar of put and trash, always drawn; a slot has
    no ×, and Delete on a selected slot trashes its card.
- **Amended by:**
  - ADR-0198: an unstarted thread's bin takes the fold toggle's place.

**Context.**

- **× meant two things.** On a card it discarded (ADR-0111), on a column of
  a thread not yet started it trashed (ADR-0134), and on the inventory panel
  and a pane it closed. A person reads × as close: pressed on the card open
  on the bench, it threw the card away.
- **A slot's × was the inventory's only way to trash with a pointer**, shown
  on hover over a compact card, where it read as closing the slot.
- **The page's words are moving from discard to trash**
  (`docs/glossary.md`, *trash*): what goes is in a trash, and comes back
  with the undo key.
- **U+1F5D1, the bin character, is missing from common fonts**: it drew as
  a box of hex digits.

**Decision.**

- **A bin trashes, × closes, everywhere.** Every button that sends a card to
  the trash is a bin, drawn as an icon (`TrashIcon`), titled "trash
  (Ctrl+Shift+Backspace) · ⌘Z brings it back": your message's, a note's, a
  queued or pinned card's, a comment's, and a thread's not yet started in
  its column's header. × closes and loses nothing: the panel's, a pane's,
  and a card's open on the bench.
- **The bench's bar**, above its card and always drawn: **put** and **trash**
  for the selected slot, both disabled on an empty one, so the bench keeps
  its height. Put is no longer at the foot of the opened card.
- **× on the bench's open card closes it**, back to read only, the card in
  its slot, and focus on the slot, as Escape. Its frame shows no bin: the
  bar's is the bench's one.
- **A slot has no ×.** Delete or Backspace on a selected slot trashes its
  card, when you may.
- **A trash says "trashed · ⌘Z brings it back"** where you made it.

**Consequences.**

- The code's own names (the `discard` intent, `isDiscardable`, the notice
  code and the stored row kinds) keep "discard" until the plain-words
  change renames them; this changes what is drawn and said.
- Trashing from your inventory takes two steps with a pointer, select then
  trash, or one key, Delete.

**Alternatives rejected.**

- **× closes on the bench alone, discarding elsewhere:** the same mark
  would still mean two things a column apart.
- **The bin as a character:** it does not draw in common fonts.
- **Trash in the open card's own frame as well as the bar:** two bins for
  one card on one bench.
