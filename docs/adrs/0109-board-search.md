# ADR-0109 — One search for the whole board, filtering every state in place

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`
- **Amends:**
  - ADR-0112: the search and "mine" move from the closed state to the board's
    top, and filter every state, open and closed.
- **Amended by:**
  - ADR-0115: the search and "mine" move to the footer's strip while the board
    is open, in the states' place; a column's head shows the strip's counts
    over the roots it shows; a banner names a filter; Escape and Clear lift
    the words and "mine"; a person's open focuses the search.

**Context.** ADR-0085, restated as ADR-0112, gave the board one search, the
closed state's, carried over from the Archive tab: archived roots were the
ones out of sight. Open states grew too. pine·trie's own Backlog holds 96
roots, and the only way to find one was to scroll the column and read it. A
search in one column also asks you to know the column, and when you are
looking for a root you often don't.

**Decision.**

- **One field and "mine" sit at the board's top**, above its states, and
  filter every state, open and closed. They are kept for this browser tab
  only and never stored, as before.
- **A root is kept when its label holds every word typed**,
  case-insensitively, in any order. It searches labels, not messages, as
  ADR-0063 has it. The roots have titles (ADR-0074), so labels find them.
- **The states keep their place and the items their order.** A root the
  search drops is hidden where it was, so the board keeps its shape and
  you can still find things by where they sit. Each state's head says
  how many it shows ("12 of 96") while the board is filtered. Its mark, its
  ◌ and ⇡ counts, the strip and Remove's refusal still count every root
  in the state.
- **Move up and Move down step among the items shown**, so every move can
  be seen: up goes before the shown item above, and down goes just after
  the shown item below. A drop at the end of a filtered column lands at
  the end of its state.
- **The closed state shows its kept roots newest first**, and with no
  query only its most recent few, as before.
- **Escape clears a query before it closes the board.** A menu open on the
  board takes Escape first, then a query, then the board. `/` focuses the
  field while the board is open, unless you are typing somewhere.

**Consequences.** A filtered column can show none of its items, and it is
still a place to drop. The board's states scroll under the field, which
stays put. The field does not take focus when the board opens: the board
sometimes opens by itself, and taking focus would interrupt typing.

**Alternatives rejected.**

- **A search in each state.** It keeps the fault: you have to know the
  column first.
- **Results as a list apart from the columns.** It loses the board's
  shape, which is how people remember where a root is.
- **A Cmd+K palette to go to a root.** Quick for finding one root, but it
  does nothing for triage. It can come later, beside this search.
- **Searching the first message's text** as well (a bounded excerpt in the
  directory record). It costs a record change, and the roots are titled.
  It waits until a label fails to find a root.
