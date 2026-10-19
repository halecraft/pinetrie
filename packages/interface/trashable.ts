// interface/trashable — whether you may trash a card: the one test a
// trash, a cut and a slot's replacement all ask.

import type { WriterId } from "@pinetrie/core"
import {
  type CardFittingPlace,
  type CardRecord,
  cardFitsPlace,
  isMovable,
  type MovableKind,
} from "@pinetrie/threads"

/** A card you may trash: a kind ever in a trash that a person moves. */
export type Trashable = Extract<
  CardFittingPlace<"trash">,
  { readonly kind: MovableKind }
>

/**
 * Whether you, `me`, may trash `card`: a kind that may be in a trash
 * (`PLACES_OF`: a thread, sent or not, and a note column too) and that a
 * person moves (a canvas's card is the host's to trash), not in a trash
 * already, nor in someone else's inventory.
 */
export const isTrashable = (
  card: CardRecord,
  me: WriterId,
): card is Trashable =>
  cardFitsPlace(card, "trash") &&
  isMovable(card) &&
  card.place.kind !== "trash" &&
  !(card.place.kind === "inventory" && card.place.holder !== me)
