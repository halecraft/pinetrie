# S242 — The bench follows the bag's selection without focus, and takes it on Enter if it focuses its box itself; Escape must fold from both, and a click ending a selection must not open it

Numbered S239 until 2026-10-18, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0171

**Question.** The inventory's bench draws the selected slot's card normal
while focus stays in the bag, and opens it full and editable on Enter or
a click (ADR-0171, proposed). With the bench beside the grid, not over it:
- Do the grid's keys (`gridKeyAct`: arrows, `hjkl`, Alt+arrows, Enter)
  still act while the bench shows a card, and never reach the bench's box?
- Does Enter put the caret in the bench's editor, and Escape put focus back
  on the selected slot, the open card folding to normal?
- In the bench's box, does Cmd+Z undo only that card's text (ADR-0052), and
  with focus back in the bag, does it undo a swap (the tab's own stack) or
  a move (the host's)?
- Does a click on the bench open the card without first selecting text or
  losing the bag's selection?
- Selecting another slot while a card is open: does the editor's pending
  text reach its card before the bench draws the next one?

**Kill criterion.** If the bench's editor cannot take and give back focus
without a key reaching the wrong place, or text typed just before a
selection change is lost, the bench opens as a layer of its own and the
ADR changes before a plan.

**Throw away.** A branch of `packages/web/inventory-panel.tsx` drawing
`DrawCard` at `whole` in the preview's place on Enter, driven by the
browser suite's page helpers in a disposable scenario.

**Answers.** Run against a host from `pnpm dev` on an empty project, in the
lane's headless Chromium 156 (Linux keys: Ctrl for Cmd), with the
throwaway bench: `CardGrid` given `open={false}` and no open card, and the
panel drawing the selected card in the preview's place, `whole` while
open, with its own Escape and click handlers. Eight text cards and a
reference held. The bench was reverted after the run.

1. **The grid's keys never reach the bench.** With the bench showing a
   card normal, arrows and `hjkl` moved the selection and the bench
   followed, focus staying on the slot. The normal card takes no focus.
2. **Enter has to put focus in the bench itself.** Opened, the bench's
   first focusable element was the card frame's header, not its box, so
   text typed after Enter went nowhere; focusing the `textarea` first
   put the caret there. With focus in the box, arrows and `h`, `j` moved
   the caret and typed, and the selection stayed on its slot.
   **Today's open card does not take focus at all**: after Enter, focus
   stays on the slot and a click on the box is needed.
3. **A reference or a thread has no box.** Opened on the bench, it drew
   whole (Edit as text) and focus stayed on the slot, whose Escape no
   longer folded it, since the grid's Escape folds only its own open
   card. So the open state is one, read by both: Escape folds from the
   bench or the bag, and Enter on a kind with no box focuses its first
   control.
4. **Undo stays where it belongs.** Ctrl+Z in the bench's box undid only
   the text typed there; Escape put focus back on the selected slot;
   there Alt+→ swapped two cards and Ctrl+Z swapped them back (the tab's
   own stack, `inPanel` true because the bench is inside `.inventory`).
5. **A click on the bench must not open it when it ends a text
   selection.** A drag across the normal card's text fired `click` on the
   bench and opened it, losing the selection. Opening only on a click
   whose selection is collapsed kept the drag a selection, and a plain
   click still opened it, caret in the box.
6. **Nothing typed is lost on a switch.** Typing " WW" and clicking
   another slot at once: the first slot's face showed it 300 ms later,
   and after a reload.

**Today**, the open card laid over the grid covers its neighbours: a
click on the slot beside it is intercepted by the open card's box, so
another slot cannot be clicked until Escape.

The kill criterion did not hold: the bench opens in its own box.
