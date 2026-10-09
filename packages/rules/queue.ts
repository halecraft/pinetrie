// queue — a thread's queued cards (ADR-0048 step 3, S69): which is popped
// next to be sent, what a pop carries, what unqueueing writes back, and
// the cards a run's facts make.

import {
  type CardId,
  type CardPlace,
  type CardRecord,
  type CatchUpCommand,
  INVENTORY_SLOTS,
  isTextCard,
  type Move,
  moveOf,
  type NoteColumnId,
  noteOf,
  type OfferFact,
  type Position,
  type TaskId,
  type TextCard,
  type TextCardId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import { byOrder } from "./card.ts"
import type { PlaceStep } from "./moves.ts"
import { toNotes } from "./notes.ts"
import { orderAfter } from "./order.ts"

// ── the queue (ADR-0048 step 3, S69) ──────────────────────────────────────

/** A queued card, with its place narrowed: only a text card is queued. */
export type QueuedCard = TextCard & {
  readonly place: Extract<CardPlace, { kind: "queued" }>
}

const isQueued = (c: CardRecord): c is QueuedCard =>
  c.place.kind === "queued" && isTextCard(c)

export const isPinned = (
  c: CardRecord,
): c is CardRecord & {
  readonly place: Extract<CardPlace, { kind: "pinned" }>
} => c.place.kind === "pinned"

/** A card pinned to a task, with its place narrowed. */
export type TaskPinnedCard = TextCard & {
  readonly place: Extract<CardPlace, { kind: "task-pinned" }>
}

/** The cards pinned to `task` (ADR-0116), in the order they were pinned: by `order`, then id. */
export const taskPinnedOf = (
  cards: readonly CardRecord[],
  task: TaskId,
): readonly TaskPinnedCard[] =>
  cards
    .filter(
      (c): c is TaskPinnedCard =>
        c.kind === "text" &&
        c.place.kind === "task-pinned" &&
        c.place.task === task,
    )
    .sort(byOrder)

/** A lane's queued cards, in the order they are popped: by `order`, then id. */
export function queuedOn(
  cards: readonly CardRecord[],
  lane: ThreadId,
): QueuedCard[] {
  return cards
    .filter(isQueued)
    .filter(c => c.place.thread === lane)
    .sort(byOrder)
}

/** What a lane's queue gives up next. */
export type NextQueuedCardPopStep =
  /** It runs, or nothing is queued. */
  | { readonly kind: "idle" }
  /** Its queue is held, and its top card is a message (ADR-0048 step 7). */
  | { readonly kind: "held" }
  /** Someone is typing in its top card: it waits until they stop. */
  | { readonly kind: "typing"; readonly card: QueuedCard }
  /**
   * Every card queued is a blank message (`isBlankMessage`), passed over:
   * it waits for `card`, the first, to be written in.
   */
  | { readonly kind: "blank"; readonly card: QueuedCard }
  | { readonly kind: "pop"; readonly card: QueuedCard }

/**
 * A message with no command and nothing but whitespace (ADR-0113): "+ add
 * to queue"'s card before anyone writes in it. The drain passes over it,
 * leaving it where it is, rather than send nothing.
 */
export const isBlankMessage = (card: TextCard, text: string): boolean =>
  card.carries.kind === "message" &&
  card.carries.command === null &&
  text.trim() === ""

/**
 * The queued cards that are blank messages (`isBlankMessage`), as whoever
 * holds their texts reads them: the drain passes over them, and no lane
 * counts them as waiting (ADR-0113). A card whose text `texts` does not yet
 * hold as its queuer had it is not blank: its record can arrive before its
 * text (S96), and passing over it would send the cards behind it first.
 * Pure.
 */
export function blankQueued(
  cards: readonly CardRecord[],
  texts: {
    /** Whether the text held here has `seen`, the queuer's version. */
    readonly holds: (card: TextCardId, seen: string) => boolean
    readonly text: (card: TextCardId) => string
  },
): ReadonlySet<CardId> {
  return new Set(
    cards
      .filter(isTextCard)
      .flatMap(c =>
        c.place.kind === "queued" &&
        c.carries.kind === "message" &&
        c.carries.command === null &&
        texts.holds(c.id, c.place.seen) &&
        isBlankMessage(c, texts.text(c.id))
          ? [c.id]
          : [],
      ),
  )
}

/** No queued card known to be blank: for a read of lanes that uses only their tips. */
export const NONE_BLANK: ReadonlySet<CardId> = new Set()

/**
 * The next queued card to pop for a lane: none while it runs or its thread
 * is in an inventory; else its top
 * card that is not blank (`blank`, each `isBlankMessage`), unless the queue
 * is held or someone is typing in that card. A blank card is passed over
 * and stays where it is, so the cards behind it are not stuck behind
 * nothing. A fact is popped whatever the hold or the typing: it is nobody's
 * instruction, and starts no run. Pure.
 */
export function planNextQueuedCardPop(
  cards: readonly CardRecord[],
  lane: ThreadId,
  facts: {
    readonly running: boolean
    /** Its thread is in someone's inventory (`heldIn`, ADR-0124): nothing runs there. */
    readonly away: boolean
    readonly held: boolean
    /** The cards someone is typing in now (`typingIn`). */
    readonly typing: ReadonlySet<CardId>
    /** The queued cards that are blank messages now. */
    readonly blank: ReadonlySet<CardId>
  },
): NextQueuedCardPopStep {
  // A thread in an inventory has no runner (ADR-0124): its queue waits.
  if (facts.running || facts.away) return { kind: "idle" }
  const queue = queuedOn(cards, lane)
  const top = queue.find(c => !facts.blank.has(c.id))
  if (top === undefined) {
    const first = queue[0]
    if (first === undefined) return { kind: "idle" }
    return facts.held ? { kind: "held" } : { kind: "blank", card: first }
  }
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
  lane: ThreadId,
): readonly Move[] =>
  queuedOn(cards, lane)
    .filter(c => c.carries.kind === "message")
    .map(c => moveOf(c, noteOf(c.place)))

/**
 * A popped card the host could not send, written back saying why, its
 * command and placer kept, since the host's own write is nobody's move: a
 * note in the column nearest its thread, made in this step when its task
 * has none (`notesOf`, ADR-0116); for a thread in an inventory, in that
 * inventory (ADR-0117). Never queued again, or the next drain would pop it
 * and fail the same way (S69, answer 5). Where it cannot go (that
 * inventory full, or a thread with no card), it stays queued, saying why,
 * and its queue is held (`hold`), so the drain passes it by until someone
 * moves it. Pure.
 */
export function planUnsent(input: {
  readonly cards: readonly CardRecord[]
  readonly card: QueuedCard
  readonly reason: string
  /** Mints the id of a note column made for it. */
  readonly newColumn: () => NoteColumnId
}): { readonly steps: readonly PlaceStep[]; readonly hold: boolean } {
  const { cards, card, reason } = input
  const notes = toNotes({
    cards,
    to: { kind: "notes", near: "thread", thread: card.place.thread },
    newColumn: input.newColumn,
    by: card.placer,
  })
  if (
    notes === null ||
    (notes.place.kind === "inventory" &&
      inventoryFull(cards, notes.place.holder, card.id))
  )
    return {
      steps: [{ kind: "write", record: { ...card, unsent: reason } }],
      hold: true,
    }
  return {
    steps: [
      ...notes.first,
      {
        kind: "write",
        record: { ...card, place: notes.place, unsent: reason },
      },
    ],
    hold: false,
  }
}

/** Whether `holder`'s inventory holds `INVENTORY_SLOTS` cards, `card` not counted. */
export const inventoryFull = (
  cards: readonly CardRecord[],
  holder: WriterId,
  card: CardId,
): boolean =>
  cards.filter(
    c =>
      c.id !== card &&
      c.place.kind === "inventory" &&
      c.place.holder === holder,
  ).length >= INVENTORY_SLOTS

/**
 * The card a fact rides in (ADR-0080): queued on its lane after every card
 * there, owned and queued by whoever acted, with no text to wait for (`seen`
 * ""). `at` is the thread's end, where an unqueue would put it, though
 * nobody unqueues a fact. The drain pops it in order. Pure.
 */
export function planFactCard(input: {
  readonly cards: readonly CardRecord[]
  readonly id: TextCardId
  readonly fact: OfferFact
  readonly at: Position
}): PlaceStep {
  const { fact } = input
  return {
    kind: "write",
    record: {
      kind: "text",
      id: input.id,
      owner: fact.by,
      place: {
        kind: "queued",
        at: input.at,
        thread: fact.lane,
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
 * none, nothing; or send a plain message. A blank plain message is never
 * popped (`isBlankMessage`).
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

/** A popped card and its text -> what the drain does with it. Pure. */
export function planCarry(card: TextCard, text: string): CarryPlan {
  if (card.carries.kind === "fact")
    return { kind: "fact", fact: card.carries.fact }
  const blank = text.trim() === ""
  const { command } = card.carries
  if (command === "split") return { kind: "split", intent: text.trim() }
  if (command !== null)
    return { kind: "catch-up", command, after: blank ? "discard" : "send" }
  return { kind: "send" }
}
