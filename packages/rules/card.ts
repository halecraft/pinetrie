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
  type ArchivedRoot,
  atEntry,
  CARD_COMMANDS,
  type CardCarries,
  type CardCommand,
  type CardId,
  type CardPlace,
  type CardRecord,
  type CatchUpCommand,
  cardId,
  type EntryId,
  firstEmpty,
  INVENTORY_SLOTS,
  keyOf,
  type LaneName,
  type LaneView,
  type Move,
  type MoveRefusal,
  moveOf,
  movesOfDocId,
  NOTES_GRID,
  noteOf,
  type OfferFact,
  PLAIN,
  type PlaceKey,
  type Position,
  placeFields,
  placeOfFields,
  type Reorder,
  type RootId,
  type RootRecord,
  sameKey,
  type TreeIndex,
  threadOf,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"
import { decodeOfferFact, encodeOfferFact } from "./fact.ts"
import { orderAfter, orderBetween, respace } from "./order.ts"

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
}

/** A card record -> the flat value the places document stores under its id. */
export const encodeCard = ({
  owner,
  place,
  placer,
  carries,
  unsent,
}: CardRecord): StoredCardFields => ({
  owner,
  ...placeFields(place),
  command: carries.kind === "message" ? (carries.command ?? "") : "",
  fact: carries.kind === "fact" ? encodeOfferFact(carries.fact) : "",
  unsent: unsent ?? "",
  placer,
})

const isCommand = (s: string): s is CardCommand =>
  (CARD_COMMANDS as readonly string[]).includes(s)

/** A card's stored command and fact -> what it carries; undefined for neither readable, or both. */
function carriesOf(command: string, fact: string): CardCarries | undefined {
  if (fact === "")
    return command === ""
      ? PLAIN
      : isCommand(command)
        ? { kind: "message", command }
        : undefined
  if (command !== "") return undefined
  const decoded = decodeOfferFact(fact)
  return decoded === undefined ? undefined : { kind: "fact", fact: decoded }
}

/**
 * A stored card -> its record; undefined for one that is malformed, a
 * command or a fact this build does not know among them, or a fact with a
 * command. Total. Where it is is read by core's `placeOfFields`, as a move's
 * key on the wire is by `keyOfFields`. A record stored before facts has no
 * `fact`, and is a message.
 */
