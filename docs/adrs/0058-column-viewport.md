# ADR-0058 — The rail outlines what each column shows, and a column shown again is where its reader left it

**Status:** Accepted. Implementation: `PLAN-2026-10-02-rail-viewport`.
Amends ADR-0049: besides what it knew of its end, a column keeps where it
was left, for the page's life.

**Context.** The rail draws the whole tree of a root (ADR-0029, ADR-0031).
Nothing on it says which part of it is on screen: a long trunk's rail is a
few capsules, and a reader scrolled halfway up a column cannot see where
that is in the whole.

A column of a root tab you leave is unmounted (ADR-0049), and shown again it
is placed by `alignOnOpen` as if just opened: the first column at its end, a
branch level with its fork point. What it knew of its end comes back (`SeenEnd`:
↓ new below, the tip a reader left, ADR-0056), but where the reader was does
not. A reader halfway up a long thread who switches tabs comes back at its
end.

Both need the same fact: which messages are in a column's view, from the
first (and how far into it the view's top is) to the last.

**Decision.**
- **A column measures its view** once a frame at most, on scroll and resize,
  as the ask bar does (`useViewport`, `packages/client/use-viewport.ts`):
  the first message at or above the view's top, and how far into it; the
  first message reaching the view's bottom, and how far into it
  (`visibleSpan`, `packages/client/viewport.ts`). A fold's line is no
  message: the view's top in it is past the message above it, and the span
  covers the folded messages between.
- **The rail outlines each column's span** in that column's colour: a
  rounded outline around the dots in view, with a faint fill, under them
  (`railBands`, `packages/client/rail-view.ts`). A dot is outlined whole; a
  capsule is cut where the view's edges fall in it, each of its messages an
  equal slice, as a click on it reads it (`pickAt`). A column whose path
  changes track at a fork has one outline per track.
- **Only the outlines read the views.** Columns write a `ViewportStore`
  made once in `App`, and `RailViewport` reads it with
  `useSyncExternalStore`, so a scroll redraws neither a column nor the
  rail's dots.
- **The rail follows the column moved last**, scrolling only when that
  column's outline leaves its view (`railScroll`). It holds still while the
  pointer is over it, and for `RAIL_HOLD_MS` after the reader scrolls it or
  the pointer leaves it. It moves only when a column's view does: a redraw of
  the rail for anything else leaves its scroll alone.
- **A column leaving keeps a spot**, keyed by message, not by column key: the
  message at its view's top and how far into it, or, while it followed its
  end, its last message (`spotOf`). One spot per column: a new one replaces
  any at the messages the column shows (`keepSpot`).
- **A column shown again goes to the spot at one of its messages**
  (`spotFor`, `placeAt`), before alignment, and is told it was placed
  (`PLACED`). An end spot at a message that is still the last is the column's
  end, and it follows; one that more has come after puts that message's
  bottom at the view's bottom, short of the end, where ↓ new below shows. A
  column with no spot, whose spot's message is not drawn, or whose content
  fits its view is aligned as before: only alignment sets the spacer that
  lines a short branch up with its fork point.
- **Spots are kept for the page's life** (`spotStore`), as `SeenEnd` is. A
  reload keeps none.

**Consequences.**
- A reader can see where in the whole tree each column is, and which column
  shows what, by colour, as the column headers and fork dots already say.
- A tab switch no longer moves a column that was scrolled; a column at its
  end still comes back at its end, and one whose thread grew meanwhile comes
  back at its old end with ↓ new below.
- A spot is keyed by message, so it fits whichever column shows that
  message: a column closed and opened again, or a column moved. The Archive
  preview keeps none: it is a glance, and its spot would replace the root
  tab's. The same value could be kept
  for a person across devices (ADR-0037); that is not done here.
- Each mounted column measures its messages' boxes once a frame while it
  scrolls or grows: a querySelectorAll and a read of each box. The ask bar
  already does as much.

**Alternatives rejected.**
- An outline filled in the track's colour: it lies on the track, which is
  drawn in that colour, so the dots and the line inside it would not show.
- One horizontal line across the rail at the view's top: it says how far
  down but not on which track, and has to choose a column.
- Dimming every dot not in view: the rail's other signals (rings, pips,
  pulses) would dim with them, and it cannot say which column shows what.
- Keeping a column's `scrollTop` by its key: wrong once content above it
  changes height (images, tool rows, folds), meaningless on another device,
  and lost when a column is closed and opened again.
- Measuring the column as it unmounts: React runs layout effects' cleanups
  while other parts of the tree are being removed. The latest measurement is
  kept instead.
- Following the rail on every redraw: presence and new messages redraw it,
  and would pull it back from where the reader scrolled it.
