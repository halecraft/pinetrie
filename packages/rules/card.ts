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
  type ArchivedTask,
  asPlaceFields,
  CARD_COMMANDS,
  type CanvasKey,
  type CardCarries,
  type CardCommand,
  type CardId,
  type CardPlace,
  type CardRecord,
  type CardWidth,
  type CatchUpCommand,
  type EntryId,
  fitsPlace,
  INVENTORY_SLOTS,
  isFact,
  isNoteColumnId,
  isTextCard,
  isTextCardId,
  isThreadId,
  keyOf,
  kindOfCard,
  type Move,
  type MoveRefusal,
  type MoveTarget,
  moveOf,
  movesOfDocId,
  type NoteColumnId,
  type NotesTarget,
  noteOf,
  type OfferFact,
  type OrderedPlace,
  PLAIN,
  type PlaceKey,
  type Position,
  parseCardId,
  placed,
  placeFields,
  placeOfFields,
  type Reorder,
  type ReorderAt,
  type ResolvedMove,
  type ResolvedTarget,
  type RootId,
  sameKey,
  seenAt,
  type TaskId,
  type TextCard,
  type TextCardId,
  type TextPlace,
  type ThreadId,
  type TreeIndex,
  threadAt,
  threadEnd,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"
import { decodeOfferFact, encodeOfferFact } from "./fact.ts"
import { orderAfter, orderBetween, respace } from "./order.ts"
import {
  type CanvasCard,
  canvasOf,
  NO_TASK_INDEX,
  rankAfter,
  rankOfDrop,
  type TaskIndex,
  taskOfPlace,
  taskOfTarget,
} from "./task.ts"

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
 * A card record -> the flat value the places document stores under its id.
 * A thread's card has no text, so no command, fact or reason unsent.
 */
export const encodeCard = (card: CardRecord): StoredCardFields => ({
  owner: card.owner,
  ...placeFields(card.place),
  command:
    card.kind === "text" && card.carries.kind === "message"
      ? (card.carries.command ?? "")
      : "",
  fact:
    card.kind === "text" && card.carries.kind === "fact"
      ? encodeOfferFact(card.carries.fact)
      : "",
  unsent: card.kind === "text" ? (card.unsent ?? "") : "",
  placer: card.placer,
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
 * A stored card -> its record, of the kind its id says (`kindOfCard`);
 * undefined for one that is malformed, in a place its kind is never in, a
 * command or a fact this build does not know among them, or a fact with a
 * command. Total. Where it is is read by core's `placeOfFields`, as a move's
 * key on the wire is by `keyOfFields`. A record stored before facts has no
 * `fact`, and is a message. A kind of card this build does not hold yet is
 * left out.
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
    if (isThreadId(card))
      return place.kind === "canvas" || place.kind === "inventory"
        ? { kind: "thread", id: card, owner, place, placer }
        : undefined
    if (isNoteColumnId(card))
      return place.kind === "canvas"
        ? { kind: "note-column", id: card, owner, place, placer }
        : undefined
    if (!isTextCardId(card) || place.kind === "canvas") return undefined
    const carries = carriesOf(c.command, c.fact ?? "")
    if (carries === undefined) return undefined
    return {
      kind: "text",
      id: card,
      owner,
      place,
      placer,
      carries,
      unsent: c.unsent === "" ? null : c.unsent,
    }
  })

/**
 * Where a place kept at a thread's end resolves now: the end of the thread
 * its `at` is in (`threadAt`, `threadEnd`), so it follows its thread as the
 * thread grows. Null when `at` is in no thread.
 */
export function placeEnd(
  place: { readonly at: Position },
  index: TreeIndex,
): EntryId | null {
  if (place.at.kind !== "entry") return null
  const thread = threadAt(index, place.at.id)
  return thread === null ? null : threadEnd(index, thread)
}

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
const isOrdered = (place: CardPlace): place is OrderedPlace => "order" in place

