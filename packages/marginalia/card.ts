// card — a card's record and where it sits (ADR-0048, ADR-0059).
//
// A card is live text in a place. Its text is its own `TextDoc`, written by
// clients; its record is in the places document (`PlacesDoc` in
// @pineta/schema), which only the host writes, through handoffs it applies
// or refuses (`planMove`). This module decodes a record, and decides where a
// card sits now, which moves the host accepts, which queued card is taken
// next, and which are swept. Who wrote in it is `writersOf` (`seat.ts`).

import {
  type ArchiveRecord,
  atEntry,
  CARD_COMMANDS,
  type CardCommand,
  type CardId,
  type CardPlace,
  type CardRecord,
  cardId,
  type EntryId,
  INVENTORY_SLOTS,
  keyOf,
  type LaneName,
  type LaneView,
  type Move,
  type MoveRefusal,
  movesOfDocId,
  type PlaceKey,
  type Position,
  placeFields,
  placeOfFields,
  type RootId,
  type RootRecord,
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
  root: Type.String(),
  at: Type.String(),
  lane: Type.String(),
  column: Type.String(),
  order: Type.String(),
  by: Type.String(),
  seen: Type.String(),
  command: Type.String(),
  unsent: Type.String(),
  placer: Type.String({ minLength: 1 }),
  holder: Type.String(),
})

