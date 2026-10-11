# ADR-0133 — A card dropped or pasted on a filled slot of your inventory replaces what was there, which goes to your trash

- **Status:** Accepted (Duane, 2026-10-11)
- **Area:** `docs/glossary.md`
- **Amends:**
  - ADR-0132: a drop or a paste aimed at a filled slot replaces its card,
    which goes to your trash in the same undo step; only a gesture with no
    slot of its own (a take, keep) needs a free one.

**Context.**

- **A drop from outside lands where you did not aim.** A card dropped on a
  slot already holding one is taken into the first empty slot, counting
  from the grid's first (`planPut`'s `takeIntoInventoryAt`, core's
  `firstEmpty`), and refused "inventory full" when there is none. A drop
  on slot 9 can land in slot 2.
- **ADR-0132 (Revised) made every way into the inventory need a free
  slot**, keep and a paste into a slot among them. Duane, reviewing it:
  a person who drops on a slot means that slot.
- **Inside the inventory a drop already respects its aim**: a card dropped
  on another's slot swaps with it (ADR-0048), and nothing leaves.

**Decision.**

- **A drop or a paste aimed at a filled slot replaces its card.** The card
  that was there goes to your trash; the new one takes its slot. One
  gesture, one undo step: the undo key brings the old card back to its
  slot and sends the new one back where it came from (a paste's is
  removed).
- **It is offered where the slot's card may be discarded** (ADR-0132's
  law: as for cut, so here). A card that may not be (today a thread
  already started) is not replaced: the drop or paste is refused, saying
  so, and nothing moves.
- **A card already in your inventory still swaps** when dropped on
  another's slot, by drag or Alt+arrows: it is rearranged, not entering.
- **A gesture with no slot of its own needs a free one**: a take
  (Ctrl+Shift+I, Move to your inventory) and keep land in the selected
  slot if it is empty, else the first empty one, and are refused
  "inventory full" when there is none. Nothing is discarded that you did
  not aim at.
- **A replacement never fills the inventory**: one card leaves as one
  enters, so it is never refused "inventory full".

**Consequences.**

- **Nothing is built by this ADR**; it is built with ADR-0132's plan. Its
  word goes into the glossary as accepted and not yet built.
- **The host plans a replacement as one move set** (`planMoves`): the
  slot's card to your trash, then the new card into your inventory, or
  the paste's creation there, accepted or refused whole. The host knows
  no slots; the page names the slot (`MoveHow.slot`), and the session
  gives the new card the freed one.
- **The replaced card's discard is worded where you acted**, as any
  discard's ("discarded · the undo key brings it back").

**Alternatives rejected.**

- **Landing in another empty slot** (today). It overrules where the person
  aimed.
- **Swapping the slot's card back to where the dropped card came from.**
  It often cannot land there (a thread in a note column), and a paste came
  from nowhere.
- **Refusing a drop on a filled slot.** It makes the person empty the slot
  first, for a result one undo already reverses.
