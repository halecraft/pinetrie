// queue — a thread's queued cards: which is popped next, what a pop carries,
// what unqueueing writes back, and the cards a run's facts make.

import {
  type AskCardId,
  type CardId,
  type CardInPlace,
  type CardPlace,
  type CardRecord,
  type CatchUpCommand,
  type FactCard,
  type FactCardId,
  hasPlaceKind,
  INVENTORY_SLOTS,
  isTextCard,
  type Move,
  makeCard,
  moveOf,
  type NoteColumnId,
  noteOf,
  type QueuedFact,
  type RelayDetails,
  type TaskId,
  type TextCard,
  type TextCardId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import { byOrder } from "./card.ts"
import { type PlaceStep, planMake } from "./moves.ts"
import { toNotes } from "./notes.ts"
import { orderAfter, orderBetween, respace } from "./order.ts"

// ── the queue ──────────────────────────────────────

/**
 * A queued card: a card of any kind `KINDS` queues (a text card, a fact on
 * its way into its thread, an ask from another thread for its busy agent),
 * with its place narrowed.
 */
export type QueuedCard = CardInPlace<"queued">

/** A queued text card. */
export type QueuedText = Extract<QueuedCard, { readonly kind: "text" }>

/**
 * A queued card sent as its queuer's message: a text card, or a reference,
 * whose quote is sent.
 */
export type QueuedMessage = Extract<
  QueuedCard,
  { readonly kind: "text" | "reference" }
>

/** Whether a queued card is a text card: a message, not a fact. */
export const isQueuedText = (c: QueuedCard): c is QueuedText =>
  c.kind === "text"

/**
 * Whether a queued card is sent as its queuer's message (`QueuedMessage`):
 * what a Stop holds the queue for, the dock counts, and unqueue all takes
 * back below the line.
 */
export const isQueuedMessage = (c: QueuedCard): c is QueuedMessage =>
  c.kind === "text" || c.kind === "reference"

const isQueued = (c: CardRecord): c is QueuedCard => hasPlaceKind(c, "queued")

/** Whether a queued card is a fact: nobody's instruction, and it starts no run. */
const isQueuedFact = (c: QueuedCard): c is FactCard => c.kind === "fact"

export const isPinned = (
  c: CardRecord,
): c is CardRecord & {
  readonly place: Extract<CardPlace, { kind: "pinned" }>
} => c.place.kind === "pinned"

/** A card pinned to a task, with its place narrowed. */
export type TaskPinnedCard = TextCard & {
  readonly place: Extract<CardPlace, { kind: "task-pinned" }>
}

/** The cards pinned to `task`, in the order they were pinned: by `order`, then id. */
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
  /** Its queue is held, and its top card is a message. */
  | { readonly kind: "held" }
  /** Someone is typing in its top card: it waits until they stop. */
  | { readonly kind: "typing"; readonly card: QueuedText }
  /**
   * Every card queued is a blank message (`isBlankMessage`), passed over:
   * it waits for `card`, the first, to be written in.
   */
  | { readonly kind: "blank"; readonly card: QueuedText }
  | { readonly kind: "pop"; readonly card: QueuedCard }

/**
 * A message with no command and nothing but whitespace: "+ add
 * to queue"'s card before anyone writes in it. The drain passes over it,
 * leaving it where it is, rather than send nothing.
 */
export const isBlankMessage = (card: TextCard, text: string): boolean =>
  card.content.command === null && text.trim() === ""

/**
 * The queued cards that are blank messages (`isBlankMessage`), as whoever
 * holds their texts reads them: the drain passes over them, and no lane
 * counts them as waiting. A card whose text `texts` does not yet
 * hold as its queuer had it is not blank: its record can arrive before its
 * text, and passing over it would send the cards behind it first.
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
        c.content.command === null &&
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
 * The next queued card to pop for a lane: none while it runs; only a fact on
 * top while its thread is in an inventory; else its top
 * card that is not blank (`blank`, each `isBlankMessage`), unless the queue
 * is held or someone is typing in that card. A blank card is passed over
 * and stays where it is, so the cards behind it are not stuck behind
 * nothing. A fact is popped whatever the hold or the typing: it is nobody's
 * instruction, and starts no run.
 */
export function planNextQueuedCardPop(
  cards: readonly CardRecord[],
  lane: ThreadId,
  facts: {
    readonly running: boolean
    /** Its thread is in someone's inventory (`heldIn`): nothing runs there. */
    readonly away: boolean
    readonly held: boolean
    /** The cards someone is typing in now (`typingIn`). */
    readonly typing: ReadonlySet<CardId>
    /** The queued cards that are blank messages now. */
    readonly blank: ReadonlySet<CardId>
  },
): NextQueuedCardPopStep {
  if (facts.running) return { kind: "idle" }
  const queue = queuedOn(cards, lane)
  const top = queue.find(c => !facts.blank.has(c.id))
  // A thread in an inventory has no runner: its messages wait.
  // A fact on top starts no run, so it is appended there too: a take's
  // stop is in the thread, and its face says so.
  if (facts.away)
    return top !== undefined && isQueuedFact(top)
      ? { kind: "pop", card: top }
      : { kind: "idle" }
  if (top === undefined) {
    const first = queue.find(isQueuedText)
    if (first === undefined) return { kind: "idle" }
    return facts.held ? { kind: "held" } : { kind: "blank", card: first }
  }
  if (isQueuedFact(top)) return { kind: "pop", card: top }
  if (facts.held) return { kind: "held" }
  // An ask starts a run, as a message does, but nobody types in it.
  if (isQueuedText(top) && facts.typing.has(top.id))
    return { kind: "typing", card: top }
  return { kind: "pop", card: top }
}

/**
 * Unqueue all: every message card queued on the lane
 * back below the line where it was queued, a note, in queue
 * order. A fact stays:
 * nobody moves it. Planned by the host from the queue as it is, so a card
 * popped since the click is not in it.
 */
export const planUnqueueAll = (
  cards: readonly CardRecord[],
  lane: ThreadId,
): readonly Move[] =>
  queuedOn(cards, lane)
    .filter(isQueuedMessage)
    .map(c => moveOf(c, noteOf(c.place)))

/**
 * A popped card the host could not send, written back saying why, its
 * command and placer kept, since the host's own write is nobody's move: a
 * note in the column nearest its thread, made in this step when its task
 * has none (`notesOf`); for a thread in an inventory, in that
 * inventory. Never queued again, or the next drain would pop it
 * and fail the same way (answer 5). Where it cannot go (that
 * inventory full, or a thread with no card), it stays queued, saying why,
 * and its queue is held (`hold`), so the drain passes it by until someone
 * moves it.
 */
export function planUnsent(input: {
  readonly cards: readonly CardRecord[]
  readonly card: QueuedMessage
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
  // Only a text card keeps why: a reference's content is its address and quote.
  const said: QueuedMessage =
    card.kind === "text"
      ? { ...card, content: { ...card.content, unsent: reason } }
      : card
  if (
    notes === null ||
    (notes.place.kind === "inventory" &&
      inventoryFull(cards, notes.place.holder, card.id))
  )
    return { steps: [{ kind: "write", record: said }], hold: true }
  return {
    steps: [
      ...notes.first,
      { kind: "write", record: { ...said, place: notes.place } },
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
 * A fact's card: queued on its lane, made by the host
 * for whoever acted (`makeCard`, `planMake`), its owner and placer, with no
 * text to wait for (`seen` ""). What a command on the offer did goes after
 * every card there, in order with them. A stop goes before them: it
 * happened before anything queued is sent, so the run's end appends it
 * first, whatever the hold (`planNextQueuedCardPop`), and nothing queued
 * may pass it. With no room before the first card, the crowded cards are
 * given new ranks (`respace`), written with it. Null when the host's own
 * make is refused, which no queue does: the host's shell logs it.
 */
export function planFactCard(input: {
  readonly cards: readonly CardRecord[]
  readonly id: FactCardId
  readonly fact: QueuedFact
}): readonly PlaceStep[] | null {
  const { fact } = input
  const queue = queuedOn(input.cards, fact.lane)
  const first =
    fact.kind === "stopped"
      ? orderBetween(null, queue[0]?.place.order ?? null)
      : orderAfter(queue)
  const spaced =
    first === null
      ? respace(
          queue.map(c => c.place.order),
          0,
        )
      : null
  const step = planMake(
    input.cards,
    makeCard(
      "fact",
      input.id,
      {
        kind: "queued",
        thread: fact.lane,
        order: first ?? spaced?.inserted ?? "",
        by: fact.by,
        seen: "",
      },
      { fact },
      fact.by,
    ),
    // No person places a fact (`KINDS`): the host makes it, for `fact.by`.
    "host",
  )
  if (step.kind === "refused") return null
  const renumbered = [...(spaced?.changed ?? [])].flatMap(
    ([i, order]): PlaceStep[] => {
      const card = queue[i]
      return card === undefined
        ? []
        : [
            {
              kind: "write",
              record: { ...card, place: { ...card.place, order } },
            },
          ]
    },
  )
  return [step, ...renumbered]
}

/**
 * An ask for a busy agent, queued as an ask card after the cards there:
 * the host makes it, for the person behind the chain, and the
 * drain relays it when the lane is free. Null when the host's own make is
 * refused, which no queue does.
 */
export function planAskCard(input: {
  readonly cards: readonly CardRecord[]
  readonly id: AskCardId
  readonly lane: ThreadId
  readonly relay: RelayDetails
}): PlaceStep | null {
  const queue = queuedOn(input.cards, input.lane)
  const step = planMake(
    input.cards,
    makeCard(
      "ask",
      input.id,
      {
        kind: "queued",
        thread: input.lane,
        order: orderAfter(queue),
        by: input.relay.by,
        seen: "",
      },
      { relay: input.relay },
      input.relay.by,
    ),
    // No person places an ask (`KINDS`): the host makes it.
    "host",
  )
  return step.kind === "refused" ? null : step
}

/**
 * What the drain does with a popped card, decided before it acts:
 * append a fact; catch up through a command, then send the text or, with
 * none, nothing; or send a plain message. A blank plain message is never
 * popped (`isBlankMessage`).
 */
export type CarryPlan =
  | { readonly kind: "fact"; readonly fact: QueuedFact }
  | {
      readonly kind: "catch-up"
      readonly card: QueuedText
      readonly command: CatchUpCommand
      /** After a clean update or nothing new: the card's text, or nothing to send. */
      readonly after: "send" | "discard"
    }
  /** Split the offer in a run of its own, the card's text its intent. */
  | {
      readonly kind: "split"
      readonly card: QueuedText
      readonly intent: string
    }
  | { readonly kind: "send"; readonly card: QueuedMessage }
  /**
   * A reference whose quote was not read (its blob is missing), or is
   * empty: nothing is sent, and the queue goes on.
   */
  | { readonly kind: "skip"; readonly card: QueuedMessage }
  /** Relay an ask from another thread: its run starts here. */
  | { readonly kind: "relay"; readonly relay: RelayDetails }

/**
 * A popped card and its words (`textSourceOf`: a text card's document, a
 * reference's quote, a fact's fact) -> what the drain does with it: a
 * reference's quote is sent as a message, with no command, and one with no
 * quote is skipped rather than sent empty.
 */
export function planCarry(card: QueuedCard, text: string): CarryPlan {
  if (card.kind === "fact") return { kind: "fact", fact: card.content.fact }
  if (card.kind === "ask") return { kind: "relay", relay: card.content.relay }
  if (card.kind === "reference")
    return text.trim() === "" ? { kind: "skip", card } : { kind: "send", card }
  const blank = text.trim() === ""
  const { command } = card.content
  if (command === "split") return { kind: "split", card, intent: text.trim() }
  if (command !== null)
    return {
      kind: "catch-up",
      card,
      command,
      after: blank ? "discard" : "send",
    }
  return { kind: "send", card }
}
