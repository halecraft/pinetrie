# ADR-0115 — The board's search sits in the footer, and a filter always shows

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`
- **Amends:**
  - ADR-0109: the search and "mine" move to the footer's strip while the board
    is open, in the states' place; a column's head shows the strip's counts
    over the roots it shows; a banner names a filter; Escape and Clear lift
    the words and "mine"; a person's open focuses the search.

**Context.** ADR-0109 put one search for the whole board in a bar at its
top. The board grows up from the footer, so a filter that shrinks it moves
its top edge, and the field you are typing in moved with it. The bar also
took a row from a board that is short of them. Meanwhile, the footer's strip
showed a button per state that only opened the board, so it did nothing
while the board was open. And a filter survives closing the board, but
nothing on the closed board said it was on.

**Decision.**

- **While the board is open, the strip holds the search and "mine"** in the
  state buttons' place: ▦, then the field, its ×, and "mine". The board has
  no bar. The footer does not move, so the field stays put while you
  filter. With the board closed, the strip shows the state buttons as
  before.
- **A column's head shows what the state's button showed:** its name,
  count, readers' avatars, highest mark, ◌ (roots the agent works in) and ⇡
  (roots with work ready to accept). Its count, ◌, ⇡ and readers describe
  the roots it shows ("12 of 96" while filtered). Its mark and Remove's
  refusal cover every root in the state: a filter you typed must not hide
  that something needs you. The strip, with the board closed, counts every
  root.
- **A person's open focuses the search.** Opening the board with ▦ or a
  state's button arms the field, which takes focus once as it mounts. The
  board opening by itself, with nothing in the sidebar, takes no focus.
- **A filter is always visible.** A banner at the board's foot names it
  ("Filtered by "parser" and mine: 14 of 140 roots") with **Clear**. The
  board grows up from the footer, so its foot holds still. The heads' "n
  of m" and the field's border are blue while a filter is on, the board's
  accent, never the amber that asks something of you. With the board
  closed, ▦ carries ⌕.
- **Clearing.** **Clear** and Escape lift the whole filter, the words and
  "mine". The field's × clears only the words. Escape on a board with no
  filter closes it, after any menu open on it has taken its Escape.
- **The filter lives in the page's memory:** it survives closing the board,
  not a reload.

**Consequences.** The strip's state buttons exist only while the board is
closed, so a check that reads them must close the board first. Each column's
head is wider, with avatars and counts beside its name. Filtering no longer
changes the board's top bar, but the board's height still changes with what
it shows, as before.

**Alternatives rejected.**

- **The bar at the board's bottom.** It holds still, but costs a row, and
  sits just above the strip, two bars back to back.
- **Holding the board's height while a filter is on.** It keeps a top bar
  still, but leaves an empty gap and keeps the row.
- **The field beside the state buttons.** It keeps the strip's ◌ and ⇡, but
  does not fit a narrow window, and the heads now carry them.
- **Heads that count every root while filtered.** On a filtered board, "⇡
  3" over one visible card sends you looking for cards you cannot see. The
  count's "of 96" and the mark already say there is more.
- **The banner at the board's top.** More visible, but it moves as the
  board shrinks; it is useful, not essential.
- **Clearing the filter when the board closes.** You would lose a filter
  you were still using between looks; ▦'s ⌕ says it is on.
- **Keeping the filter in this tab's storage.** A filter forgotten across
  reloads hides rows longest.
- **Focus on every open.** The board opens by itself with nothing in the
  sidebar; taking focus then would interrupt typing.