export const decodeCard = (
  id: string,
  value: unknown,
): CardRecord | undefined =>
  decodeWith(StoredCard, value, c => {
    const place = placeOfFields(c)
    if (place === undefined) return undefined
    const carries = carriesOf(c.command, c.fact ?? "")
    if (carries === undefined) return undefined
    return {
      id: cardId(id),
      owner: c.owner as WriterId,
      place,
      placer: c.placer as WriterId,
      carries,
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
 * Your message's thread end now (ADR-0113); null for any other card, or a
 * place gone. A note's or a pinned card's end is `cardsAt`'s alone: resolved
 * here, it could take your composer (`yourCard`).
 */
export const cardEnd = (
  card: CardRecord,
  lanes: readonly LaneView[],
  index: TreeIndex,
): EntryId | null =>
  card.place.kind === "composing"
    ? placeEnd(card.place, card.owner, lanes, index)
    : null

/** The shared kinds of place at a thread's end, resolved through `threadOf`. */
type EndKind = "note" | "pinned"

/**
 * Everyone's cards of `kind` whose thread ends at `end`: by `order` when they
 * have one, then by id, so oldest first. The one way a note's or a pinned
 * card's end is resolved: `cardEnd` stays your message's alone, so neither
 * is ever bound to a composer (`yourCard`).
 */
export function cardsAt(
  kind: EndKind,
  end: EntryId,
  cards: readonly CardRecord[],
  lanes: readonly LaneView[],
  index: TreeIndex,
): readonly CardRecord[] {
  return cards
    .filter(
      c =>
        c.place.kind === kind &&
        placeEnd(c.place, c.owner, lanes, index) === end,
    )
    .sort(byOrder)
}

/** The order of a place that has one, else "". */
const orderOf = (c: CardRecord): string =>
  c.place.kind === "queued" || c.place.kind === "pinned" ? c.place.order : ""

/** By `order`, then by id (S69). */
const byOrder = (a: CardRecord, b: CardRecord): number => {
  const [x, y] = [orderOf(a), orderOf(b)]
  if (x !== y) return x < y ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// ── notes' cells (ADR-0113) ───────────────────────────────────────────────

type NotePlace = Extract<CardPlace, { kind: "note" }>

/**
 * The board a note's cell is on, as the host can tell without the tree:
 * its lane's, which is its thread's, else its root and where it was made.
 * Two notes of one lane-less thread made at different ends are counted on
 * two boards: the page draws a cell two notes claim in one of them
 * (`notesBoardView`).
 */
const boardOf = (p: {
  readonly root: RootId
  readonly at: Position
  readonly lane: LaneName | null
}): string => `${p.root} ${p.lane ?? (p.at.kind === "entry" ? p.at.id : "")}`

const isNote = (
  c: CardRecord,
): c is CardRecord & { readonly place: NotePlace } => c.place.kind === "note"

/** The cells taken on `place`'s board. */
const cellsTaken = (
  cards: readonly CardRecord[],
  place: Parameters<typeof boardOf>[0],
): ReadonlySet<number> => {
  const board = boardOf(place)
  return new Set(
    cards.flatMap(c =>
      isNote(c) && c.place.cell !== null && boardOf(c.place) === board
        ? [c.place.cell]
        : [],
    ),
  )
}

/**
 * `place` as a note in a cell: its own, or for none the first empty one on
 * its board (`firstEmpty` over `NOTES_GRID`). The host alone assigns a cell
 * a move leaves to it, as it assigns order keys.
 */
const withCell = (
  cards: readonly CardRecord[],
  place: NotePlace,
): NotePlace => ({
  ...place,
  cell:
    place.cell ??
    firstEmpty(NOTES_GRID, cellsTaken(cards, place)) ??
    // A growing grid always has one.
    0,
})

/**
 * A note among `written` that shares a board and a cell with another, as
 * `cards` are now: the other, whose placer a refusal names; null for none.
 */
function cellClash(
  cards: readonly CardRecord[],
  written: readonly CardId[],
): CardRecord | null {
  for (const id of written) {
    const c = cards.find(x => x.id === id)
    if (c === undefined || !isNote(c) || c.place.cell === null) continue
    const board = boardOf(c.place)
    const cell = c.place.cell
    const other = cards.find(
      o =>
        o.id !== c.id &&
        isNote(o) &&
        o.place.cell === cell &&
        boardOf(o.place) === board,
    )
    if (other !== undefined) return other
  }
  return null
}

/** Where a column's composer is: a thread's end, or a fresh column by its key. */
type CardWhere =
  | { readonly kind: "end"; readonly end: EntryId }
  | { readonly kind: "fresh"; readonly column: string }

/**
 * Your message where a column's composer is (ADR-0113); never another
 * writer's, and never a note. Of several at one end, the newest (ids are
 * uuidv7); a starting host leaves one (`planStoredCardRepair`).
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

const isPinned = (
  c: CardRecord,
): c is CardRecord & {
  readonly place: Extract<CardPlace, { kind: "pinned" }>
} => c.place.kind === "pinned"

/** A lane's queued cards, in the order they are popped: by `order`, then id. */
export function queuedOn(
  cards: readonly CardRecord[],
  lane: LaneName,
): QueuedCard[] {
  return cards
    .filter(isQueued)
    .filter(c => c.place.lane === lane)
    .sort(byOrder)
}

/** What a lane's queue gives up next. */
type NextQueuedCardPopStep =
  /** It runs, or nothing is queued. */
  | { readonly kind: "idle" }
  /** Its queue is held, and its top card is a message (ADR-0048 step 7). */
  | { readonly kind: "held" }
  /** Someone is typing in its top card: it waits until they stop. */
  | { readonly kind: "typing"; readonly card: QueuedCard }
  | { readonly kind: "pop"; readonly card: QueuedCard }

/**
 * The next queued card to pop for a lane: none while it runs; else its top
 * card, unless the queue is held or someone is typing in that card. A fact
 * on top is popped whatever the hold or the typing: it is nobody's
 * instruction, and starts no run. Pure.
 */
export function planNextQueuedCardPop(
  cards: readonly CardRecord[],
  lane: LaneName,
  facts: {
    readonly running: boolean
    readonly held: boolean
    /** The cards someone is typing in now (`typingIn`). */
    readonly typing: ReadonlySet<CardId>
  },
): NextQueuedCardPopStep {
  if (facts.running) return { kind: "idle" }
  const top = queuedOn(cards, lane)[0]
  if (top === undefined) return { kind: "idle" }
  if (top.carries.kind === "fact") return { kind: "pop", card: top }
  if (facts.held) return { kind: "held" }
  if (facts.typing.has(top.id)) return { kind: "typing", card: top }
  return { kind: "pop", card: top }
}

/**
 * Unqueue all (ADR-0048 step 7): every message card queued on the lane
 * back below the line where it was queued, a note (ADR-0113), in queue
 * order. A fact stays:
 * nobody moves it. Planned by the host from the queue as it is, so a card
 * popped since the click is not in it. Pure.
 */
export const planUnqueueAll = (
  cards: readonly CardRecord[],
  lane: LaneName,
): readonly Move[] =>
  queuedOn(cards, lane)
    .filter(c => c.carries.kind === "message")
    .map(c => moveOf(c, noteOf(c.place)))

/**
 * A popped card the host could not send, written back: a note where it
 * was queued, saying why, its command and placer kept, since the host's own
 * write is nobody's move. Never queued again, or the next drain would pop
 * it and fail the same way (S69, answer 5).
 */
export const planUnsent = (
  cards: readonly CardRecord[],
  card: QueuedCard,
  reason: string,
): PlaceStep => ({
  kind: "write",
  record: {
    ...card,
    place: withCell(cards, {
      kind: "note",
      root: card.place.root,
      at: card.place.at,
      lane: card.place.lane,
      cell: null,
    }),
    unsent: reason,
  },
})

/**
 * The card a fact rides in (ADR-0080): queued on its lane after every card
 * there, owned and queued by whoever acted, with no text to wait for (`seen`
 * ""). `at` is the thread's end, where an unqueue would put it, though
 * nobody unqueues a fact. The drain pops it in order. Pure.
 */
export function planFactCard(input: {
  readonly cards: readonly CardRecord[]
  readonly id: CardId
  readonly fact: OfferFact
  readonly root: RootId
  readonly at: Position
}): PlaceStep {
  const { fact } = input
  return {
    kind: "write",
    record: {
      id: input.id,
      owner: fact.by,
      place: {
        kind: "queued",
        root: input.root,
        at: input.at,
        lane: fact.lane,
        order: orderAfter(queuedOn(input.cards, fact.lane)),
        by: fact.by,
        seen: "",
      },
      placer: fact.by,
      carries: { kind: "fact", fact },
      unsent: null,
    },
  }
}

/**
 * What the drain does with a popped card (ADR-0080), decided before it acts:
 * append a fact; catch up through a command, then send the text or, with
 * none, nothing; send a plain message; or discard an empty card.
 */
export type CarryPlan =
  | { readonly kind: "fact"; readonly fact: OfferFact }
  | {
      readonly kind: "catch-up"
      readonly command: CatchUpCommand
      /** After a clean update or nothing new: the card's text, or nothing to send. */
      readonly after: "send" | "discard"
    }
  /** Split the offer in a run of its own, the card's text its intent. */
  | { readonly kind: "split"; readonly intent: string }
  | { readonly kind: "send" }
  | { readonly kind: "discard" }

/** A popped card and its text -> what the drain does with it. Pure. */
export function planCarry(card: CardRecord, text: string): CarryPlan {
  if (card.carries.kind === "fact")
    return { kind: "fact", fact: card.carries.fact }
  const blank = text.trim() === ""
  const { command } = card.carries
  if (command === "split") return { kind: "split", intent: text.trim() }
  if (command !== null)
    return { kind: "catch-up", command, after: blank ? "discard" : "send" }
  return blank ? { kind: "discard" } : { kind: "send" }
}

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

/**
 * A key as the place it becomes, with what the host assigns to a queued or
 * pinned one. A pinned card goes after every pinned card in the session, not
 * only its thread's: a thread is found through the tree, which a handoff
 * does not read, and an order only has to grow within a thread.
 */
function placeAt(
  key: PlaceKey,
  cards: readonly CardRecord[],
  sender: WriterId,
): CardPlace {
  switch (key.kind) {
    case "queued":
      return {
        ...key,
        order: orderAfter(queuedOn(cards, key.lane)),
        by: sender,
      }
    case "pinned":
      return { ...key, order: orderAfter(cards.filter(isPinned)) }
    case "gone":
      return { ...key, by: sender }
    case "note":
      return withCell(cards, key)
    default:
      return key
  }
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
 * only if the card is still where its sender saw it; someone else's reorder
 * since does not count as moving it (`sameKey`). A move to where the card is
 * already is refused `moved`: `planReorder` changes a place in line. Every
 * accepted move names its sender as the card's placer. Pure.
 *
 * - No `from`: the card is created, its sender its owner, with no command.
 * - A card carrying a fact is the host's (ADR-0080): every move of it is
 *   refused `fact`.
 * - To gone: a discard (ADR-0111), from any place the sender may move out
 *   of. A gone card moves only by an undo, which is no handoff: a move out
 *   of gone is refused `gone`.
 * - Into or out of an inventory: only its holder's, and into it only while
 *   it holds fewer than `INVENTORY_SLOTS` cards. A creation obeys both.
 * - To the queue: after the lane's last card, queued by the sender, and why
 *   it was not sent before is cleared. Below the line again, it keeps both.
 * - Pinned: after every pinned card (`placeAt`). Anyone may pin or unpin in
 *   a shared place.
 */
export function planMove(
  cards: readonly CardRecord[],
  move: Move,
  sender: WriterId,
): MoveStep {
  const now = cards.find(c => c.id === move.card)
  if (move.from === null) {
    if (now !== undefined) return { kind: "refused", code: "exists", now }
    const refusal = refuseInto(move.to, cards, move.card, sender)
    if (refusal !== null) return { kind: "refused", code: refusal, now: null }
    return {
      kind: "write",
      record: {
        id: move.card,
        owner: sender,
        place: placeAt(move.to, cards, sender),
        placer: sender,
        carries: PLAIN,
        unsent: null,
      },
    }
  }
  if (now === undefined || now.place.kind === "gone")
    return { kind: "refused", code: "gone", now: null }
  // A fact is the host's, on its way into the thread: nobody moves it.
  if (now.carries.kind === "fact") return { kind: "refused", code: "fact", now }
  if (!sameKey(keyOf(now.place), move.from))
    return { kind: "refused", code: "moved", now }
  // A move to where the card is would requeue it last, under its sender's
  // name: a card changes its place in line by a reorder (`planReorder`).
  if (sameKey(move.from, move.to))
    return { kind: "refused", code: "moved", now }
  if (!ownsPlace(move.from, sender))
    return { kind: "refused", code: "not-yours", now }
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

// ── reorders (ADR-0048 step 7) ─────────────────────────────────────────────

/**
 * The cards a reorder of `card` moves among, without it, in order: its
 * lane's queue, or every pinned card in the session, since pinned keys are
 * the session's (`placeAt`).
 */
const siblingsOf = (
  cards: readonly CardRecord[],
  card: CardRecord,
): readonly CardRecord[] =>
  (card.place.kind === "queued"
    ? queuedOn(cards, card.place.lane)
    : cards.filter(isPinned).sort(byOrder)
  ).filter(c => c.id !== card.id)

/** `card` with order `order`, everything else as it is. */
const withOrder = (card: CardRecord, order: string): CardRecord =>
  card.place.kind === "queued" || card.place.kind === "pinned"
    ? { ...card, place: { ...card.place, order } }
    : card

/**
 * A reorder: a queued or pinned card moved among its neighbours, as its
 * sender saw them (ADR-0048, *Physics* 5). Only its order changes: its
 * placer, its queuer, its text's version and why it was not sent stay, so
 * nobody's trace or history changes with it. Refused:
 * - `gone`: no card;
 * - `fact`: a fact, or a queued card that would pass one, since a fact says
 *   what already happened;
 * - `moved`: the card is no longer where its sender saw it;
 * - `order-changed`: it names no neighbour, a neighbour is no longer among
 *   its siblings, or, in a queue, the two are no longer next to each other.
 *   A thread's pinned cards are found through the tree, which this does not
 *   read, so other threads' may sit between two pinned neighbours.
 *
 * With no room between the neighbours, the crowded siblings around it are
 * given new keys in the same step (`respace`). Pure.
 */
export function planReorder(
  cards: readonly CardRecord[],
  reorder: Reorder,
): MovesStep | MoveStep {
  const now = cards.find(c => c.id === reorder.card)
  if (now === undefined) return { kind: "refused", code: "gone", now: null }
  if (now.carries.kind === "fact") return { kind: "refused", code: "fact", now }
  if (!sameKey(keyOf(now.place), reorder.at))
    return { kind: "refused", code: "moved", now }
  const changed: MoveStep = { kind: "refused", code: "order-changed", now }
  const siblings = siblingsOf(cards, now)
  const find = (id: CardId | null): number | null | undefined => {
    if (id === null) return null
    const i = siblings.findIndex(c => c.id === id)
    return i < 0 ? undefined : i
  }
  const after = find(reorder.after)
  const before = find(reorder.before)
  if (after === undefined || before === undefined) return changed
  if (after === null && before === null) return changed
  // Where it goes among its siblings: just before `before`, else just after
  // `after`.
  const index = before ?? (after === null ? 0 : after + 1)
  if (after !== null && before !== null && after >= before) return changed
  if (now.place.kind === "queued") {
    if (siblings[index - 1]?.id !== (reorder.after ?? undefined)) return changed
    if (siblings[index]?.id !== (reorder.before ?? undefined)) return changed
    // The cards it passes, from where it was to where it goes.
    const was = siblings.findIndex(c => byOrder(now, c) < 0)
    const from = was < 0 ? siblings.length : was
    const passed =
      index < from ? siblings.slice(index, from) : siblings.slice(from, index)
    if (passed.some(c => c.carries.kind === "fact"))
      return { kind: "refused", code: "fact", now }
  }
  const bound = (i: number | null): string | null => {
    const c = i === null ? undefined : siblings[i]
    return c === undefined ? null : orderOf(c)
  }
  const order = orderBetween(bound(after), bound(before))
  if (order !== null) return { kind: "write", record: withOrder(now, order) }
  const made = respace(siblings.map(orderOf), index)
  return {
    kind: "steps",
    steps: [
      { kind: "write", record: withOrder(now, made.inserted) },
      ...[...made.changed].flatMap(([i, key]): PlaceStep[] => {
        const sibling = siblings[i]
        return sibling === undefined
          ? []
          : [{ kind: "write", record: withOrder(sibling, key) }]
      }),
    ],
  }
}

/**
 * What a fresh column's first send does to the column's other cards: each
 * becomes a note at `at` (ADR-0113), the message the send wrote, on `lane`. The column
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
  const steps: PlaceStep[] = []
  let now = cards
  for (const c of cards) {
    if (
      c.id === sent ||
      c.place.kind !== "fresh" ||
      c.place.column !== place.column
    )
      continue
    const step: PlaceStep = {
      kind: "write",
      record: {
        ...c,
        place: withCell(now, {
          kind: "note",
          root,
          at: atEntry(at),
          lane,
          cell: null,
        }),
      },
    }
    steps.push(step)
    now = afterStep(now, step)
  }
  return steps
}

/**
 * Stored cards made right for this build, by a starting host outside every
 * gesture (ADR-0113): before notes, everyone's drafting cards at a thread's
 * end were one kind, so one person may hold several there. Of each owner's
 * messages at one thread end (`ends`, resolved through `placeEnd`; by their
 * stored place for a root not loaded), the one `yourCard` would choose stays
 * their message, and every other becomes a note, so the host and the page
 * agree on which is. Pure.
 */
export function planStoredCardRepair(
  cards: readonly CardRecord[],
  ends: ReadonlyMap<CardId, EntryId | null>,
): readonly PlaceStep[] {
  const kept = new Set<string>()
  const steps: PlaceStep[] = []
  // Newest first: `yourCard` takes the newest at an end (ids are uuidv7).
  const newest = [...cards].sort((a, b) =>
    a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
  )
  for (const c of newest) {
    const { place } = c
    if (place.kind !== "composing") continue
    const end =
      ends.get(c.id) ??
      `${place.root} ${place.at.kind === "entry" ? place.at.id : ""} ${place.lane ?? ""}`
    const key = `${c.owner} ${end}`
    if (!kept.has(key)) {
      kept.add(key)
      continue
    }
    steps.push({
      kind: "write",
      record: { ...c, place: { ...place, kind: "note", cell: null } },
    })
  }
  // Every note with no cell takes the first empty one on its board, in id
  // order (ADR-0113): the messages just made notes among them.
  let now = steps.reduce(afterStep, cards)
  const cellLess = now
    .filter(isNote)
    .filter(c => c.place.cell === null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const c of cellLess) {
    const step: PlaceStep = {
      kind: "write",
      record: { ...c, place: withCell(now, c.place) },
    }
    const i = steps.findIndex(s => s.kind === "write" && s.record.id === c.id)
    if (i >= 0) steps[i] = step
    else steps.push(step)
    now = afterStep(now, step)
  }
  return steps
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
  // Checked once all are written, so a swap of two notes' cells is one
  // step, and a cell someone took since is refused (ADR-0113).
  const clash = cellClash(
    now,
    moves.map(m => m.card),
  )
  if (clash !== null) return { kind: "refused", code: "moved", now: clash }
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

/** The root a place is in; null for an inventory, or a card gone in none. */
const rootOfPlace = (place: CardPlace | PlaceKey): RootId | null =>
  place.kind === "inventory" ? null : place.root

/**
 * The root whose history of the sender's moves `moves` enter, or null for
 * none (ADR-0066). A creation enters none: a composer's new card, a copy.
 * Otherwise the root the card goes to, when it goes to one, else the root it
 * leaves, read from its record, since the host accepts a move only from
 * where the card is. So a take into the inventory is recorded where it
 * left, a put where it went, a drag across roots where it went, and a
 * discard in the root its gone place names (`discardedOf`). Of several, the
 * first that names a root names the step's. Pure.
 */
export function historyOf(
  moves: readonly Move[],
  cards: readonly CardRecord[],
): RootId | null {
  for (const move of moves) {
    if (move.from === null) return null
    const from = cards.find(c => c.id === move.card)?.place
    const root =
      rootOfPlace(move.to) ?? (from === undefined ? null : rootOfPlace(from))
    if (root !== null) return root
  }
  return null
}

/** How long an archived root's histories are kept (ADR-0066). */
const ARCHIVED_HISTORY_MS = 7 * 24 * 60 * 60 * 1000

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
  readonly archived: ReadonlyMap<RootId, ArchivedRoot>
  readonly now: number
  readonly startup: boolean
}): readonly string[] {
  return input.stored.filter(docId => {
    const of = movesOfDocId(docId)
    if (of === undefined) return false
    if (!input.roots.has(of.root)) return input.startup
    const archived = input.archived.get(of.root)
    return (
      archived !== undefined && input.now - archived.at >= ARCHIVED_HISTORY_MS
    )
  })
}

/** Of an undo step, what pinetrie reads: which document each part wrote, and where. */
interface StepPart {
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
type UndoAnswer =
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
    : now.carries.kind === "fact"
      ? { kind: "refused", code: "fact", now }
      : {
          kind: "write",
          record: { ...now, carries: { kind: "message", command } },
        }
}

/**
 * What a starting host deletes: records whose text is empty and that carry
 * no command and no fact, and stored `card:` documents with no record. Pure.
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
    .filter(
      c =>
        c.carries.kind === "message" &&
        c.carries.command === null &&
        (input.texts.get(c.id) ?? "") === "",
    )
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
