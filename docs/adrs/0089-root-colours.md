# ADR-0089 — Each root's branches start from a colour of their own: a larger palette, seeded by the root's id

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `docs/06-interface.md`, `packages/web/TECHNICAL.md`
- **Evidence:** S110
- **Amends:**
  - ADR-0029: tracks still start at 0, but trunks no longer share a colour:
    each root's id seeds its palette.
  - ADR-0068: a track is still a branch's rank, but its colour starts from a
    slot its root's id picks, in a larger palette.

**Context.**

- **Every root starts the same.** A track is a branch's rank within its
  root (ADR-0068, `projectRail`), and its colour is `PALETTE[track % 8]`
  (`packages/client/rail.tsx`). Every trunk is the same blue, and every
  first branch the same green. Two roots side by side can't be told apart
  by colour, and a new thread always looks like the last one.
- **Some track colours already carry other meanings.** Track 2's
  `#e0c080` is the attention amber (`.root-status.needs-you`). The palette's
  green and red sit near the review's added and removed lines and the
  offer's "ready" green. ADR-0024 kept people's colours apart from "the
  tracks' blues and greens" by hand.
- **ADR-0088 needs a colour for each root**, for a tile when it has no
  sprite.

**Decision.**

- **A larger palette.** Twelve colours at OKLCH lightness 0.72 and chroma
  0.14, in hue order (S110). Their closest pair is about 0.06 apart in
  OKLab, as far as the old palette's closest pair. They are 0.08 or more from a person's
  first colours (magenta, white, yellow, ADR-0024), the attention amber,
  and the review's added and removed text. Each is at least 6.8:1 on
  `--page`.
- **A root seeds its palette.** A hash of the root's `RootId` (ADR-0063)
  picks the slot its
  trunk takes. Track *n* takes slot `(seed + 7n) mod 12`. The stride, 7, is
  coprime with 12 and near 12/φ, so neighbouring tracks are five slots
  apart.
- **Nothing is stored.** Every device computes the same colours from the
  id. ADR-0068's guarantee holds: a new branch changes no other branch's
  colour. Two branches in one root share a colour only when their tracks
  are a palette's length apart.
- **A root's colour is its trunk's.** Its tile in your list (ADR-0088), its
  trunk on the rail, and the stripe of a column on the trunk all take it.
- **`data-color` stays a palette slot**, so linking a header to its fork
  dots on hover works as before, with a rule pair per slot. A pending
  branch stays grey.

**Consequences.**

- Every existing root changes colour once.
- Roots in your list will sometimes share a colour. With 12 colours and
  six roots, some pair shares one about eight times in ten. Within a root
  the first twelve branches' colours are all different, and in your list
  the sprites and initials tell roots apart.
- The track colour is no longer a function of the track alone. Wherever
  the client turns a track into a colour, it needs the root's seed too:
  the client carries it as a context (`useTrackColors`).
- `docs/06-interface.md`'s "each branch has its own colour, by when it was
  made" gains "from a start of its root's own".

**Alternatives rejected.**

- **A random colour stored on the root.** It needs a write for every
  root, and a carry-over for the ones that exist. A hash of the id is just
  as varied, and needs neither.
- **A seed chosen to avoid the colours in your list.** A root's colour
  would depend on your list, so it would differ between people and change
  over time.
- **A hue straight from the hash, on a continuous wheel.** Two branches of
  one root could land a few degrees apart. Stepping through a fixed palette
  guarantees the spread, and a fixed palette can be checked against what
  already has a colour.
- **A separate, muted palette for the roots' tiles only.** The tile would
  match nothing on screen. Using the trunk's colour links the list to the
  open root.
- **Keeping eight colours, seeded.** With a seed per root, a larger palette
  costs nothing, and eight colours leave too little room once the clashing
  ones are taken out.