/** The flat value the places document stores under a card's id. */
export interface StoredCardFields {
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
  readonly unsent: string
  readonly placer: string
  readonly holder: string
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
    place: {
      kind: "drafting",
      root: card.place.root,
      at: card.place.at,
      lane: card.place.lane,
    },
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
 * Whether `sender` may move a card into or out of `key`: every place but
 * someone else's inventory (ADR-0059). Pure.
 */
export const ownsPlace = (key: PlaceKey, sender: WriterId): boolean =>
  key.kind !== "inventory" || key.holder === sender

/** Why a move into `to` is refused before the card is looked at; null for none. */
function refuseInto(
  to: PlaceKey,
  cards: readonly CardRecord[],
  card: CardId,
  sender: WriterId,
): MoveRefusal | null {
  if (!ownsPlace(to, sender)) return "not-yours"
  if (to.kind !== "inventory") return null
  const held = cards.filter(
    c =>
      c.id !== card &&
      c.place.kind === "inventory" &&
      c.place.holder === sender,
  ).length
  return held >= INVENTORY_SLOTS ? "full" : null
}

/**
 * A handoff: a compare-and-set on where the card is. The host accepts a move
 * only if the card is still where its sender saw it; a reorder does not count
 * as moving it (`sameKey`). Every accepted move names its sender as the
 * card's placer. Pure.
 *
 * - No `from`: the card is created, its sender its owner, with no command.
 * - No `to`: the card is removed. Only a fresh column's card is, or one in
 *   the sender's own inventory: neither is anywhere anyone else sees.
 * - Into or out of an inventory: only its holder's, and into it only while
 *   it holds fewer than `INVENTORY_SLOTS` cards. A creation obeys both.
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
    const refusal = refuseInto(move.to, cards, move.card, sender)
    if (refusal !== null) return { kind: "refused", code: refusal, now: null }
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
  if (!ownsPlace(move.from, sender))
    return { kind: "refused", code: "not-yours", now }
  if (move.to === null)
    return now.place.kind === "fresh" || now.place.kind === "inventory"
      ? { kind: "remove", id: now.id }
      : { kind: "refused", code: "not-fresh", now }
  const refusal = refuseInto(move.to, cards, move.card, sender)
  if (refusal !== null) return { kind: "refused", code: refusal, now }
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
 * What a fresh column's first send does to the column's other cards: each
 * goes to drafting at `at`, the message the send wrote, on `lane`. The column
 * has become that thread's, and a card left fresh under its key would be
 * drawn nowhere. The host's write, not a person's move, so each card keeps its
 * placer, as `planUnsent` does. Nothing when the sent card was not fresh,
 * or its column is in another root than the message. Pure.
 */
export function planFreshFollow(
  cards: readonly CardRecord[],
  sent: CardId,
  root: RootId,
  at: EntryId,
  lane: LaneName | null,
): readonly PlaceStep[] {
  const place = cards.find(c => c.id === sent)?.place
  if (place?.kind !== "fresh" || place.root !== root) return []
  return cards
    .filter(
      c =>
        c.id !== sent &&
        c.place.kind === "fresh" &&
        c.place.column === place.column,
    )
    .map(c => ({
      kind: "write",
      record: {
        ...c,
        place: { kind: "drafting", root, at: atEntry(at), lane },
      },
    }))
}

/** What the host makes of several moves: every step, or the first refusal. */
export type MovesStep =
  | { readonly kind: "steps"; readonly steps: readonly PlaceStep[] }
  | Extract<MoveStep, { kind: "refused" }>

/** `cards` as `step` leaves them. */
const afterStep = (
  cards: readonly CardRecord[],
  step: PlaceStep,
): readonly CardRecord[] =>
  step.kind === "remove"
    ? cards.filter(c => c.id !== step.id)
    : [...cards.filter(c => c.id !== step.record.id), step.record]

/**
 * Several moves as one (a keep's cards, ADR-0066): each planned against the
 * cards as the ones before it left them, and accepted whole, or refused by
 * the first that is, naming its card. Pure.
 */
export function planMoves(
  cards: readonly CardRecord[],
  moves: readonly Move[],
  sender: WriterId,
): MovesStep {
  const steps: PlaceStep[] = []
  let now = cards
  for (const move of moves) {
    const step = planMove(now, move, sender)
    if (step.kind === "refused") return step
    steps.push(step)
    now = afterStep(now, step)
  }
  return { kind: "steps", steps }
}

/**
 * Moves and what follows them: the lanes to drain, where a move leaves its
 * card queued on a lane that is not running. Pure.
 */
export function planMoveCommand(
  cards: readonly CardRecord[],
  moves: readonly Move[],
  sender: WriterId,
  running: (lane: LaneName) => boolean,
): { readonly step: MovesStep; readonly drain: readonly LaneName[] } {
  const step = planMoves(cards, moves, sender)
  if (step.kind === "refused") return { step, drain: [] }
  const lanes = step.steps.flatMap(s =>
    s.kind === "write" && s.record.place.kind === "queued"
      ? [s.record.place.lane]
      : [],
  )
  return { step, drain: [...new Set(lanes)].filter(l => !running(l)) }
}

// ── moves' history (ADR-0066) ─────────────────────────────────────────────

/** The root a place is in; null for an inventory. */
const rootOfPlace = (place: CardPlace | PlaceKey): RootId | null =>
  place.kind === "inventory" ? null : place.root

/**
 * The root whose history of the sender's moves `moves` enter, or null for
 * none (ADR-0066). A creation or a removal enters none: a composer's new
 * card, a copy, a discard, a send. Otherwise the root the card goes to,
 * when it goes to one, else the root it leaves, read from its record, since
 * the host accepts a move only from where the card is. So a take is recorded
 * where it left, a put where it went, and a drag across roots where it
 * went. Of several, the first that names a root names the step's. Pure.
 */
export function historyOf(
  moves: readonly Move[],
  cards: readonly CardRecord[],
): RootId | null {
  for (const move of moves) {
    if (move.from === null || move.to === null) return null
    const from = cards.find(c => c.id === move.card)?.place
    const root =
      rootOfPlace(move.to) ?? (from === undefined ? null : rootOfPlace(from))
    if (root !== null) return root
  }
  return null
}

/** How long an archived root's histories are kept (ADR-0066). */
export const ARCHIVED_HISTORY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The histories of moves to retire (ADR-0066): those of a root archived
 * `ARCHIVED_HISTORY_MS` ago or longer; and, at startup only, those of a
 * root the directory does not name: a new tab that never sent, or a root
 * gone. After a run's end that second rule would retire the history of a new
 * tab open now. `stored` is every stored `moves:` document. Pure.
 */
export function planHistorySweep(input: {
  readonly stored: readonly string[]
  readonly roots: ReadonlyMap<RootId, RootRecord>
  readonly archive: ReadonlyMap<EntryId, ArchiveRecord>
  readonly now: number
  readonly startup: boolean
}): readonly string[] {
  return input.stored.filter(docId => {
    const of = movesOfDocId(docId)
    if (of === undefined) return false
    const known = input.roots.get(of.root)
    if (known === undefined) return input.startup
    const record =
      known.entry === null ? undefined : input.archive.get(known.entry)
    return (
      record?.state === "archived" &&
      input.now - record.at >= ARCHIVED_HISTORY_MS
    )
  })
}

/** Of an undo step, what Pineta reads: which document each part wrote, and where. */
export interface StepPart {
  readonly docId: string
  readonly footprint: readonly (readonly string[])[]
}

/** What an undo of moves did, as Kyneta says it with `whole`. */
export type UndoResult =
  | { readonly kind: "none" }
  | {
      readonly kind: "undone"
      readonly step: { readonly parts: readonly StepPart[] }
    }
  | {
      readonly kind: "refused"
      readonly step: { readonly parts: readonly StepPart[] }
      readonly stale: readonly StepPart[]
    }

/** What the host answers an undo of moves with. */
export type UndoAnswer =
  | { readonly kind: "nothing" }
  /** Each card it moved, and its place now: null when it removed the card. */
  | {
      readonly kind: "undone"
      readonly cards: readonly {
        readonly card: CardId
        readonly place: PlaceKey | null
      }[]
    }
  /** Someone moved one of its cards since: the first such card as it is now. */
  | Extract<MoveStep, { kind: "refused" }>

/** The cards `parts` wrote in the places document `placesId`, each once. */
function cardsOfParts(
  parts: readonly StepPart[],
  placesId: string,
): readonly CardId[] {
  const ids = parts
    .filter(p => p.docId === placesId)
    .flatMap(p => p.footprint)
    .flatMap(path =>
      path[0] === "cards" && path[1] !== undefined ? [cardId(path[1])] : [],
    )
  return [...new Set(ids)]
}

/**
 * An undo's answer, from what Kyneta did and the cards after it: the cards
 * its step wrote (their footprints in the places document) and where each
 * is now; or, refused, the first card it could not undo as it is now. Pure.
 */
export function undoAnswer(
  result: UndoResult,
  cards: readonly CardRecord[],
  placesId: string,
): UndoAnswer {
  switch (result.kind) {
    case "none":
      return { kind: "nothing" }
    case "undone":
      return {
        kind: "undone",
        cards: cardsOfParts(result.step.parts, placesId).map(card => {
          const now = cards.find(c => c.id === card)
          return { card, place: now === undefined ? null : keyOf(now.place) }
        }),
      }
    case "refused": {
      const card = cardsOfParts(result.stale, placesId)[0]
      const now = cards.find(c => c.id === card) ?? null
      return { kind: "refused", code: now === null ? "gone" : "moved", now }
    }
  }
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
 * Which rows of the places stored before ADR-0066 go into the new document:
 * none once it has cards, since it was carried over already; else every row
 * that decodes as a card now. A fresh card stored before ADR-0066 names no
 * root, which the host cannot find, so it is dropped, and its text is swept
 * with the others at that start. Pure.
 */
export function planPlacesCarryOver(
  old: Readonly<Record<string, unknown>>,
  now: readonly CardRecord[],
): { readonly cards: readonly CardRecord[]; readonly dropped: number } {
  if (now.length > 0) return { cards: [], dropped: 0 }
  const cards = Object.entries(old).flatMap(([id, value]) => {
    const card = decodeCard(id, value)
    return card === undefined ? [] : [card]
  })
  return { cards, dropped: Object.keys(old).length - cards.length }
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
