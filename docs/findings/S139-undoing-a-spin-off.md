# S139 — A host undo stack names the cards its next undo moves before it reverts them

- **Status:** Answered
- **Led to:** ADR-0111

Serves a card that becomes a thread (ADR-0111, ADR-0113): the undo key
lifts the new thread back into the card while the thread holds only its
first message, and refuses once someone replied. The host must know which
cards an undo would move before it lets Kyneta revert them.

**Question.** 1. Does an `UndoStack` (`@kyneta/exchange`, as the host's
`move-history.ts` makes it) show the footprint of the step its next undo
reverts, before reverting? 2. If not, does an undo followed by a redo of
the same step restore the places exactly (whole, with `rev` raised apart,
S82), so the host could undo, read, and redo?

**Kill criterion.** Neither: then a spin-off's undo needs a history of its
own beside the host's stacks.

**Throw away.** The probe, `apps/pinetrie/host/s139-probe.test.ts`.

## Answers

1. **Yes.** `UndoStack.top(direction, docs?)` returns the `Step` that
   `undo` or `redo` with those `docs` tries first, without reverting it
   (`packages/exchange/src/undo/stack.ts`). Each `Part` carries its
   document and `footprint`, the paths its revert writes and reads. A
   discard of card `a` (a write of its record in the places document,
   inside a gesture) read back as
   `[{ doc: "pinetrie:card-places", footprint: [["cards", "a"]] }]`, the
   card still gone. `top` is a read of the undo document: whether the step
   still stands is known only when it is tried, so the host plans on the
   cards it names, and Kyneta's `whole` refusal still applies.
2. **Yes, as well.** After undo then redo of that step, `readPlaces` read
   the same JSON as before the undo, and `top("undo")` named the same
   card again.

**Decision.** The lift uses `top`: the host reads the cards the next undo
moves (`cardsOfParts` over its footprint), plans whether it may happen
(`planLiftRoot`), and only then undoes. No undo-and-redo is needed.

**Evidence.** The probe ran a places document and one stack in an
in-memory `Exchange`, as `move-history.test.ts` does, under Vitest.
