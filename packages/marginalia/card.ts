// card — a card's record and where it sits (ADR-0048).
//
// A card is live text in a place. Its text is its own `TextDoc` and its record
// is in the cards document (`CardsDoc` in @pineta/schema), both written by
// clients; the host writes only to spend a card, when it becomes a message,
// and to sweep empty ones when it starts.
// This module decodes the record, and decides where a card sits now and when
// one is spent or swept. Who wrote in it is `writersOf` (`seat.ts`).

import {
  atEntry,
  type CardId,
  type CardPlace,
  type CardRecord,
  cardId,
  entryId,
  type LaneName,
  type LaneView,
  type Position,
  type TreeIndex,
  threadOf,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"

/**
 * A card as the cards document stores it: flat strings, "" for none. A
 * drafting card's `at` is always an entry: a thread's end is never the root.
 */
const StoredCard = Type.Object({
  owner: Type.String({ minLength: 1 }),
  kind: Type.Union([Type.Literal("drafting"), Type.Literal("fresh")]),
  at: Type.String(),
  lane: Type.String(),
  column: Type.String(),
})

/** A card record -> the flat value the cards document stores under its id. */
export const encodeCard = ({ owner, place }: CardRecord) =>
  place.kind === "drafting"
    ? {
        owner,
        kind: "drafting",
        at: place.at.kind === "root" ? "" : place.at.id,
        lane: place.lane ?? "",
        column: "",
      }
    : { owner, kind: "fresh", at: "", lane: "", column: place.column }

/** A stored card -> its record; undefined for one that is malformed. Total. */
export const decodeCard = (
  id: string,
  value: unknown,
): CardRecord | undefined =>
  decodeWith(StoredCard, value, c => {
    const place: CardPlace | undefined =
      c.kind === "drafting"
        ? c.at === ""
          ? undefined
          : {
              kind: "drafting",
              at: atEntry(entryId(c.at)),
              lane: c.lane === "" ? null : (c.lane as LaneName),
            }
        : c.column === ""
          ? undefined
          : { kind: "fresh", column: c.column }
    return place === undefined
      ? undefined
      : { id: cardId(id), owner: c.owner as WriterId, place }
  })

/**
 * Where a place kept as a send carries it (where it started, and its column's
 * lane) resolves now: the end of its thread, as a reply from there would find
 * it, so it follows its thread as the thread grows. Null when there is no
 * such thread, or two.
 */
export function placeEnd(
  place: { readonly at: Position; readonly lane: LaneName | null },
  me: WriterId,
  lanes: readonly LaneView[],
  index: TreeIndex,
): string | null {
  const thread = threadOf(index, lanes, {
    at: place.at,
    mode: "reply",
    lane: place.lane,
    me,
  })
  return thread.kind === "thread" && thread.end.kind === "entry"
    ? thread.end.id
    : null
}

/** A drafting card's thread end now; null for a fresh card, or a place gone. */
export const cardEnd = (
  card: CardRecord,
  lanes: readonly LaneView[],
  index: TreeIndex,
): string | null =>
  card.place.kind === "drafting"
    ? placeEnd(card.place, card.owner, lanes, index)
    : null

/** Every drafting card whose thread ends at `end`, everyone's, oldest first. */
export const draftingAt = (
  end: string,
  cards: readonly CardRecord[],
  lanes: readonly LaneView[],
  index: TreeIndex,
): readonly CardRecord[] => cards.filter(c => cardEnd(c, lanes, index) === end)

/** Where a column's composer is: a thread's end, or a fresh column by its key. */
export type CardWhere =
  | { readonly kind: "end"; readonly end: string }
  | { readonly kind: "fresh"; readonly column: string }

/** Your own card where a column's composer is; never another writer's. */
export function yourCard(
  me: WriterId,
  where: CardWhere,
  cards: readonly CardRecord[],
  lanes: readonly LaneView[],
  index: TreeIndex,
): CardRecord | undefined {
  return cards.find(
    c =>
      c.owner === me &&
      (where.kind === "end"
        ? cardEnd(c, lanes, index) === where.end
        : c.place.kind === "fresh" && c.place.column === where.column),
  )
}

/**
 * Whether a send's outcome spent its card: written, running or waiting, the
 * message is the card's now. On a conflict or a refusal nothing was sent.
 */
export const spends = (outcome: { readonly kind: string }): boolean =>
  outcome.kind === "appended" ||
  outcome.kind === "started" ||
  outcome.kind === "queued"

/**
 * What a starting host deletes: records whose text is empty, and stored
 * `card:` documents with no record. Pure.
 */
export function planCardSweep(input: {
  readonly cards: readonly CardRecord[]
  /** Each card's text, by id; a card with no text gathered is empty. */
  readonly texts: ReadonlyMap<CardId, string>
  /** Every stored `card:` document id. */
  readonly stored: readonly string[]
  readonly cardOfDoc: (docId: string) => CardId | undefined
}): { readonly records: CardId[]; readonly docs: string[] } {
  const records = input.cards
    .filter(c => (input.texts.get(c.id) ?? "") === "")
    .map(c => c.id)
  const live = new Set<string>(
    input.cards.map(c => c.id).filter(id => !records.includes(id)),
  )
  const docs = input.stored.filter(docId => {
    const id = input.cardOfDoc(docId)
    return id !== undefined && !live.has(id)
  })
  return { records, docs }
}
