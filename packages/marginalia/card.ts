// card — a card's record and where it sits (ADR-0048).
//
// A card is live text in a place. Its text is its own `TextDoc` and its record
// is in the cards document (`CardsDoc` in @pineta/schema), both written by
// clients; the host writes only to take a queued card, to write back one it
// could not send, and to sweep empty ones when it starts.
// This module decodes the record, and decides where a card sits now, which
// queued card is taken next, and which are swept. Who wrote in it is
// `writersOf` (`seat.ts`).

import {
  atEntry,
  CARD_COMMANDS,
  type CardCommand,
  type CardId,
  type CardPlace,
  type CardRecord,
  cardId,
  type EntryId,
  entryId,
  isLaneName,
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
 * drafting or queued card's `at` is always an entry: a thread's end is never
 * the root. The fields after `column` came later, so a record stored before
 * them lacks them, and they read as "".
 */
const StoredCard = Type.Object({
  owner: Type.String({ minLength: 1 }),
  kind: Type.Union([
    Type.Literal("drafting"),
    Type.Literal("queued"),
    Type.Literal("fresh"),
  ]),
  at: Type.String(),
  lane: Type.String(),
  column: Type.String(),
  order: Type.Optional(Type.String()),
  by: Type.Optional(Type.String()),
  seen: Type.Optional(Type.String()),
  command: Type.Optional(Type.String()),
  unsent: Type.Optional(Type.String()),
})

/** The flat value the cards document stores under a card's id. */
export interface StoredCardFields {
  readonly owner: string
  readonly kind: CardPlace["kind"]
  readonly at: string
  readonly lane: string
  readonly column: string
  readonly order: string
  readonly by: string
  readonly seen: string
  readonly command: string
  readonly unsent: string
}

const entryOrEmpty = (at: Position): string => (at.kind === "root" ? "" : at.id)

/** A card record -> the flat value the cards document stores under its id. */
export function encodeCard({
  owner,
  place,
  command,
  unsent,
}: CardRecord): StoredCardFields {
  const rest = { owner, command: command ?? "", unsent: unsent ?? "" }
  switch (place.kind) {
    case "drafting":
      return {
        ...rest,
        kind: "drafting",
        at: entryOrEmpty(place.at),
        lane: place.lane ?? "",
        column: "",
        order: "",
        by: "",
        seen: "",
      }
    case "queued":
      return {
        ...rest,
        kind: "queued",
        at: entryOrEmpty(place.at),
        lane: place.lane,
        column: "",
        order: place.order,
        by: place.by,
        seen: place.seen,
      }
    case "fresh":
      return {
        ...rest,
        kind: "fresh",
        at: "",
        lane: "",
        column: place.column,
        order: "",
        by: "",
        seen: "",
      }
  }
}

const isCommand = (s: string): s is CardCommand =>
  (CARD_COMMANDS as readonly string[]).includes(s)

/**
 * A stored card -> its record; undefined for one that is malformed, a
 * command this build does not know among them. Total. A drafting card's
 * lane that is not a thread's is dropped and the card kept: the startup
 * sweep deletes the text of a card that does not decode (`planCardSweep`).
 * A queued card needs its lane, so one with such a lane does not decode.
 */
export const decodeCard = (
  id: string,
  value: unknown,
): CardRecord | undefined =>
  decodeWith(StoredCard, value, c => {
    const order = c.order ?? ""
    const by = c.by ?? ""
    const command = c.command ?? ""
    const place: CardPlace | undefined =
      c.kind === "fresh"
        ? c.column === ""
          ? undefined
          : { kind: "fresh", column: c.column }
        : c.at === ""
          ? undefined
          : c.kind === "drafting"
            ? {
                kind: "drafting",
                at: atEntry(entryId(c.at)),
                lane: isLaneName(c.lane) ? c.lane : null,
              }
            : !isLaneName(c.lane) || order === "" || by === ""
              ? undefined
              : {
                  kind: "queued",
                  at: atEntry(entryId(c.at)),
                  lane: c.lane,
                  order,
                  by: by as WriterId,
                  seen: c.seen ?? "",
                }
    if (place === undefined) return undefined
    if (command !== "" && !isCommand(command)) return undefined
    return {
      id: cardId(id),
      owner: c.owner as WriterId,
      place,
      command: command === "" ? null : command,
      unsent: (c.unsent ?? "") === "" ? null : (c.unsent ?? null),
    }
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
): EntryId | null {
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

/**
 * A drafting card's thread end now; null for a queued or fresh card, or a
 * place gone.
 */
export const cardEnd = (
  card: CardRecord,
  lanes: readonly LaneView[],
  index: TreeIndex,
): EntryId | null =>
  card.place.kind === "drafting"
    ? placeEnd(card.place, card.owner, lanes, index)
    : null

/** Every drafting card whose thread ends at `end`, everyone's, oldest first. */
export const draftingAt = (
  end: EntryId,
  cards: readonly CardRecord[],
  lanes: readonly LaneView[],
  index: TreeIndex,
): readonly CardRecord[] => cards.filter(c => cardEnd(c, lanes, index) === end)

/** Where a column's composer is: a thread's end, or a fresh column by its key. */
export type CardWhere =
  | { readonly kind: "end"; readonly end: EntryId }
  | { readonly kind: "fresh"; readonly column: string }

/**
 * Your own card where a column's composer is; never another writer's. Of
 * several at one end, the newest (ids are uuidv7): a card of yours that
 * someone unqueued comes back below the line, and must not take the
 * composer from the one you are typing in.
 */
export function yourCard(
  me: WriterId,
  where: CardWhere,
  cards: readonly CardRecord[],
  lanes: readonly LaneView[],
  index: TreeIndex,
): CardRecord | undefined {
  let found: CardRecord | undefined
  for (const c of cards) {
    if (c.owner !== me) continue
    const here =
      where.kind === "end"
        ? cardEnd(c, lanes, index) === where.end
        : c.place.kind === "fresh" && c.place.column === where.column
    if (here && (found === undefined || c.id > found.id)) found = c
  }
  return found
}

// ── the queue (ADR-0048 step 3, S69) ──────────────────────────────────────

/** A queued card, with its place narrowed. */
export type QueuedCard = CardRecord & {
  readonly place: Extract<CardPlace, { kind: "queued" }>
}

const isQueued = (c: CardRecord): c is QueuedCard => c.place.kind === "queued"

/** A lane's queued cards, in the order they are taken: by `order`, then id. */
export function queuedOn(
  cards: readonly CardRecord[],
  lane: LaneName,
): QueuedCard[] {
  return cards
    .filter(isQueued)
    .filter(c => c.place.lane === lane)
    .sort((a, b) =>
      a.place.order !== b.place.order
        ? a.place.order < b.place.order
          ? -1
          : 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
    )
}

/**
 * Order keys are fixed-width base-36 integers, so string order is numeric
 * order. The first starts in the middle, and each next one a step on, which
 * leaves room before and between for reordering.
 */
const ORDER_WIDTH = 10
const ORDER_START = 36 ** ORDER_WIDTH / 2
const ORDER_STEP = 2 ** 20

const orderKey = (n: number): string =>
  Math.min(Math.max(0, n), 36 ** ORDER_WIDTH - 1)
    .toString(36)
    .padStart(ORDER_WIDTH, "0")

/** An order key after every card in `queue`. */
export function orderAfter(queue: readonly QueuedCard[]): string {
  const last = queue
    .map(c => Number.parseInt(c.place.order, 36))
    .filter(n => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY)
  return orderKey(
    last === Number.NEGATIVE_INFINITY ? ORDER_START : last + ORDER_STEP,
  )
}

/**
 * The fields a client writes to queue a card: its place becomes queued, and
 * `unsent` is cleared. Written field by field, never the whole record (S58).
 */
export const queueFields = (queue: {
  readonly at: Position
  readonly lane: LaneName
  readonly by: WriterId
  readonly order: string
  readonly seen: string
}): Pick<
  StoredCardFields,
  "kind" | "at" | "lane" | "order" | "by" | "seen" | "unsent"
> => ({
  kind: "queued",
  at: entryOrEmpty(queue.at),
  lane: queue.lane,
  order: queue.order,
  by: queue.by,
  seen: queue.seen,
  unsent: "",
})

/**
 * The fields a client writes to unqueue a card: only its kind. Its `at` and
 * `lane` are where it was queued, so it goes back there, below the line.
 */
export const unqueueFields = (): Pick<StoredCardFields, "kind"> => ({
  kind: "drafting",
})

/** What an idle lane's queue gives up next. */
export type TakeStep =
  | { readonly kind: "idle" }
  | { readonly kind: "take"; readonly card: QueuedCard }

/** The next card to take for a lane: none while it runs, else its top one. Pure. */
export function planTake(
  cards: readonly CardRecord[],
  lane: LaneName,
  running: boolean,
): TakeStep {
  if (running) return { kind: "idle" }
  const top = queuedOn(cards, lane)[0]
  return top === undefined ? { kind: "idle" } : { kind: "take", card: top }
}

/**
 * A taken card the host could not send, as the whole record it writes back:
 * drafting where it was queued, saying why. Never queued again, or the next
 * drain would take it and fail the same way (S69, answer 5).
 */
export const planUnsent = (
  card: QueuedCard,
  reason: string,
): StoredCardFields =>
  encodeCard({
    id: card.id,
    owner: card.owner,
    place: { kind: "drafting", at: card.place.at, lane: card.place.lane },
    command: card.command,
    unsent: reason,
  })

/**
 * What a starting host deletes: records whose text is empty and that carry
 * no command, and stored `card:` documents with no record. Pure.
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
    .filter(c => c.command === null && (input.texts.get(c.id) ?? "") === "")
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
