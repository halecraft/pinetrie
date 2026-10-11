// interface/discardable — whether you may discard a card (ADR-0111): the
// one test a discard, a cut (ADR-0132) and a slot's replacement (ADR-0133)
// all ask. Pure.

import {
  type CardFittingPlace,
  type CardRecord,
  cardFitsPlace,
  isMovable,
  type MovableKind,
  type WriterId,
} from "@pinetrie/core"

/** A card you may discard: a kind ever in a trash that a person moves. */
export type Discardable = Extract<
  CardFittingPlace<"trash">,
  { readonly kind: MovableKind }
>

/**
 * Whether you, `me`, may discard `card`: a kind that may be in a trash
 * (`PLACES_OF`) and that a person moves (a task's card is the host's to
 * trash), not in someone else's inventory (ADR-0059).
 */
export const isDiscardable = (
  card: CardRecord,
  me: WriterId,
): card is Discardable =>
  cardFitsPlace(card, "trash") &&
  isMovable(card) &&
  !(card.place.kind === "inventory" && card.place.holder !== me)
