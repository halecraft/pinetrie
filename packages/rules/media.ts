// media — media columns and the images in them: an image's place at its
// column's end.

import type {
  CardId,
  CardPlace,
  CardRecord,
  ImageCard,
  ImageId,
  MediaId,
} from "@pinetrie/threads"
import { byOrder } from "./card.ts"
import { orderAfter } from "./order.ts"
import { rankAfter } from "./rank.ts"

/** An image, with its place narrowed. */
export type ImageInColumn = ImageCard & {
  readonly place: Extract<CardPlace, { kind: "image" }>
}

const isImageInColumn = (c: CardRecord): c is ImageInColumn =>
  c.kind === "image" && c.place.kind === "image"

/** A media column's images, in order: by `order`, then id. */
export const imagesIn = (
  cards: readonly CardRecord[],
  column: MediaId,
): readonly ImageInColumn[] =>
  cards
    .filter(isImageInColumn)
    .filter(c => c.place.column === column)
    .sort(byOrder)

/**
 * The rank of an image moved or put just before `before` in `column` (at its
 * end for null, or for an image no longer there), the image `card` left out
 * of its neighbours, with the images given new ranks to make room
 * (`rankAfter`).
 */
export function rankInColumn(
  cards: readonly CardRecord[],
  card: CardId,
  column: MediaId,
  before: ImageId | null,
): ReturnType<typeof rankAfter> {
  const here = imagesIn(cards, column).filter(c => c.id !== card)
  const at = before === null ? -1 : here.findIndex(c => c.id === before)
  return rankAfter(here, at < 0 ? here.length - 1 : at - 1)
}

/** An image at the end of `column`. */
export const mediaColumnEnd = (
  cards: readonly CardRecord[],
  column: MediaId,
): Extract<CardPlace, { kind: "image" }> => ({
  kind: "image",
  column,
  order: orderAfter(imagesIn(cards, column)),
})
