// card — a card's record and where it sits (ADR-0048, ADR-0059).
//
// A card is live text in a place. Its text is its own `TextDoc`, written by
// clients; its record is in the places document (`PlacesDoc` in
// @pinetrie/schema), which only the host writes, through handoffs it applies
// or refuses (`planMove`). This module decodes a record, and decides where a
// card sits now, which moves and reorders the host accepts, which queued
// card is popped next to be sent, and which are swept. Who wrote in it is `writersOfClients`
// (`seat.ts`).

import {
  asPlaceFields,
  CARD_COMMANDS,
  type CardCommand,
  type CardId,
  type CardPlace,
  type CardRecord,
  type EntryId,
  isTextCard,
  kindOfCard,
  NO_CONTENT,
  type OrderedPlace,
  parseCardId,
  placed,
  placeFields,
  placeOfFields,
  type TextCard,
  type ThreadId,
  type TreeIndex,
  threadEnd,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"
import { decodeQueuedFact, encodeQueuedFact } from "./fact.ts"
import { decodeStoredRelay, encodeRelay } from "./relay.ts"

/**
 * A card as the places document stores it: flat strings, "" for none. The
 * host writes a record whole, so every field is there.
 */
const StoredCard = Type.Object({
  owner: Type.String({ minLength: 1 }),
  kind: Type.String(),
  root: Type.String(),
  at: Type.String(),
  lane: Type.String(),
  column: Type.String(),
  order: Type.String(),
  by: Type.String(),
  seen: Type.String(),
  command: Type.String(),
  /** A fact the card carries (ADR-0080), as JSON; absent before facts were. */
  fact: Type.Optional(Type.String()),
  unsent: Type.String(),
  placer: Type.String({ minLength: 1 }),
  holder: Type.String(),
  /** A canvas, fresh or gone card's task (ADR-0116); absent before tasks. */
  task: Type.Optional(Type.String()),
  /** A canvas card's width; absent before tasks. */
  width: Type.Optional(Type.String()),
})

/** The flat value the places document stores under a card's id. */
interface StoredCardFields {
  readonly owner: string
  readonly kind: string
  readonly root: string
  readonly at: string
  readonly lane: string
  readonly column: string
  readonly order: string
  readonly by: string
  readonly seen: string
  readonly command: string
  readonly fact: string
  readonly unsent: string
  readonly placer: string
  readonly holder: string
  readonly task: string
  readonly width: string
}

/**
 * A card record -> the flat value the places document stores under its id:
 * its place's fields, and its content's. A text card's command and reason
 * unsent, a fact card's fact, an ask card's relay (ADR-0128), both as JSON
 * in `fact`; a thread's card and a note column hold none.
 */
export const encodeCard = (card: CardRecord): StoredCardFields => ({
  owner: card.owner,
  ...placeFields(card.place),
  command: card.kind === "text" ? (card.content.command ?? "") : "",
  fact:
    card.kind === "fact"
      ? encodeQueuedFact(card.content.fact)
      : card.kind === "ask"
        ? encodeRelay(card.content.relay)
        : "",
  unsent: card.kind === "text" ? (card.content.unsent ?? "") : "",
  placer: card.placer,
})

const isCommand = (s: string): s is CardCommand =>
  (CARD_COMMANDS as readonly string[]).includes(s)

/**
 * A stored card -> its record, of the kind its id says (`kindOfCard`);
 * undefined for one that is malformed, in a place its kind is never in
 * (`placed`), with a command this build does not know, with content its kind
 * does not hold (a fact on a text card, a command on a fact), or of a kind
 * this build holds no records of yet. Total. Where it is is read by core's
 * `placeOfFields`, as a move's key on the wire is by `keyOfFields`.
 */
export const decodeCard = (
  id: string,
  value: unknown,
): CardRecord | undefined =>
  decodeWith(StoredCard, value, c => {
    const place = placeOfFields(asPlaceFields(c))
    const card = parseCardId(id)
    if (place === undefined || card === undefined) return undefined
    const owner = c.owner as WriterId
    const placer = c.placer as WriterId
    const fact = c.fact ?? ""
    const record = ((): CardRecord | undefined => {
      const kind = kindOfCard(card)
      switch (kind) {
        case "thread":
        case "note-column":
          return c.command !== "" || fact !== ""
            ? undefined
            : ({
                kind,
                id: card,
                owner,
                placer,
                place,
                content: NO_CONTENT,
              } as CardRecord)
        case "fact": {
          const decoded = c.command === "" ? decodeQueuedFact(fact) : undefined
          return decoded === undefined
            ? undefined
            : ({
                kind,
                id: card,
                owner,
                placer,
                place,
                content: { fact: decoded },
              } as CardRecord)
        }
        case "ask": {
          const relay = c.command === "" ? decodeStoredRelay(fact) : undefined
          return relay === undefined
            ? undefined
            : ({
                kind,
                id: card,
                owner,
                placer,
                place,
                content: { relay },
              } as CardRecord)
        }
        case "text":
          return fact !== "" || (c.command !== "" && !isCommand(c.command))
            ? undefined
            : ({
                kind,
                id: card,
                owner,
                placer,
                place,
                content: {
                  command: c.command === "" ? null : (c.command as CardCommand),
                  unsent: c.unsent === "" ? null : c.unsent,
                },
              } as CardRecord)
        case "media":
        case "file":
          return undefined
      }
    })()
    // Built with its place unchecked above; `placed` refuses a place its
    // kind is never in.
    return record === undefined ? undefined : placed(record, place)
  })

/**
 * Where a place at a thread resolves now: its thread's end (`threadEnd`), so
 * it follows its thread as the thread grows. Null when the thread has no
 * entry this index holds.
 */
export const placeEnd = (
  place: { readonly thread: ThreadId },
  index: TreeIndex,
): EntryId | null => threadEnd(index, place.thread)

/**
 * Your message's thread end now (ADR-0113); null for any other card, or a
 * place gone. A pinned card's end is `cardsAt`'s alone: resolved here, it
 * could take your composer (`yourCard`).
 */
export const cardEnd = (card: CardRecord, index: TreeIndex): EntryId | null =>
  card.place.kind === "composing" ? placeEnd(card.place, index) : null

/**
 * Everyone's pinned cards whose thread ends at `end`: by `order`, then by
 * id, so oldest first. The one way a pinned card's end is resolved:
 * `cardEnd` stays your message's alone, so none is ever bound to a composer
 * (`yourCard`).
 */
export function pinnedAt(
  end: EntryId,
  cards: readonly CardRecord[],
  index: TreeIndex,
): readonly TextCard[] {
  return cards
    .filter(isTextCard)
    .filter(c => c.place.kind === "pinned" && placeEnd(c.place, index) === end)
    .sort(byOrder)
}

/** Whether `place` has a rank among its neighbours. */
export const isOrdered = (place: CardPlace): place is OrderedPlace =>
  "order" in place

/** The order of a place that has one, else "". */
export const orderOf = (c: CardRecord): string =>
  isOrdered(c.place) ? c.place.order : ""

/** By `order`, then by id (S69). */
export const byOrder = (a: CardRecord, b: CardRecord): number => {
  const [x, y] = [orderOf(a), orderOf(b)]
  if (x !== y) return x < y ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Where a column's composer is: a thread's end, or a fresh column by its key. */
type CardWhere =
  | { readonly kind: "end"; readonly end: EntryId }
  | { readonly kind: "fresh"; readonly column: string }

/**
 * Your message where a column's composer is (ADR-0113); never another
 * writer's, and never a note. Of several at one end, the newest (ids are
 * uuidv7).
 */
export function yourCard(
  me: WriterId,
  where: CardWhere,
  cards: readonly CardRecord[],
  index: TreeIndex,
): TextCard | undefined {
  let found: TextCard | undefined
  for (const c of cards.filter(isTextCard)) {
    if (c.owner !== me) continue
    const here =
      where.kind === "end"
        ? cardEnd(c, index) === where.end
        : c.place.kind === "fresh" && c.place.column === where.column
    if (here && (found === undefined || c.id > found.id)) found = c
  }
  return found
}

/**
 * What a starting host deletes: text cards whose text is empty and that
 * carry no command, and stored `card:` documents with no record. Only a
 * text card's words are a document (`KINDS`' `text`), so no other kind is
 * swept for its lack of one. Pure.
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
    .filter(isTextCard)
    .filter(
      c => c.content.command === null && (input.texts.get(c.id) ?? "") === "",
    )
    .map(c => c.id)
  const live = new Set<string>(
    input.cards.map(c => c.id).filter(id => !records.some(r => r === id)),
  )
  const docs = input.stored.filter(docId => {
    const id = input.cardOfDoc(docId)
    return id !== undefined && !live.has(id)
  })
  return { records, docs }
}
