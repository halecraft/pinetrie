// host/places — the one writer of the places document (ADR-0059).
//
// Every write to a card's place goes through `applyPlaceSteps`, which writes
// its records in one batch, then raises `rev` in a batch of its own. A client
// draws a move it sent until its copy of the document reaches the `rev` the
// host answered with, so a write that skipped `rev` would leave a client
// drawing a move over a record that has already changed. `rev` stays out of
// the records' batch because that batch may be an undo step: a `rev` raised
// inside it changes with every later write, so every whole undo of the step
// would be refused (S82).

import { batch } from "@kyneta/schema"
import { encodeCard, type PlaceStep } from "@pineta/rules"
import type { PlacesDocHandle } from "@pineta/schema"

/** Run a write as one step of an undo stack (`MoveHistories.gesture`). */
export type Gesture = <T>(write: () => T) => T

/**
 * Carry out `steps` on the places document, inside `gesture` when one is
 * given, and return its `rev` after: raised once, or unchanged for no
 * steps. Synchronous, so the take reads a card and removes it with nothing
 * between. A removed card's text is its caller's to destroy, after this:
 * record first, then text (S64).
 */
export function applyPlaceSteps(
  places: PlacesDocHandle,
  steps: readonly PlaceStep[],
  gesture?: Gesture,
): number {
  if (steps.length === 0) return places.rev()
  const write = () =>
    batch(places, d => {
      for (const step of steps)
        if (step.kind === "write")
          d.cards.set(step.record.id, encodeCard(step.record))
        else d.cards.delete(step.id)
    })
  if (gesture === undefined) write()
  else gesture(write)
  return raiseRev(places)
}

/**
 * Raise `rev` in a batch of its own, and return it: after `applyPlaceSteps`'
 * records, or after an undo's revert, which Kyneta writes itself.
 */
export function raiseRev(places: PlacesDocHandle): number {
  const rev = places.rev() + 1
  batch(places, d => d.rev.set(rev))
  return rev
}
