# ADR-0068 — The rail draws branches beside their fork: rows by depth, colour by branch

- **Status:** Accepted (Duane, 2026-10-04)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`
- **Evidence:** S9, S59
- **Amends:**
  - ADR-0029: a track is a branch's colour, by creation order, not its place
    on the rail.
  - ADR-0031: rows go by depth, so a branch starts beside its fork, and a
    capsule is drawn in its branch's place.
- **Amended by:**
  - ADR-0089: a track is still a branch's rank, but its colour starts from a
    slot its root's id picks, in a larger palette.

**Context.** The rail drew a root's tree as a git graph. Every item took the
next row in depth-first order, so a branch's first dot came after every row
of the older subtree. A branch off message 5 of a 40-message trunk started
40 rows down, joined to its fork by a long empty line. Its dots never sat
beside the trunk's. The rail shows where conversations branch. It is not a
commit log, and no message needs a row to itself across the whole tree.

A row's track was both its place across the rail and its colour, which each
column takes from its last message (`branchColors`). Where items are drawn
depends on capsule sizes, and those depend on presence: someone else's
ring splits a capsule. `App` reads no presence (S59), so a column's colour
cannot depend on where its branch is drawn.

**Decision.**
- **Rows go by depth.** An item's row is its parent item's `slot + span`,
  so a branch starts on the row under its fork (`placeRail`,
  `packages/core/tree.ts`).
- **A branch takes the leftmost place free for its whole height.** Its
  height runs from its fork's last row to its own last row. Branches are
  placed in order of their first row, each in the lowest place whose last
  branch ended above it. The rail is no wider than the most branches on
  any one row, a branch never shares its parent's place, and the bend into
  a branch never lands on another branch's dot.
- **A track is a branch's colour, by creation order.** The oldest child
  continues its parent's track. Every other branch's track is its first
  message's rank by id among the tree's branches (`projectRail`). Ids sort
  in creation order (S9): the trunk is 0, and a new branch takes the next
  number without changing any other's. A rail item carries both `track`
  (colour) and `across` (place).

**Consequences.**
- A branched root's rail is shorter, and a branch is drawn beside the
  messages it diverged from.
- A row no longer means a position in one reading order: two items on one
  row are at the same depth on their paths. The rail's buttons stay in
  depth-first order, so Tab moves through a subtree before the branch drawn
  beside it.
- Places can move when presence changes, as rows already could. Colours
  never do.
- Two branches share a colour only when their tracks are eight apart. Some
  existing roots changed colour once, where the old allocation had reused a
  track.
- A bend from a parent to a place several across can still cross a branch
  between them, as before.

**Alternatives rejected.**
- *Allocate tracks by vertical range and keep them as both place and
  colour.* Colours would follow presence, which `App` does not read.
- *Keep the git-graph allocation for colour only.* It freed the trunk's
  track once the trunk ended in depth-first order, so a branch of a branch
  often took the trunk's colour, and would now be drawn beside it. A new
  branch could also shift others' colours.
- *Allocate places on the uncompacted rows.* Each branch compacts by a
  different amount, so branches apart in rows can overlap once compacted.
- *Shorten only the line,* by bending lower. The branch would still sit
  below the older subtree, and the rail would be as tall.