/** The order of a place that has one, else "". */
const orderOf = (c: CardRecord): string =>
  isOrdered(c.place) ? c.place.order : ""

/** By `order`, then by id (S69). */
const byOrder = (a: CardRecord, b: CardRecord): number => {
  const [x, y] = [orderOf(a), orderOf(b)]
  if (x !== y) return x < y ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// ── note columns (ADR-0116) ────────────────────────────────────────────────

/** A note, with its place narrowed. */
export type NoteCard = TextCard & {
  readonly place: Extract<CardPlace, { kind: "note" }>
}

const isNote = (c: CardRecord): c is NoteCard =>
  c.kind === "text" && c.place.kind === "note"

/** A note column's notes, in order: by `order`, then id. */
export const notesIn = (
  cards: readonly CardRecord[],
  column: NoteColumnId,
): readonly NoteCard[] =>
  cards
    .filter(isNote)
    .filter(c => c.place.column === column)
    .sort(byOrder)

/** The title a note column made for a note with nowhere else to go has. */
export const NEW_NOTES_TITLE = "Notes"

/**
 * Where a card leaving a queue or pinned cards goes (ADR-0116), from
 * `canvas`, the cards of its task in order: the note column nearest the
 * card of `from`, the thread whose they were, or, with null, the task
 * column, which stands before every card (a card pinned to the task); the
 * one after on a tie. With none, a new one goes just after that card
 * (`make`, after canvas index `after`, -1 for first). `none` when the thread
 * is not on `canvas`. Pure.
 */
export function nearestNoteColumn(
  canvas: readonly CanvasCard[],
  from: ThreadId | null,
):
  | { readonly kind: "column"; readonly column: NoteColumnId }
  | { readonly kind: "make"; readonly after: number }
  | { readonly kind: "none" } {
  const at = from === null ? -1 : canvas.findIndex(c => c.id === from)
  if (from !== null && at < 0) return { kind: "none" }
  // Scanning left to right, a tie goes to the later: the one after.
  const nearest = canvas.reduce<{
    readonly column: NoteColumnId
    readonly distance: number
  } | null>((best, c, i) => {
    if (c.kind !== "note-column") return best
    const distance = Math.abs(i - at)
    return best === null || distance <= best.distance
      ? { column: c.id, distance }
      : best
  }, null)
  if (nearest !== null) return { kind: "column", column: nearest.column }
  return { kind: "make", after: at }
}

/**
 * Where a card's nearest notes are (ADR-0116), decided and not yet written:
 * a note column of its task; one to make there, at `order`, the canvas
 * cards `renumbered` to fit it; or, for a thread whose card is in an
 * inventory, that inventory (ADR-0117).
 */
export type NotesNear =
  | { readonly kind: "column"; readonly column: NoteColumnId }
  | {
      readonly kind: "make"
      readonly task: TaskId
      readonly order: string
      readonly renumbered: readonly CardRecord[]
    }
  | { readonly kind: "inventory"; readonly holder: WriterId }

/**
 * Where the notes nearest `to` are (`nearestNoteColumn` over its task's
 * canvas): a thread's, or a task's own; null for a thread with no card.
 * Decides, mints nothing. Pure.
 */
export function notesNear(
  cards: readonly CardRecord[],
  to: NotesTarget,
): NotesNear | null {
  const from = "thread" in to ? to.thread : null
  const card = from === null ? undefined : cards.find(c => c.id === from)
  if (card?.place.kind === "inventory")
    return { kind: "inventory", holder: card.place.holder }
  const task =
    "task" in to
      ? to.task
      : card?.place.kind === "canvas"
        ? card.place.task
        : null
  if (task === null) return null
  const canvas = canvasOf(cards, task)
  const near = nearestNoteColumn(canvas, from)
  switch (near.kind) {
    case "none":
      return null
    case "column":
      return { kind: "column", column: near.column }
    case "make": {
      // With no room there, the crowded cards are given new ranks.
      const ranked = rankAfter(canvas, near.after)
      return {
        kind: "make",
        task,
        order: ranked.order,
        renumbered: ranked.respaced,
      }
    }
  }
}

/**
 * A card sent to the notes nearest `to` (a thread's, or a task's own), as a
 * place, and the writes that go first: a note column made for it (its id
 * `newColumn`'s, owned and placed by `by`), and the canvas cards renumbered
 * to fit it. The one step every write to notes takes: a move's, an unsent
 * card's, a fresh column's followers'. Null for a thread with no card. Pure.
 */
export function toNotes(input: {
  readonly cards: readonly CardRecord[]
  readonly to: NotesTarget
  readonly newColumn: () => NoteColumnId
  readonly by: WriterId
}): {
  readonly place: Extract<TextPlace, { kind: "note" | "inventory" }>
  readonly first: readonly PlaceStep[]
} | null {
  const near = notesNear(input.cards, input.to)
  if (near === null) return null
  switch (near.kind) {
    case "inventory":
      return { place: { kind: "inventory", holder: near.holder }, first: [] }
    case "column":
      return { place: noteAt(input.cards, near.column), first: [] }
    case "make": {
      const column = input.newColumn()
      const made: CardRecord = {
        kind: "note-column",
        id: column,
        owner: input.by,
        placer: input.by,
        place: { kind: "canvas", task: near.task, order: near.order, width: 1 },
      }
      return {
        place: { kind: "note", column, order: orderAfter([]) },
        first: [...near.renumbered, made].map(record => ({
          kind: "write",
          record,
        })),
      }
    }
  }
}

/** A note at the end of `column`. */
const noteAt = (
  cards: readonly CardRecord[],
  column: NoteColumnId,
): Extract<CardPlace, { kind: "note" }> => ({
  kind: "note",
  column,
  order: orderAfter(notesIn(cards, column)),
})

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

// ── the queue (ADR-0048 step 3, S69) ──────────────────────────────────────

/** A queued card, with its place narrowed: only a text card is queued. */
export type QueuedCard = TextCard & {
  readonly place: Extract<CardPlace, { kind: "queued" }>
}

const isQueued = (c: CardRecord): c is QueuedCard =>
  c.place.kind === "queued" && isTextCard(c)

const isPinned = (
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
 * The next queued card to pop for a lane: none while it runs; else its top
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
    to: { kind: "notes", thread: card.place.thread },
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
const inventoryFull = (
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
 * What names a discard's history (ADR-0066, ADR-0116), the host's to decide:
 * the tasks, and the task the sender is on, for a card that leaves no task.
 */
export interface Discards {
  readonly tasks: TaskIndex
  readonly here: TaskId | null
}

/** For moves that discard nothing: a queueing, whose target is a queue. */
export const NO_DISCARDS: Discards = { tasks: NO_TASK_INDEX, here: null }

/**
 * The history a card leaving `from` for gone is in: the task it leaves,
 * else, from an inventory, the task its sender is on. Pure.
 */
export const discardHistory = (
  from: CardPlace,
  discards: Discards,
): TaskId | null => taskOfPlace(discards.tasks, from) ?? discards.here

/**
 * A key as the place it becomes, with what the host assigns to a queued or
 * pinned one, and a gone one's history (`discardHistory`). A pinned card goes after every pinned card in the session, not
 * only its thread's: a thread is found through the tree, which a handoff
 * does not read, and an order only has to grow within a thread.
 */
function placeAt(
  key: ResolvedTarget,
  cards: readonly CardRecord[],
  sender: WriterId,
  now: CardRecord | undefined,
  discards: Discards,
): CardPlace | undefined {
  switch (key.kind) {
    // At the rank it was given there (`planMoveTargets`), as wide as it was
    // on a canvas, else one column.
    case "canvas":
      return {
        kind: "canvas",
        task: key.task,
        order: key.order,
        width: now?.place.kind === "canvas" ? now.place.width : 1,
      }
    case "queued":
      return {
        ...key,
        order: orderAfter(queuedOn(cards, key.thread)),
        by: sender,
      }
    case "pinned":
      return { ...key, order: orderAfter(cards.filter(isPinned)) }
    // After the task's other pinned cards.
    case "task-pinned":
      return {
        ...key,
        order: orderAfter(taskPinnedOf(cards, key.task)),
      }
    case "note":
      return noteAt(
        cards.filter(c => c.id !== now?.id),
        key.column,
      )
    case "gone":
      return {
        ...key,
        task:
          now === undefined
            ? discards.here
            : discardHistory(now.place, discards),
        by: sender,
      }
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
  if (!fitsPlace(kindOfCard(card), to.kind)) return "no-place"
  if (!ownsPlace(to, sender)) return "not-yours"
  return to.kind === "inventory" && inventoryFull(cards, sender, card)
    ? "full"
    : null
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
  move: ResolvedMove,
  sender: WriterId,
  discards: Discards,
): MoveStep {
  const now = cards.find(c => c.id === move.card)
  if (move.from === null) {
    if (now !== undefined) return { kind: "refused", code: "exists", now }
    const refusal = refuseInto(move.to, cards, move.card, sender)
    if (refusal !== null) return { kind: "refused", code: refusal, now: null }
    const place = placeAt(move.to, cards, sender, undefined, discards)
    // A move makes a text card, or a note column on a canvas: a thread's
    // card is the host's to make, with its thread's first message.
    if (place === undefined)
      return { kind: "refused", code: "no-place", now: null }
    if (isNoteColumnId(move.card))
      return place.kind === "canvas"
        ? {
            kind: "write",
            record: {
              kind: "note-column",
              id: move.card,
              owner: sender,
              place,
              placer: sender,
            },
          }
        : { kind: "refused", code: "no-place", now: null }
    if (!isTextCardId(move.card) || place.kind === "canvas")
      return { kind: "refused", code: "no-place", now: null }
    return {
      kind: "write",
      record: {
        kind: "text",
        id: move.card,
        owner: sender,
        place,
        placer: sender,
        carries: PLAIN,
        unsent: null,
      },
    }
  }
  if (now === undefined || now.place.kind === "gone")
    return { kind: "refused", code: "gone", now: null }
  // A fact is the host's, on its way into the thread: nobody moves it.
  if (isFact(now)) return { kind: "refused", code: "fact", now }
  if (!seenAt(keyOf(now.place), move.from))
    return { kind: "refused", code: "moved", now }
  // A move to where the card is would requeue it last, under its sender's
  // name: a card changes its place in line by a reorder (`planReorder`).
  if (sameKey(move.from, move.to))
    return { kind: "refused", code: "moved", now }
  if (!ownsPlace(move.from, sender))
    return { kind: "refused", code: "not-yours", now }
  const refusal = refuseInto(move.to, cards, move.card, sender)
  if (refusal !== null) return { kind: "refused", code: refusal, now }
  const place = placeAt(move.to, cards, sender, now, discards)
  const record = place === undefined ? undefined : placed(now, place)
  if (record === undefined) return { kind: "refused", code: "no-place", now }
  return {
    kind: "write",
    record:
      record.kind === "text"
        ? {
            ...record,
            placer: sender,
            unsent: move.to.kind === "queued" ? null : record.unsent,
          }
        : { ...record, placer: sender },
  }
}

// ── reorders (ADR-0048 step 7) ─────────────────────────────────────────────

/**
 * How a reorder works in one kind of place (ADR-0048 step 7, ADR-0116).
 * `siblings` are the cards a card there moves among, in order, itself
 * included; `adjacent`, whether its two neighbours must still be next to
 * each other there; `passesFacts`, whether it may pass a fact.
 */
interface ReorderRule<K extends ReorderAt["kind"]> {
  readonly siblings: (
    cards: readonly CardRecord[],
    at: Extract<ReorderAt, { readonly kind: K }>,
  ) => readonly CardRecord[]
  readonly adjacent: boolean
  readonly passesFacts: boolean
}

/**
 * Every place a reorder moves a card among (`REORDER_PLACES`), each with
 * its rule: a row for each, so a place added to that list does not compile
 * until its rule is written here.
 *
 * - A queue: its lane's queued cards, the two neighbours next to each
 *   other, and no passing a fact, which says what already happened.
 * - Pinned cards: every pinned card in the session, since pinned keys are
 *   the session's (`placeAt`). A thread's pinned cards are found through
 *   the tree, which this does not read, so other threads' may sit between
 *   two pinned neighbours: they need not be adjacent here.
 * - A task's pinned cards (ADR-0116): its own, the neighbours next to each
 *   other.
 * - A note column: its notes, the neighbours next to each other.
 * - A canvas: its task's cards (`canvasOf`), the neighbours next to each
 *   other.
 */
export const REORDERS: { readonly [K in ReorderAt["kind"]]: ReorderRule<K> } = {
  queued: {
    siblings: (cards, at) => queuedOn(cards, at.thread),
    adjacent: true,
    passesFacts: false,
  },
  pinned: {
    siblings: cards => cards.filter(isPinned).sort(byOrder),
    adjacent: false,
    passesFacts: true,
  },
  "task-pinned": {
    siblings: (cards, at) => taskPinnedOf(cards, at.task),
    adjacent: true,
    passesFacts: true,
  },
  note: {
    siblings: (cards, at) => notesIn(cards, at.column),
    adjacent: true,
    passesFacts: true,
  },
  canvas: {
    siblings: (cards, at) => canvasOf(cards, at.task),
    adjacent: true,
    passesFacts: true,
  },
}

/** The rule for a reorder at `at` (`REORDERS`). */
const reorderRule = (
  at: ReorderAt,
): {
  readonly siblings: (
    cards: readonly CardRecord[],
    at: ReorderAt,
  ) => readonly CardRecord[]
  readonly adjacent: boolean
  readonly passesFacts: boolean
} =>
  // Each row takes its own kind of key, and `at` is that kind's.
  REORDERS[at.kind] as ReorderRule<ReorderAt["kind"]> & {
    readonly siblings: (
      cards: readonly CardRecord[],
      at: ReorderAt,
    ) => readonly CardRecord[]
  }

/** `card` with order `order`, everything else as it is. */
const withOrder = (card: CardRecord, order: string): CardRecord =>
  isOrdered(card.place)
    ? (placed(card, { ...card.place, order }) ?? card)
    : card

/**
 * A reorder: a queued or pinned card, a note, or a card on a canvas, moved
 * among its neighbours, as its sender saw them (ADR-0048, *Physics* 5,
 * ADR-0116), by its place's rule (`REORDERS`). Only its order changes: its
 * placer, its queuer, its text's version, why it was not sent and its width
 * stay, so nobody's trace or history changes with it. Refused:
 * - `gone`: no card;
 * - `fact`: a fact, or a card that would pass one where its rule forbids it;
 * - `moved`: the card is no longer where its sender saw it;
 * - `order-changed`: it names no neighbour, a neighbour is no longer among
 *   its siblings, or, where its rule says so, the two are no longer next to
 *   each other.
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
  if (isFact(now)) return { kind: "refused", code: "fact", now }
  if (!sameKey(keyOf(now.place), reorder.at))
    return { kind: "refused", code: "moved", now }
  const changed: MoveStep = { kind: "refused", code: "order-changed", now }
  const rule = reorderRule(reorder.at)
  const siblings = rule.siblings(cards, reorder.at).filter(c => c.id !== now.id)
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
  if (rule.adjacent) {
    if (siblings[index - 1]?.id !== (reorder.after ?? undefined)) return changed
    if (siblings[index]?.id !== (reorder.before ?? undefined)) return changed
  }
  if (!rule.passesFacts) {
    // The cards it passes, from where it was to where it goes.
    const was = siblings.findIndex(c => byOrder(now, c) < 0)
    const from = was < 0 ? siblings.length : was
    const passed =
      index < from ? siblings.slice(index, from) : siblings.slice(from, index)
    if (passed.some(isFact)) return { kind: "refused", code: "fact", now }
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
 * A card's width on its canvas (ADR-0116): one column or two, from where its
 * sender saw it (`at`), a compare-and-set as a reorder is. Only its width
 * changes: its rank and its placer stay, so nobody's trace or history of
 * the card changes with it. Refused `gone` with no card, and `moved` once
 * it is not on the canvas its sender saw. Null when it has that width
 * already: nothing to write. Pure.
 */
export function planWidth(
  cards: readonly CardRecord[],
  change: {
    readonly card: CardId
    readonly at: CanvasKey
    readonly width: CardWidth
  },
): MoveStep | null {
  const now = cards.find(c => c.id === change.card)
  if (now === undefined) return { kind: "refused", code: "gone", now: null }
  if (now.place.kind !== "canvas" || !sameKey(keyOf(now.place), change.at))
    return { kind: "refused", code: "moved", now }
  if (now.place.width === change.width) return null
  const record = placed(now, { ...now.place, width: change.width })
  return record === undefined
    ? { kind: "refused", code: "no-place", now }
    : { kind: "write", record }
}

/**
 * What a fresh column's first send does to the column's other cards: each
 * becomes a note in the note column nearest `thread` (`notesOf`, ADR-0116),
 * the thread the send started, made in this step when its task has none.
 * The column has become that thread's, and a card left fresh under its key
 * would be drawn nowhere. The host's write, not a person's move, so each
 * card keeps its placer, as `planUnsent` does. Nothing when the sent card was
 * not fresh, its column is in another root than the message, or the thread
 * has no card yet. Pure.
 */
export function planFreshFollow(input: {
  readonly cards: readonly CardRecord[]
  readonly sent: CardId
  readonly root: RootId
  readonly thread: ThreadId
  /** Mints the id of a note column made for them. */
  readonly newColumn: () => NoteColumnId
  /** Who sent it: a note column made here is theirs. */
  readonly by: WriterId
}): readonly PlaceStep[] {
  const { cards, thread } = input
  const place = cards.find(c => c.id === input.sent)?.place
  if (place?.kind !== "fresh" || place.root !== input.root) return []
  const steps: PlaceStep[] = []
  let now = cards
  for (const c of cards.filter(isTextCard)) {
    if (
      c.id === input.sent ||
      c.place.kind !== "fresh" ||
      c.place.column !== place.column
    )
      continue
    const notes = toNotes({
      cards: now,
      to: { kind: "notes", thread },
      newColumn: input.newColumn,
      by: input.by,
    })
    if (notes === null) return steps
    for (const step of [
      ...notes.first,
      { kind: "write", record: { ...c, place: notes.place } } as const,
    ]) {
      steps.push(step)
      now = afterStep(now, step)
    }
  }
  return steps
}

/**
 * Moves with a target that is no place yet, resolved to places before any is
 * planned (ADR-0116), each against the cards as the ones before it left
 * them, so a column made for the first takes the rest:
 *
 * - a thread's nearest notes (`notes`, `noteOf`), through `toNotes`, a note
 *   column made for it written first; refused `no-place`, naming the card,
 *   for a thread with no card;
 * - a spot on a canvas (`canvas-at`), ranked just after its `after` there,
 *   or at the end when that card is no longer on the canvas (`rankAfter`),
 *   the cards given new ranks to make room written first.
 *
 * Pure.
 */
export function planMoveTargets(input: {
  readonly cards: readonly CardRecord[]
  readonly moves: readonly Move[]
  readonly sender: WriterId
  /** Mints the id of a note column made for them. */
  readonly newColumn: () => NoteColumnId
}):
  | {
      readonly kind: "resolved"
      readonly moves: readonly ResolvedMove[]
      /** What is written before the moves: each column made, and the canvas re-ranked for it. */
      readonly first: readonly PlaceStep[]
    }
  | Extract<MoveStep, { kind: "refused" }> {
  const first: PlaceStep[] = []
  const moves: ResolvedMove[] = []
  let now = input.cards
  for (const move of input.moves) {
    const { to } = move
    switch (to.kind) {
      case "notes": {
        const notes = toNotes({
          cards: now,
          to,
          newColumn: input.newColumn,
          by: input.sender,
        })
        if (notes === null)
          return {
            kind: "refused",
            code: "no-place",
            now: now.find(c => c.id === move.card) ?? null,
          }
        first.push(...notes.first)
        now = afterSteps(now, notes.first)
        const { place } = notes
        moves.push({
          ...move,
          to:
            place.kind === "note"
              ? { kind: "note", column: place.column }
              : place,
        })
        break
      }
      // Every card onto a canvas is ranked here: a canvas's key alone, at
      // its end.
      case "canvas":
      case "canvas-at": {
        const canvas = canvasOf(now, to.task).filter(c => c.id !== move.card)
        const ranked =
          to.kind === "canvas-at"
            ? rankOfDrop(canvas, to.after)
            : rankAfter(canvas, canvas.length - 1)
        const steps = ranked.respaced.map(
          (record): PlaceStep => ({ kind: "write", record }),
        )
        first.push(...steps)
        now = afterSteps(now, steps)
        moves.push({
          ...move,
          to: { kind: "canvas", task: to.task, order: ranked.order },
        })
        break
      }
      default:
        moves.push({ ...move, to })
    }
  }
  return { kind: "resolved", moves, first }
}

/**
 * Moves as a person sends them: each target that is no place yet resolved
 * first (`planMoveTargets`), what that writes written before the moves, then
 * planned whole (`planMoveCommand`). Pure.
 */
export function planMoveRequest(
  cards: readonly CardRecord[],
  moves: readonly Move[],
  sender: WriterId,
  running: (lane: ThreadId) => boolean,
  discards: Discards,
  newColumn: () => NoteColumnId,
): { readonly step: MovesStep; readonly drain: readonly ThreadId[] } {
  const resolved = planMoveTargets({ cards, moves, sender, newColumn })
  if (resolved.kind === "refused") return { step: resolved, drain: [] }
  const { step, drain } = planMoveCommand(
    afterSteps(cards, resolved.first),
    resolved.moves,
    sender,
    running,
    discards,
  )
  return {
    step:
      step.kind === "steps"
        ? { kind: "steps", steps: [...resolved.first, ...step.steps] }
        : step,
    drain,
  }
}

/** What the host makes of several moves: every step, or the first refusal. */
export type MovesStep =
  | { readonly kind: "steps"; readonly steps: readonly PlaceStep[] }
  | Extract<MoveStep, { kind: "refused" }>

/** `cards` as `steps` leave them, in order. Pure. */
export const afterSteps = (
  cards: readonly CardRecord[],
  steps: readonly PlaceStep[],
): readonly CardRecord[] => steps.reduce(afterStep, cards)

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
  moves: readonly ResolvedMove[],
  sender: WriterId,
  discards: Discards,
): MovesStep {
  const steps: PlaceStep[] = []
  let now = cards
  for (const move of moves) {
    const step = planMove(now, move, sender, discards)
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
  moves: readonly ResolvedMove[],
  sender: WriterId,
  running: (lane: ThreadId) => boolean,
  discards: Discards,
): { readonly step: MovesStep; readonly drain: readonly ThreadId[] } {
  const step = planMoves(cards, moves, sender, discards)
  if (step.kind === "refused") return { step, drain: [] }
  const lanes = step.steps.flatMap(s =>
    s.kind === "write" && s.record.place.kind === "queued"
      ? [s.record.place.thread]
      : [],
  )
  return { step, drain: [...new Set(lanes)].filter(l => !running(l)) }
}

// ── moves' history (ADR-0066) ─────────────────────────────────────────────

/**
 * The task whose history of the sender's moves `moves` enter, or null for
 * none (ADR-0066, ADR-0116). A creation enters none (a composer's new card,
 * a copy) but a note column's, which enters its canvas's task. Otherwise the task the card goes to, when it goes to one, else the
 * task it leaves, read from its record, since the host accepts a move only
 * from where the card is. So a take into the inventory is recorded where it
 * left, a put where it went, a drag across tasks where it went, and a
 * discard where its gone place goes (`discardHistory`), which the page does not
 * name (ADR-0066). Of several, the first that names a task names the
 * step's. A place at a thread, or a thread's nearest notes, is in its
 * thread's task, a spot on a canvas in its canvas's (`taskOfTarget`). Pure.
 */
export function historyOf(
  moves: readonly Move[],
  cards: readonly CardRecord[],
  discards: Discards,
): TaskId | null {
  const taskOf = (to: CardPlace | MoveTarget) =>
    taskOfTarget(discards.tasks, to)
  for (const move of moves) {
    // A note column made is in its task's history, so the undo key takes
    // it back; a card made in a composer or a queue is in none.
    if (move.from === null)
      return isNoteColumnId(move.card) ? taskOf(move.to) : null
    const from = cards.find(c => c.id === move.card)?.place
    const task =
      from === undefined
        ? null
        : move.to.kind === "gone"
          ? discardHistory(from, discards)
          : (taskOf(move.to) ?? taskOf(from))
    if (task !== null) return task
  }
  return null
}

/** How long an archived task's histories are kept (ADR-0066). */
const ARCHIVED_HISTORY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The histories of moves to retire (ADR-0066): those of a task archived
 * `ARCHIVED_HISTORY_MS` ago or longer; and, at startup only, those of a
 * task the session does not hold (a new tab that never sent, or a task
 * gone). An id that names no task is left. After a run's end that second
 * rule would retire the history of a new tab open now. `stored` is every
 * stored `moves:` document. Pure.
 */
export function planHistorySweep(input: {
  readonly stored: readonly string[]
  readonly tasks: ReadonlySet<TaskId>
  readonly archived: ReadonlyMap<TaskId, ArchivedTask>
  readonly now: number
  readonly startup: boolean
}): readonly string[] {
  return input.stored.filter(docId => {
    const of = movesOfDocId(docId)
    if (of === undefined) return false
    if (!input.tasks.has(of.task)) return input.startup
    const archived = input.archived.get(of.task)
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

/**
 * The cards `parts` wrote in the places document `placesId`, each once.
 * Read from a stack's `top` before an undo, they are the cards that undo
 * would move (S139). Pure.
 */
export function cardsOfParts(
  parts: readonly StepPart[],
  placesId: string,
): readonly CardId[] {
  const ids = parts
    .filter(p => p.docId === placesId)
    .flatMap(p => p.footprint)
    .flatMap(path => {
      const card =
        path[0] === "cards" && path[1] !== undefined
          ? parseCardId(path[1])
          : undefined
      return card === undefined ? [] : [card]
    })
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
  if (now === undefined) return { kind: "refused", code: "gone", now: null }
  if (now.kind !== "text") return { kind: "refused", code: "no-place", now }
  return now.carries.kind === "fact"
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
  // A thread's card has no text, and is never swept for its lack of one.
  const records = input.cards
    .filter(isTextCard)
    .filter(
      c =>
        c.carries.kind === "message" &&
        c.carries.command === null &&
        (input.texts.get(c.id) ?? "") === "",
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
