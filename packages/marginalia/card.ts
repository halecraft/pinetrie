// card — a card's record and where it sits (ADR-0048, ADR-0059).
//
// A card is live text in a place. Its text is its own `TextDoc`, written by
// clients; its record is in the places document (`PlacesDoc` in
// @pineta/schema), which only the host writes, through handoffs it applies
// or refuses (`planMove`). This module decodes a record, and decides where a
// card sits now, which moves the host accepts, which queued card is taken
// next, and which are swept. Who wrote in it is `writersOf` (`seat.ts`).

import {
  CARD_COMMANDS,
  type CardCommand,
  type CardId,
  type CardPlace,
  type CardRecord,
  cardId,
  type EntryId,
  keyOf,
  type LaneName,
  type LaneView,
  type Move,
  type MoveRefusal,
  type PlaceKey,
  type Position,
  placeFields,
  placeOfFields,
  sameKey,
  type TreeIndex,
  threadOf,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"

/**
 * A card as the places document stores it: flat strings, "" for none. The
 * host writes a record whole, so every field is there.
 */
const StoredCard = Type.Object({
  owner: Type.String({ minLength: 1 }),
  kind: Type.String(),
  at: Type.String(),
  lane: Type.String(),
  column: Type.String(),
  order: Type.String(),
  by: Type.String(),
  seen: Type.String(),
  command: Type.String(),
  unsent: Type.String(),
  placer: Type.String({ minLength: 1 }),
})

/** The flat value the places document stores under a card's id. */
export interface StoredCardFields {
  readonly owner: string
  readonly kind: string
  readonly at: string
  readonly lane: string
  readonly column: string
  readonly order: string
  readonly by: string
  readonly seen: string
  readonly command: string
  readonly unsent: string
  readonly placer: string
}

/** A card record -> the flat value the places document stores under its id. */
export const encodeCard = ({
  owner,
  place,
  placer,
  command,
  unsent,
}: CardRecord): StoredCardFields => ({
  owner,
  ...placeFields(place),
  command: command ?? "",
  unsent: unsent ?? "",
  placer,
})

const isCommand = (s: string): s is CardCommand =>
  (CARD_COMMANDS as readonly string[]).includes(s)

/**
 * A stored card -> its record; undefined for one that is malformed, a
 * command this build does not know among them. Total. Where it is is read by
 * core's `placeOfFields`, as a move's key on the wire is by `keyOfFields`.
 */
export const decodeCard = (
  id: string,
  value: unknown,
): CardRecord | undefined =>
  decodeWith(StoredCard, value, c => {
    const place = placeOfFields(c)
    if (place === undefined) return undefined
    const { command } = c
    if (command !== "" && !isCommand(command)) return undefined
    return {
      id: cardId(id),
      owner: c.owner as WriterId,
      place,
      placer: c.placer as WriterId,
      command: command === "" ? null : command,
      unsent: c.unsent === "" ? null : c.unsent,
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
 * A taken card the host could not send, written back: drafting where it was
 * queued, saying why, its command and placer kept, since the host's own
 * write is nobody's move. Never queued again, or the next drain would take
 * it and fail the same way (S69, answer 5).
 */
export const planUnsent = (card: QueuedCard, reason: string): PlaceStep => ({
  kind: "write",
  record: {
    ...card,
    place: { kind: "drafting", at: card.place.at, lane: card.place.lane },
    unsent: reason,
  },
})

// ── handoffs (ADR-0059) ───────────────────────────────────────────────────

/** A write to the places document, as the host's one writer carries it out. */
export type PlaceStep =
  | { readonly kind: "write"; readonly record: CardRecord }
  | { readonly kind: "remove"; readonly id: CardId }

/** What the host makes of a move: a step to carry out, or a refusal. */
export type MoveStep =
  | PlaceStep
  | {
      readonly kind: "refused"
      readonly code: MoveRefusal
      /** The card as it is, or null when it is gone. */
      readonly now: CardRecord | null
    }

/** A key as the place it becomes, with what the host assigns to a queued one. */
function placeAt(
  key: PlaceKey,
  cards: readonly CardRecord[],
  sender: WriterId,
): CardPlace {
  return key.kind === "queued"
    ? { ...key, order: orderAfter(queuedOn(cards, key.lane)), by: sender }
    : key
}

/**
 * A handoff: a compare-and-set on where the card is. The host accepts a move
 * only if the card is still where its sender saw it; a reorder does not count
 * as moving it (`sameKey`). Every accepted move names its sender as the
 * card's placer. Pure.
 *
 * - No `from`: the card is created, its sender its owner, with no command.
 * - No `to`: the card is removed. Only a fresh column's card is: closing an
 *   unsent column is the only removal there is.
 * - To the queue: after the lane's last card, queued by the sender, and why
 *   it was not sent before is cleared. Below the line again, it keeps both.
 */
export function planMove(
  cards: readonly CardRecord[],
  move: Move,
  sender: WriterId,
): MoveStep {
  const now = cards.find(c => c.id === move.card)
  if (move.from === null) {
    if (now !== undefined) return { kind: "refused", code: "exists", now }
    if (move.to === null) return { kind: "refused", code: "gone", now: null }
    return {
      kind: "write",
      record: {
        id: move.card,
        owner: sender,
        place: placeAt(move.to, cards, sender),
        placer: sender,
        command: null,
        unsent: null,
      },
    }
  }
  if (now === undefined) return { kind: "refused", code: "gone", now: null }
  if (!sameKey(keyOf(now.place), move.from))
    return { kind: "refused", code: "moved", now }
  if (move.to === null)
    return now.place.kind === "fresh"
      ? { kind: "remove", id: now.id }
      : { kind: "refused", code: "not-fresh", now }
  return {
    kind: "write",
    record: {
      ...now,
      place: placeAt(move.to, cards, sender),
      placer: sender,
      unsent: move.to.kind === "queued" ? null : now.unsent,
    },
  }
}

/**
 * A move and what follows it: the lane to drain, when the move leaves the
 * card queued on a lane that is not running. Pure.
 */
export function planMoveCommand(
  cards: readonly CardRecord[],
  move: Move,
  sender: WriterId,
  running: (lane: LaneName) => boolean,
): { readonly step: MoveStep; readonly drain: LaneName | null } {
  const step = planMove(cards, move, sender)
  const lane =
    step.kind === "write" && step.record.place.kind === "queued"
      ? step.record.place.lane
      : null
  return { step, drain: lane !== null && !running(lane) ? lane : null }
}

/** Set a card's command, or clear it: its place and placer kept. Pure. */
export function planSetCommand(
  cards: readonly CardRecord[],
  card: CardId,
  command: CardCommand | null,
): MoveStep {
  const now = cards.find(c => c.id === card)
  return now === undefined
    ? { kind: "refused", code: "gone", now: null }
    : { kind: "write", record: { ...now, command } }
}

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
