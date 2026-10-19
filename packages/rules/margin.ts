// margin — the cards beside an entry or an image: comments on it, shared by
// everyone in its canvas and never read by the agent.

import {
  type CardInPlace,
  type CardPlace,
  type CardRecord,
  type EntryId,
  hasPlaceKind,
  type MarginOn,
  printAddress,
  sameMarginOn,
} from "@pinetrie/core"
import { byOrder } from "./card.ts"
import { orderAfter } from "./order.ts"

/** A card in a margin, with its place narrowed. */
export type MarginCard = CardInPlace<"margin">

/** The cards in `on`'s margin, in order: by `order`, then id. */
export const marginCards = (
  cards: readonly CardRecord[],
  on: MarginOn,
): readonly MarginCard[] =>
  cards
    .filter(
      (c): c is MarginCard =>
        hasPlaceKind(c, "margin") && sameMarginOn(c.place.on, on),
    )
    .sort(byOrder)

/** A comment at the end of `on`'s margin, written on the image's version `seen`. */
export const marginEnd = (
  cards: readonly CardRecord[],
  on: MarginOn,
  seen: string,
): Extract<CardPlace, { kind: "margin" }> => ({
  kind: "margin",
  on,
  order: orderAfter(marginCards(cards, on)),
  seen,
})

/** How many comments are in each entry's margin, by entry: the counts a thread's column draws. */
export function entryMarginCounts(
  cards: readonly CardRecord[],
): ReadonlyMap<EntryId, number> {
  const counts = new Map<EntryId, number>()
  for (const c of cards)
    if (hasPlaceKind(c, "margin") && c.place.on.kind === "entry") {
      const { entry } = c.place.on
      counts.set(entry, (counts.get(entry) ?? 0) + 1)
    }
  return counts
}

/**
 * How many cards are in each margin, by what it is on, printed
 * (`printAddress`): the counts a column draws.
 */
export function marginCounts(
  cards: readonly CardRecord[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const c of cards)
    if (hasPlaceKind(c, "margin")) {
      const on = printAddress(c.place.on)
      counts.set(on, (counts.get(on) ?? 0) + 1)
    }
  return counts
}
