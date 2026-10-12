// interface/discardable — whether you may discard a card: the one test a
// discard, a cut and a slot's replacement all ask.

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
 * (`PLACES_OF`: a thread, sent or not, and a note column too) and that a
 * person moves (a task's card is the host's to trash), not in a trash
 * already, nor in someone else's inventory.
 */
export const isDiscardable = (
  card: CardRecord,
  me: WriterId,
): card is Discardable =>
  cardFitsPlace(card, "trash") &&
  isMovable(card) &&
  card.place.kind !== "trash" &&
  !(card.place.kind === "inventory" && card.place.holder !== me)
