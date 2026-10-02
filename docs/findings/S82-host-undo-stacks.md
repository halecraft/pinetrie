# S82 — Kyneta undo stacks on the host, one per seat, over host-written places

Asked while planning undo of moves (ADR-0052, ADR-0059): can the host keep a
Kyneta undo stack per seat over a places document only it writes, and so
give moves Kyneta's undo instead of Pineta's own reverse handoffs? Measured
in a lane (Node 24) against Kyneta with `undo({ whole: true })` and the
`Undone` results (Kyneta `11365c0`). One host Exchange, no clients: a
places document on Yjs, each card a `.json()` row of its place and placer,
and stacks `undo:ada` and `undo:bea` scoped to it. Each move was one
`gesture` on its seat's stack; a move by anyone else was a write outside
it. The probe and its output are kept under `.plans/s82-probe/`, not
committed.

**Answers.**

1. **A whole undo is refused when someone moved the card since.** Bea moved
   Ada's taken card: `refused`, one stale part, the card left where Bea put
   it.
2. **A row carrying its placer catches a move away and back.** Bea moved
   the card away and Carl moved it back to where Ada's move left it: the
   row's placer differs, so the undo was `refused`. The same away and back
   made by Ada herself outside her stack restored the row exactly, and the
   undo went through: a value check cannot tell that case apart. Only an id
   of the last move in the row would.
3. **Without `whole`, a step that no longer stands is skipped.** Ada took
   two cards and Bea moved the newer: a plain `undo()` reported
   `undone` with one step `dropped`, and undid the older take, out of
   sight. With `whole`, the same undo was `refused`, and the older take
   stayed.
4. **A gesture over three cards is undone whole or not at all.** With Bea
   moving one of them, `refused`, none reverted; untouched, all three went
   back.
5. **Two seats' stacks in one runtime leave each other alone.** Ada's undo
   and Bea's each undid only their own move.
6. **A `rev` raised inside the gesture refuses every whole undo.** Every
   other move raises `rev`, so the step's `rev` part never stands. `rev`
   must be raised in a write of its own, outside the gesture.
7. **`top("undo")` names the step and its region, not its target.** It gave
   the step's id and its footprint, `["cards", "<card id>"]`: which card,
   but not the place it would go back to, which is in the substrate's
   encoded record. Showing the place first needs the host's own note of the
   step, by its id.
8. **Yjs places grow with every move.** 10,000 moves over 100 cards: the
   Yjs document's whole export was 253 KB, the `json` document's 12 KB,
   about 25 bytes a move, kept for good, since a live Yjs document is never
   compacted (S24).

**What it settles.** Host-side stacks are sound for moves only with
`whole: true`: without it an undo acts out of sight. With it, a move's undo
is a check on the card's whole row, which catches a move made since by
anyone else, placer included; an id of the last move in the row would make
it exact. A keep of several cards becomes one step, undone whole. Against
that: `places` would leave `json` for Yjs or Loro and grow with every move,
`rev` would be written apart from each move, showing the place first needs
a note per step beside Kyneta's, and a slot swap, written by the client,
would stay in a history of its own.
