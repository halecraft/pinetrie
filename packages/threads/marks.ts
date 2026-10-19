// threads/marks — titles: what a canvas's or a titled card's typed title asks
// for.

import type { CanvasId } from "@pinetrie/core"
import type { CardId, IdOf } from "./card-ids.ts"
import { kindOfCard } from "./card-ids.ts"
import { isTitledKind, type TitledKind } from "./kinds.ts"

/** A card with a title of its own: a note column, a media column or an image. */
export type TitledCardId = IdOf<TitledKind>

/** Whether `card` has a title of its own (`KINDS`' `titled`). */
export const isTitledCardId = (card: CardId): card is TitledCardId =>
  isTitledKind(kindOfCard(card))

/** What a title names: a canvas, or a titled card. */
export type MarkTarget =
  | { readonly kind: "canvas"; readonly canvas: CanvasId }
  | { readonly kind: "card"; readonly card: TitledCardId }

/** A title's longest form, in UTF-16 code units. */
export const MAX_TITLE = 80

/** What a typed title asks for. */
type TitleInput =
  | { readonly kind: "set"; readonly title: string }
  | { readonly kind: "clear" }
  | { readonly kind: "invalid" }

/**
 * A title as typed, trimmed: empty clears it; a line break, or more than
 * `MAX_TITLE`, is invalid. The codec and the page both decide by this, so
 * they accept the same titles.
 */
export function parseTitle(text: string): TitleInput {
  const title = text.trim()
  if (title === "") return { kind: "clear" }
  return /[\r\n]/.test(title) || title.length > MAX_TITLE
    ? { kind: "invalid" }
    : { kind: "set", title }
}
