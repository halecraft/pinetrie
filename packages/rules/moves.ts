// moves — a card's handoffs between places (ADR-0059): whether the host
// accepts a move, where a target resolves to, and the steps a command's
// moves make.

import {
  type CanvasKey,
  type CanvasTarget,
  type CardId,
  type CardPlace,
  type CardRecord,
  DISCARDED,
  type EntryId,
  fitsPlace,
  isNoteColumnId,
  isTextCardId,
  KINDS,
  keyOf,
  kindOfCard,
  type Move,
  type MoveRefusal,
  makeCard,
  NO_CONTENT,
  type NoteColumnId,
  type Paste,
  type PlaceKey,
  placed,
  placeOfKind,
  type RankedCanvas,
  type Replacing,
  type ResolvedMove,
  type ResolvedTarget,
  sameKey,
  seenAt,
  type TaskId,
  type ThreadId,
  type WriterId,
  wrapperKind,
} from "@pinetrie/core"
import { marginEnd } from "./margin.ts"
import { makeNoteColumn, noteAt, toNotes } from "./notes.ts"
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
    case "margin":
      return marginEnd(
        cards.filter(c => c.id !== now?.id),
        key.entry,
        key.thread,
      )
    case "trash":
      return {
        ...key,
        holder: sender,
        task:
          now === undefined
            ? discards.here
            : discardHistory(now.place, discards),
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
  if (isTextCardId(card) && place.kind !== "canvas" && place.kind !== "board")
    return makeCard(
      "text",
      card,
      place,
      { command: null, unsent: null, origin: null },
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
 * - To a trash: a discard (ADR-0111), from any place the sender may move
 *   out of. A card in a trash moves only by an undo, which is no handoff,
 *   or by its cutter's paste (`planUncut`): a move out of a trash is
 *   refused `gone`.
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
  if (now === undefined || now.place.kind === "trash")
    return { kind: "refused", code: "gone", now: null }
  return handoff(cards, now, { ...move, from: move.from }, sender, discards)
}

/**
 * A cut card moved out of its cutter's trash to `move.to` (ADR-0132): the
 * first paste after a cut. Only the sender's own trash gives a card back
 * this way; one in someone else's trash, or in none, is refused `gone`.
 * Then it is a handoff as any move is. Pure.
 */
export function planUncut(
  cards: readonly CardRecord[],
  move: ResolvedMove,
  sender: WriterId,
  discards: Discards,
): MoveStep {
  const now = cards.find(c => c.id === move.card)
  if (
    now === undefined ||
    now.place.kind !== "trash" ||
    now.place.holder !== sender
  )
    return { kind: "refused", code: "gone", now: null }
  return handoff(cards, now, { ...move, from: DISCARDED }, sender, discards)
}

/** `planMove`'s and `planUncut`'s checks once each has found the card where it may leave. */
function handoff(
  cards: readonly CardRecord[],
  now: CardRecord,
  move: ResolvedMove & { readonly from: PlaceKey },
  sender: WriterId,
  discards: Discards,
): MoveStep {
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
 * A paste (ADR-0132), as one step of its sender's history: the card it
 * replaces discarded first (ADR-0133), so a replacement in a full inventory
 * never meets `full`; then the card made where `move` sends it (a text
 * card keeping its origin, or a reference), or the cut card moved out of
 * the sender's trash (`planUncut`). A card made in the place of the one it
 * replaces takes that very place (its rank in a note column or a queue): an
 * edit as text keeps the reference's spot. Refused as the discard, the
 * make or the move would be. Pure.
 */
export function planPaste(
  cards: readonly CardRecord[],
  paste: Paste,
  move: ResolvedMove,
  replacing: Replacing | null,
  sender: WriterId,
  discards: Discards,
): MovesStep {
  const old =
    replacing === null ? undefined : cards.find(c => c.id === replacing.card)
  const discard =
    replacing === null
      ? null
      : planMove(
          cards,
          { card: replacing.card, from: replacing.from, to: DISCARDED },
          sender,
          discards,
        )
  if (discard?.kind === "refused") return discard
  const before = discard === null ? cards : afterStep(cards, discard)
  if (paste.kind === "uncut") {
    const step = planUncut(
      before,
      { ...move, card: paste.card },
      sender,
      discards,
    )
    if (step.kind === "refused") return step
    return {
      kind: "steps",
      steps: [...(discard === null ? [] : [discard]), step],
    }
  }
  const place =
    old !== undefined && sameKey(keyOf(old.place), move.to)
      ? old.place
      : placeAt(move.to, before, sender, undefined, discards)
  const made =
    place === undefined ? undefined : pastedCard(paste, place, sender)
  if (made === undefined)
    return { kind: "refused", code: "no-place", now: null }
  const step = planMake(before, made, sender)
  if (step.kind === "refused") return step
  return {
    kind: "steps",
    steps: [...(discard === null ? [] : [discard]), step],
  }
}

/**
 * The card a paste makes at `place` (ADR-0132): the host's make, and the
 * page's draw of it until the host answers. Undefined for a place its kind
 * is never in. Pure.
 */
export function pastedCard(
  paste: Exclude<Paste, { readonly kind: "uncut" }>,
  place: CardPlace,
  sender: WriterId,
): CardRecord | undefined {
  switch (paste.kind) {
    case "text": {
      const at = placeOfKind("text", place)
      return at === undefined
        ? undefined
        : makeCard(
            "text",
            paste.card,
            at,
            { command: null, unsent: null, origin: paste.origin },
            sender,
          )
    }
    case "reference": {
      const at = placeOfKind("reference", place)
      return at === undefined
        ? undefined
        : makeCard(
            "reference",
            paste.card,
            at,
            { address: paste.address, quote: paste.quote },
            sender,
          )
    }
  }
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
 *   the cards given new ranks to make room written first. A card of a kind
 *   no canvas takes lands in the container its kind is made in there
 *   (`WRAPS`): a text card or a reference as the first note of a note
 *   column made at that rank, written first.
 *
 * A move into an entry's margin (ADR-0126) is refused `no-place` unless the
 * margin names the thread its entry is in (`entryThreads`): a margin's task
 * is read from its thread, so one naming another would put a comment in
 * the wrong task. A move onto the board is refused `no-place`: only the
 * board's own move places a task's card.
 *
 * Pure.
 */
export function planMoveTargets(input: {
  readonly cards: readonly CardRecord[]
  readonly moves: readonly Move[]
  readonly sender: WriterId
  /** Mints the id of a note column made for them. */
  readonly newColumn: () => NoteColumnId
  /** The thread of each entry a move's margin names, as its root's index says; absent for one not found. */
  readonly entryThreads: ReadonlyMap<EntryId, ThreadId>
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
        const kind = kindOfCard(move.card)
        const wrap = fitsPlace(kind, "canvas") ? null : wrapperKind(kind)
        if (wrap === null) {
          moves.push({ ...move, to: ranked.to })
          break
        }
        // Each container a kind is made in (`WRAPS`) is made here: a new
        // one does not compile until it is.
        const made =
          wrap === "note-column"
            ? makeNoteColumn(
                now,
                input.newColumn(),
                { ...ranked.to, width: 1 },
                input.sender,
              )
            : (wrap satisfies never)
        if (made === null)
          return {
            kind: "refused",
            code: "no-place",
            now: now.find(c => c.id === move.card) ?? null,
          }
        first.push(made.step)
        now = afterSteps(now, [made.step])
        moves.push({ ...move, to: { kind: "note", column: made.place.column } })
        break
      }
      case "margin":
        if (input.entryThreads.get(to.entry) !== to.thread)
          return {
            kind: "refused",
            code: "no-place",
            now: now.find(c => c.id === move.card) ?? null,
          }
        moves.push({ ...move, to })
        break
      // No person's move takes a task's card (`KINDS`): the board's own
      // move places it (`planBoardMove`).
      case "board":
        return {
          kind: "refused",
          code: "no-place",
          now: now.find(c => c.id === move.card) ?? null,
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
  entryThreads: ReadonlyMap<EntryId, ThreadId>,
): MoveCommand {
  const resolved = planMoveTargets({
    cards,
    moves,
    sender,
    newColumn,
    entryThreads,
  })
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
  return { step, drain: lanesToDrain(cards, step.steps, running) }
}

/**
 * The lanes `steps` leave to drain, those not running: each a step leaves
 * a card queued on (a move's, or a reference made there), and each thread
 * put out of an inventory, whose queue waited there (ADR-0124). Pure.
 */
export function lanesToDrain(
  cards: readonly CardRecord[],
  steps: readonly PlaceStep[],
  running: (lane: ThreadId) => boolean,
): readonly ThreadId[] {
  const was = new Map(cards.map(c => [c.id, c.place.kind] as const))
  const lanes = steps.flatMap(s => {
    if (s.kind !== "write") return []
    const { record } = s
    if (record.place.kind === "queued") return [record.place.thread]
    return record.kind === "thread" &&
      record.place.kind !== "inventory" &&
      was.get(record.id) === "inventory"
      ? [record.id]
      : []
  })
  return [...new Set(lanes)].filter(l => !running(l))
}
