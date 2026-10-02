// host/places — the one writer of the places document (ADR-0059).
//
// Every write to a card's place goes through `applyPlaceStep`, which raises
// `rev` in the same batch. A client draws a move it sent until its copy of
// the document reaches the `rev` the host answered with, so a write that
// skipped `rev` would leave a client drawing a move over a record that has
// already changed.

import { batch } from "@kyneta/schema"
import { encodeCard, type PlaceStep } from "@pineta/marginalia"
import type { PlacesDocHandle } from "@pineta/schema"

/**
 * Carry out one step on the places document, and return its `rev` after.
 * Synchronous, so the take reads a card and removes it with nothing between.
 * A removed card's text is its caller's to destroy, after this: record
 * first, then text (S64).
 */
export function applyPlaceStep(
  places: PlacesDocHandle,
  step: PlaceStep,
): number {
  const rev = places.rev() + 1
  batch(places, d => {
    if (step.kind === "write")
      d.cards.set(step.record.id, encodeCard(step.record))
    else d.cards.delete(step.id)
    d.rev.set(rev)
  })
  return rev
}
