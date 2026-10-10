// margin — the cards beside an entry (ADR-0126): comments on it, shared by
// everyone in its task and never read by the agent. A margin names its
// entry and the entry's thread, so its task is found without a tree.

import {
  type CardInPlace,
  type CardPlace,
  type CardRecord,
  type EntryId,
  hasPlaceKind,
  type ThreadId,
} from "@pinetrie/core"
import { byOrder } from "./card.ts"
import { orderAfter } from "./order.ts"

/** A card in an entry's margin, with its place narrowed. */
export type MarginCard = CardInPlace<"margin">

/** The cards in `entry`'s margin, in order: by `order`, then id. */
export const marginCards = (
  cards: readonly CardRecord[],
  entry: EntryId,
): readonly MarginCard[] =>
  cards
    .filter(
      (c): c is MarginCard =>
        hasPlaceKind(c, "margin") && c.place.entry === entry,
    )
    .sort(byOrder)

/** A comment at the end of `entry`'s margin, in `thread`. */
export const marginEnd = (
  cards: readonly CardRecord[],
  entry: EntryId,
  thread: ThreadId,
): Extract<CardPlace, { kind: "margin" }> => ({
  kind: "margin",
  entry,
  thread,
  order: orderAfter(marginCards(cards, entry)),
})

/** How many cards are in each entry's margin, by entry: the faces a column draws. */
export function marginCounts(
  cards: readonly CardRecord[],
): ReadonlyMap<EntryId, number> {
  const counts = new Map<EntryId, number>()
  for (const c of cards)
    if (hasPlaceKind(c, "margin"))
      counts.set(c.place.entry, (counts.get(c.place.entry) ?? 0) + 1)
  return counts
}
