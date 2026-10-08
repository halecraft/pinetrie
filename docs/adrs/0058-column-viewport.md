# ADR-0058 — The rail outlines what each column shows, and a column shown again is where its reader left it

- **Status:** Accepted
- **Area:** `docs/06-interface.md`, `packages/web/TECHNICAL.md`
- **Amends:**
  - ADR-0049: a column also keeps where it was left, by message, and comes
    back there.

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
  rounded outline around the whole dots and capsules in view, with a faint
  fill, under them (`railView`, `packages/client/rail-view.ts`). A column
  whose path changes track at a fork has one outline per track.
- **Where the view's top or bottom falls inside a capsule, a tick crosses
  it there**: a 2 px line, over it, in the column's colour with a dark edge,
  wider than the capsule, each of the capsule's messages an equal slice of
  it, as a click on it reads it (`pickAt`). Only the first and last items
  can be cut, so a view has at most two ticks. Two edges within
  `EDGE_MERGE` (a quarter row) of each other in one capsule are one line.
  The outline says which items; a tick says where the view starts or ends in
  one.
- *Amended in review, twice.* The outline first cut the capsule itself, and
  stretched to a least height. A capsule holds up to 999 messages in four
  rows, so a view of one message was a sliver, stretched into a 12 px box:
  neither a dot's shape nor a capsule's, and hanging past the capsule's end.
  Then the tick marked the part of a capsule in view; seeing most of one, it
  was a solid block, which read as the capsule's own fill (people wrote
  it). A tick now marks only an edge.
- **Only the outlines read the views.** Columns write a `ViewportStore`
  made once in `App`, and `RailViewport` reads it with
  `useSyncExternalStore`, so a scroll redraws neither a column nor the
  rail's dots.
- **The rail follows the column moved last**, scrolling only when that
  column's view leaves the rail's: its `extent`, where its edges fall, cut
  in capsules where the ticks are, not its outline, which can be a whole capsule
  far taller (`railScroll`). A column measured again, unmoved, is not one
  moved (`sameViewport`). It holds still while the
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
- An outline cut at the view's edges inside a capsule (the first version):
  a few messages of a long capsule are under a pixel.
- A tick over the part of a capsule in view (the second): seeing most of a
  capsule, it filled it.
- A bracket beside the track: it needs room between tracks, widening the
  rail.
- Opening the capsule into dots where the view is: the rail's shape would
  change under the eye as a column scrolls, and every frame would redraw it.
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
