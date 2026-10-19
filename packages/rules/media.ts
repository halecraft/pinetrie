// media — media columns and the images in them: an image's place at its
// column's end.

import type { CardPlace, CardRecord, ImageCard, MediaId } from "@pinetrie/core"
import { byOrder } from "./card.ts"
import { orderAfter } from "./order.ts"

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

/** An image at the end of `column`. */
export const mediaColumnEnd = (
  cards: readonly CardRecord[],
  column: MediaId,
): Extract<CardPlace, { kind: "image" }> => ({
  kind: "image",
  column,
  order: orderAfter(imagesIn(cards, column)),
})
