// moves — a card's handoffs between places (ADR-0059): whether the host
// accepts a move, where a target resolves to, and the steps a command's
// moves make.

import {
  type CanvasKey,
  type CanvasTarget,
  type CardId,
  type CardPlace,
  type CardRecord,
  fitsPlace,
  isNoteColumnId,
  isTextCard,
  isTextCardId,
  KINDS,
  keyOf,
  kindOfCard,
  type Move,
  type MoveRefusal,
  makeCard,
  NO_CONTENT,
  type NoteColumnId,
  type PlaceKey,
  placed,
  type RankedCanvas,
  type ResolvedMove,
  type ResolvedTarget,
  type RootId,
  sameKey,
  seenAt,
  type TaskId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import { noteAt, toNotes } from "./notes.ts"
import { orderAfter } from "./order.ts"
import { inventoryFull, isPinned, queuedOn, taskPinnedOf } from "./queue.ts"
import { rankAfter, rankOfDrop } from "./rank.ts"
import { canvasOf, NO_TASK_INDEX, type TaskIndex, taskOfPlace } from "./task.ts"

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

/** What the host makes of a card made: its write, or a refusal. */
export type MakeStep = Extract<MoveStep, { readonly kind: "write" | "refused" }>

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

/**
 * Why a move into `to` is refused before the card is looked at; null for
 * none. A kind no person moves (`KINDS`' `moves`: a fact) and a place the
 * card's kind is never in are refused alike, `no-place`.
 */
function refuseInto(
  to: PlaceKey,
  cards: readonly CardRecord[],
  card: CardId,
  sender: WriterId,
): MoveRefusal | null {
  const kind = kindOfCard(card)
  if (!KINDS[kind].moves || !fitsPlace(kind, to.kind)) return "no-place"
  if (!ownsPlace(to, sender)) return "not-yours"
  return to.kind === "inventory" && inventoryFull(cards, sender, card)
    ? "full"
    : null
}

/**
 * Whether the host writes `card`, made (`makeCard`): the one rule every card
 * is made by, a person's or the host's (ADR-0126). Refused `exists` for an
 * id in use, else as any move into its place is (`refuseInto`: a kind no
 * person moves, someone else's inventory, a full one); the host makes the
 * kinds no person moves, so its own make is refused only for a full
 * inventory. Its place fits its kind by its type, so a misplaced card never
 * reaches this. `planMove`'s creations, a copy's card (`planCopy`), a
 * thread's card, a note column made for a note, a fact's card and a
 * split's card all go through it, so their refusals cannot drift. Pure.
 */
export function planMake(
  cards: readonly CardRecord[],
  card: CardRecord,
  sender: WriterId | "host",
): MakeStep {
  const now = cards.find(c => c.id === card.id)
  if (now !== undefined) return { kind: "refused", code: "exists", now }
  const to = keyOf(card.place)
  const refusal =
    sender === "host"
      ? to.kind === "inventory" && inventoryFull(cards, to.holder, card.id)
        ? "full"
        : null
      : refuseInto(to, cards, card.id, sender)
  return refusal === null
    ? { kind: "write", record: card }
    : { kind: "refused", code: refusal, now: null }
}

/**
 * A card a person's move makes at `place`, of the kind its id says: a text
 * card with no command, or a note column on a canvas; undefined for any
 * other kind, or a place its kind is never in.
 */
function madeAt(
  card: CardId,
  place: CardPlace,
  sender: WriterId,
): CardRecord | undefined {
  if (isTextCardId(card) && place.kind !== "canvas")
    return makeCard(
      "text",
      card,
      place,
      { command: null, unsent: null },
      sender,
    )
  if (isNoteColumnId(card) && place.kind === "canvas")
    return makeCard("note-column", card, place, NO_CONTENT, sender)
  return undefined
}

/**
 * A handoff: a compare-and-set on where the card is. The host accepts a move
 * only if the card is still where its sender saw it; someone else's reorder
 * since does not count as moving it (`sameKey`). A move to where the card is
 * already is refused `moved`: `planReorder` changes a place in line. Every
 * accepted move names its sender as the card's placer. Pure.
 *
 * - No `from`: the card is created, its sender its owner, with no command
 *   (`planMake`).
 * - A fact is the host's (ADR-0080): no person moves its kind (`KINDS`),
 *   so every move of it is refused `no-place`.
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
    // A move makes a text card, or a note column on a canvas: a thread's
    // card is the host's to make, with its thread's first message or a
    // copy (`planCopy`), and a fact's with its fact (`planFactCard`).
    const place = placeAt(move.to, cards, sender, undefined, discards)
    const made =
      place === undefined ? undefined : madeAt(move.card, place, sender)
    return made === undefined
      ? { kind: "refused", code: "no-place", now: null }
      : planMake(cards, made, sender)
  }
  if (now === undefined || now.place.kind === "gone")
    return { kind: "refused", code: "gone", now: null }
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
      record.kind === "text" && move.to.kind === "queued"
        ? {
            ...record,
            placer: sender,
            content: { ...record.content, unsent: null },
          }
        : { ...record, placer: sender },
  }
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
      to: { kind: "notes", near: "thread", thread },
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
        const ranked = rankOnCanvas(now, move.card, to)
        first.push(...ranked.first)
        now = afterSteps(now, ranked.first)
        moves.push({ ...move, to: ranked.to })
        break
      }
      default:
        moves.push({ ...move, to })
    }
  }
  return { kind: "resolved", moves, first }
}

/**
 * Where `card` lands on a canvas (ADR-0116): just after a drop's `after`,
 * at the end when that card is no longer there or for a canvas's key alone,
 * with the cards given new ranks to make room, written first. Pure.
 */
export function rankOnCanvas(
  cards: readonly CardRecord[],
  card: CardId,
  to: CanvasKey | CanvasTarget,
): { readonly to: RankedCanvas; readonly first: readonly PlaceStep[] } {
  const canvas = canvasOf(cards, to.task).filter(c => c.id !== card)
  const ranked =
    to.kind === "canvas-at"
      ? rankOfDrop(canvas, to.after)
      : rankAfter(canvas, canvas.length - 1)
  return {
    to: { kind: "canvas", task: to.task, order: ranked.order },
    first: ranked.respaced.map(
      (record): PlaceStep => ({ kind: "write", record }),
    ),
  }
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
): MoveCommand {
  const resolved = planMoveTargets({ cards, moves, sender, newColumn })
  if (resolved.kind === "refused") return REFUSED(resolved)
  const command = planMoveCommand(
    afterSteps(cards, resolved.first),
    resolved.moves,
    sender,
    running,
    discards,
  )
  const { step } = command
  return {
    ...command,
    step:
      step.kind === "steps"
        ? { kind: "steps", steps: [...resolved.first, ...step.steps] }
        : step,
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

/** What a command's moves do: its steps, and the lanes they leave to drain. */
export interface MoveCommand {
  readonly step: MovesStep
  /**
   * The lanes to drain, those not running: each a move leaves a card queued
   * on, and each thread put from an inventory onto a canvas.
   */
  readonly drain: readonly ThreadId[]
}

/** A command that moves nothing. */
const REFUSED = (step: MovesStep): MoveCommand => ({ step, drain: [] })

/** Moves and what follows them (`MoveCommand`). Pure. */
export function planMoveCommand(
  cards: readonly CardRecord[],
  moves: readonly ResolvedMove[],
  sender: WriterId,
  running: (lane: ThreadId) => boolean,
  discards: Discards,
): MoveCommand {
  const step = planMoves(cards, moves, sender, discards)
  if (step.kind === "refused") return REFUSED(step)
  const was = new Map(cards.map(c => [c.id, c.place.kind] as const))
  // A card queued, or a thread put out of an inventory, whose queue waited
  // there (ADR-0124).
  const lanes = step.steps.flatMap(s => {
    if (s.kind !== "write") return []
    const { record } = s
    if (record.place.kind === "queued") return [record.place.thread]
    return record.kind === "thread" &&
      record.place.kind !== "inventory" &&
      was.get(record.id) === "inventory"
      ? [record.id]
      : []
  })
  return {
    step,
    drain: [...new Set(lanes)].filter(l => !running(l)),
  }
}
