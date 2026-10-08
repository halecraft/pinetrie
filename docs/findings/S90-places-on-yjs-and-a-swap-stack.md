# S90 — Places on Yjs over time, stacks that come and go, and a swap stack

- **Status:** Answered
- **Led to:** ADR-0048, ADR-0066

Asked after S82, while planning undo of moves on the host (ADR-0066): three
questions S82 left open. Can a Yjs places document be trimmed at startup?
What does a stack cost that is made and dropped as people come and go? And
can a client's own stack over its inventory undo a swap beside the repair's
writes? Measured in a lane (Node 24) against Kyneta with `undo({ whole: true })`
(Kyneta `11365c0`). Places was a Yjs document of `rev` and a record of
`.json()` rows (a place and a placer). The probes (`probe-s83.ts`,
`probe-s83b.ts`) and their output (`results-s83.json`) are kept under
`.plans/s82-probe/`, not committed. The probe was named S83 before that number
went to `S83-jj-update-reads.md`.

**Answers.**

1. **Compaction does not shrink Yjs places.** 10,000 moves over 100 cards,
   stored, then a restart that opened the document as a relay copy and
   compacted it: 247,787 bytes before and after. The rows and `rev` were the
   same, and a third start read them back. Kyneta's Yjs trim keeps every
   item's id, so the growth S82 measured (about 25 bytes a move) is for good.
2. **An undo stack works over a compacted document.** After that compaction,
   a gesture over one card and its `undo({ whole: true })` gave `undone`, and
   the card was back where it was.
3. **A stack made and destroyed per seat leaves little behind.** 200 seats,
   each a stack, one gesture, `dispose` and `destroy` of its document: the
   Exchange held 2 documents before and after. In a second probe of 300
   seats a round, with collection forced, the heap kept 4.7 KB a seat in the
   first round, 2.4 KB in the second and 0.3 KB in the third.
4. **A disposed stack's steps do not come back.** A new stack on a destroyed
   stack's document id started empty: its undo gave `none`. A stack that
   stayed (Bea's) still undid its own move after the 200 others came and went.
5. **A client stack over the inventory undoes a swap whole beside the
   repair's writes.** Slots 0, 1 and 4 filled outside any gesture, a swap of
   0 and 1 in a gesture, then the repair wrote slot 7 and cleared 4: the
   swap's whole undo gave `undone`, slots `{0: A, 1: B, 7: D}`.
6. **It refuses a swap whose slot the repair changed.** A swap of 0 into the
   empty 9, then the repair cleared 9: `refused`, one stale part, nothing
   reverted.
7. **A text stack on the same undo document hears none of it.** A second
   stack on the tab's undo document, key `cards`, scope `card:`: its undo
   gave `none` after every swap. Two keys on one document keep apart.

**What it settles.** Yjs places cost about 25 bytes a move, and no
compaction gets them back; at 250 KB per 10,000 moves that is accepted. A
stack per person can be loaded and dropped freely. The inventory's swaps can
be undone by the tab's own stack, under its own key on the tab's existing undo
document, and the repair cannot be undone through it.
