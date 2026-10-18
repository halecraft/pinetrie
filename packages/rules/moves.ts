// moves — a card's handoffs between places: whether the host accepts a move,
// where a target resolves to, and the steps a command's moves make.

import {
  type CardId,
  type CardPlace,
  type CardRecord,
  DISCARDED,
  type EntryId,
  fitsPlace,
  isNoteColumnId,
  isTextCardId,
  isWhereSenderSaw,
  kindOfCard,
  type LivePlace,
  type Move,
  type MoveRefusal,
  makeCard,
  NO_CONTENT,
  type NoteColumnId,
  ownerCard,
  type Paste,
  type PlaceKey,
  placed,
  placeKey,
  placeOfKind,
  type Replacing,
  type ResolvedMove,
  type ResolvedTarget,
  sameKey,
  surfaceOwner,
  type ThreadId,
  type WriterId,
  wrapperKind,
} from "@pinetrie/core"
import type { Workflow } from "./board.ts"
import { planCanvasOpening, rankOnCanvas } from "./canvas-index.ts"
import { marginEnd } from "./margin.ts"
import { makeNoteColumn, noteColumnEnd, toNotes } from "./notes.ts"
import { orderAfter } from "./order.ts"
import {
  afterSteps,
  type MoveStep,
  ownsPlace,
  type PlaceStep,
  placeRefusal,
  planMake,
} from "./place-steps.ts"
import { canvasPinnedCards, isPinned, queuedOn } from "./queue.ts"

// ── handoffs ───────────────────────────────────────────────────

/**
 * A key as the place it becomes, with what the host assigns to a queued or
 * pinned one, and a trashed one's place left. A pinned card goes after every pinned card in the session, not
 * only its thread's: a thread is found through the tree, which a handoff
 * does not read, and an order only has to grow within a thread.
 */
function placeAt(
  key: ResolvedTarget,
  cards: readonly CardRecord[],
  sender: WriterId,
  now: CardRecord | undefined,
): CardPlace | undefined {
  switch (key.kind) {
    // At the rank it was given there (`planMoveTargets`), as wide as it was
    // on a canvas, else one column.
    case "canvas":
      return {
        kind: "canvas",
        canvas: key.canvas,
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
    // After the canvas's other pinned cards.
    case "canvas-pinned":
      return {
        ...key,
        order: orderAfter(canvasPinnedCards(cards, key.canvas)),
      }
    case "note":
      return noteColumnEnd(
        cards.filter(c => c.id !== now?.id),
        key.column,
      )
    case "margin":
      return marginEnd(
        cards.filter(c => c.id !== now?.id),
        key.entry,
        key.thread,
      )
    // The place it leaves: a card is made in no trash, nor trashed twice.
    case "trash":
      return now === undefined || now.place.kind === "trash"
        ? undefined
        : { kind: "trash", left: now.place }
    default:
      return key
  }
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
 * accepted move names its sender as the card's placer.
 *
 * - No `from`: the card is created, its sender its owner, with no command
 *   (`planMake`).
 * - A fact is the host's: no person moves its kind (`KINDS`),
 *   so every move of it is refused `no-place`.
 * - To a trash: a discard, from any place the sender may move out of; the
 *   card records the place it left. A card in a trash moves only by an
 *   undo, which is no handoff, or by `planFromTrash` (its cutter's paste,
 *   or a restore to `back`): any other move out of a trash is refused
 *   `gone`.
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
): MoveStep {
  const now = cards.find(c => c.id === move.card)
  if (move.from === null) {
    // A move makes a text card, or a note column on a canvas: a thread's
    // card is the host's to make, with its thread's first message or a
    // copy (`planCopy`), and a fact's with its fact (`planFactCard`).
    const place = placeAt(move.to, cards, sender, undefined)
    const made =
      place === undefined ? undefined : madeAt(move.card, place, sender)
    return made === undefined
      ? { kind: "refused", code: "no-place", now: null }
      : planMake(cards, made, sender)
  }
  // A move out of a trash to the very place the card left is a restore.
  if (now?.place.kind === "trash" && isBack(now.place.left, move.to))
    return planFromTrash(cards, move.card, sender, RESTORE)
  if (now === undefined || now.place.kind === "trash")
    return { kind: "refused", code: "gone", now: null }
  return handoff(cards, now, { ...move, from: move.from }, sender)
}

/**
 * Why a card leaves a trash besides an undo: its cutter's paste (`uncut`),
 * to the paste's target; or a restore, back to the place it left.
 */
export type FromTrash =
  | { readonly kind: "uncut"; readonly to: ResolvedTarget }
  | { readonly kind: "restore" }

/** A restore: back to where the card was. */
export const RESTORE: FromTrash = { kind: "restore" }

/**
 * A card moved out of a trash: the one way but an undo. Refused `gone`
 * unless the card is in a trash; an uncut, unless the sender trashed it
 * (its placer: the first paste after a cut). A restore goes back to the
 * place the card left, a canvas card at the rank it had there; refused
 * `left-gone` when what that place is on (a canvas, a note column, a thread)
 * is itself trashed or has no record, `left-taken` for your message's
 * place where you have written a newer one, and `not-yours` for someone
 * else's message. Then it is a handoff as any move is.
 */
export function planFromTrash(
  cards: readonly CardRecord[],
  card: CardId,
  sender: WriterId,
  why: FromTrash,
): MoveStep {
  const now = cards.find(c => c.id === card)
  if (now === undefined || now.place.kind !== "trash")
    return { kind: "refused", code: "gone", now: null }
  if (why.kind === "uncut") {
    if (now.placer !== sender)
      return { kind: "refused", code: "gone", now: null }
    return handoff(cards, now, { card, from: DISCARDED, to: why.to }, sender)
  }
  const { left } = now.place
  // A canvas's card goes back by the board's own move, or by an undo.
  if (left.kind === "board") return { kind: "refused", code: "no-place", now }
  const refusal = refuseBack(cards, now, left, sender)
  if (refusal !== null) return { kind: "refused", code: refusal, now }
  return handoff(
    cards,
    now,
    { card, from: DISCARDED, to: backTo(left) },
    sender,
  )
}

/** Why a restore of `now` to `left` is refused; null when it may go back. */
function refuseBack(
  cards: readonly CardRecord[],
  now: CardRecord,
  left: LivePlace,
  sender: WriterId,
): MoveRefusal | null {
  if (left.kind === "composing") {
    if (now.owner !== sender) return "not-yours"
    const newer = cards.some(
      c =>
        c.id !== now.id &&
        c.owner === now.owner &&
        c.place.kind === "composing" &&
        c.place.thread === left.thread,
    )
    if (newer) return "left-taken"
  }
  const owner = ownerCard(surfaceOwner(left))
  if (owner === null) return null
  const holds = cards.find(c => c.id === owner)
  return holds === undefined || holds.place.kind === "trash"
    ? "left-gone"
    : null
}

/** Whether `to` is the place `left`: a canvas by its canvas, whatever its rank. */
const isBack = (left: LivePlace, to: ResolvedTarget): boolean =>
  left.kind !== "board" &&
  sameKey(
    placeKey(left),
    to.kind === "canvas" ? { kind: "canvas", canvas: to.canvas } : to,
  )

/** Where a restore sends a card: the place it left, a canvas at its old rank. */
const backTo = (
  left: Exclude<LivePlace, { readonly kind: "board" }>,
): ResolvedTarget =>
  left.kind === "canvas"
    ? { kind: "canvas", canvas: left.canvas, order: left.order }
    : placeKey(left)

/** `planMove`'s and `planFromTrash`'s checks once each has found the card where it may leave. */
function handoff(
  cards: readonly CardRecord[],
  now: CardRecord,
  move: ResolvedMove & { readonly from: PlaceKey },
  sender: WriterId,
): MoveStep {
  if (!isWhereSenderSaw(placeKey(now.place), move.from))
    return { kind: "refused", code: "moved", now }
  // A move to where the card is would requeue it last, under its sender's
  // name: a card changes its place in line by a reorder (`planReorder`).
  if (sameKey(move.from, move.to))
    return { kind: "refused", code: "moved", now }
  if (!ownsPlace(move.from, sender))
    return { kind: "refused", code: "not-yours", now }
  const refusal = placeRefusal(move.to, cards, move.card, sender)
  if (refusal !== null) return { kind: "refused", code: refusal, now }
  const place = placeAt(move.to, cards, sender, now)
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
 * A paste, as one step of its sender's history: the card it
 * replaces discarded first, so a replacement in a full inventory
 * never meets `full`; then the card made where `move` sends it (a text
 * card keeping its origin, or a reference), or the cut card moved out of
 * a trash by its cutter (`planFromTrash`). A card made in the place of the one it
 * replaces takes that very place (its rank in a note column or a queue): an
 * edit as text keeps the reference's spot. Refused as the discard, the
 * make or the move would be.
 */
export function planPaste(
  cards: readonly CardRecord[],
  paste: Paste,
  move: ResolvedMove,
  replacing: Replacing | null,
  sender: WriterId,
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
        )
  if (discard?.kind === "refused") return discard
  const before = discard === null ? cards : afterSteps(cards, [discard])
  if (paste.kind === "uncut") {
    const step = planFromTrash(before, paste.card, sender, {
      kind: "uncut",
      to: move.to,
    })
    if (step.kind === "refused") return step
    return {
      kind: "steps",
      steps: [...(discard === null ? [] : [discard]), step],
    }
  }
  const place =
    old !== undefined && sameKey(placeKey(old.place), move.to)
      ? old.place
      : placeAt(move.to, before, sender, undefined)
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
 * The card a paste makes at `place`: the host's make, and the
 * page's draw of it until the host answers. Undefined for a place its kind
 * is never in.
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
 * planned, each against the cards as the ones before it left
 * them, so a column made for the first takes the rest:
 *
 * - a thread's nearest notes (`notes`, `notesTarget`), through `toNotes`, a note
 *   column made for it written first; refused `no-place`, naming the card,
 *   for a thread with no card;
 * - a spot on a canvas (`canvas-at`), ranked just after its `after` there,
 *   or at the end when that card is no longer on the canvas (`rankAfter`),
 *   the cards given new ranks to make room written first. A card of a kind
 *   no canvas takes lands in the container its kind is made in there
 *   (`WRAPS`): a text card or a reference as the first note of a note
 *   column made at that rank, written first.
 *
 * A move into an entry's margin is refused `no-place` unless the
 * margin names the thread its entry is in (`entryThreads`): a margin's canvas
 * is read from its thread, so one naming another would put a comment in
 * the wrong canvas. A move onto the board is refused `no-place`: only the
 * board's own move places a canvas's card.
 */
export function planMoveTargets(input: {
  readonly cards: readonly CardRecord[]
  readonly moves: readonly Move[]
  readonly sender: WriterId
  /** Mints the id of a note column made for them. */
  readonly newColumn: () => NoteColumnId
  /** The thread of each entry a move's margin names, as its root's index says; absent for one not found. */
  readonly entryThreads: ReadonlyMap<EntryId, ThreadId>
  /** The board's states, for a new canvas a move makes; null refuses one. */
  readonly workflow?: Workflow | null
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
      // Back to the place the card left: a restore, which `planMove` tells
      // by its target.
      case "back": {
        const card = now.find(c => c.id === move.card)
        if (card?.place.kind !== "trash" || card.place.left.kind === "board")
          return { kind: "refused", code: "gone", now: card ?? null }
        moves.push({ ...move, to: backTo(card.place.left) })
        break
      }
      // A new canvas made by the mover, the card first on its canvas.
      case "new-canvas": {
        const made = planCanvasOpening(
          to.canvas,
          input.sender,
          { workflow: input.workflow ?? null, state: null },
          now,
        )
        if (made.kind === "refused")
          return {
            ...made,
            now: now.find(c => c.id === move.card) ?? null,
          }
        first.push(made)
        now = afterSteps(now, [made])
        moves.push({
          ...move,
          to: rankOnCanvas(now, move.card, {
            kind: "canvas",
            canvas: to.canvas,
          }).to,
        })
        break
      }
      // No person's move takes a canvas's card (`KINDS`): the board's own
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
 * Moves as a person sends them: each target that is no place yet resolved
 * first (`planMoveTargets`), what that writes written before the moves, then
 * planned whole (`planMoveCommand`).
 */
export function planMoveRequest(
  cards: readonly CardRecord[],
  moves: readonly Move[],
  sender: WriterId,
  running: (lane: ThreadId) => boolean,
  newColumn: () => NoteColumnId,
  entryThreads: ReadonlyMap<EntryId, ThreadId>,
  workflow: Workflow | null = null,
): MoveCommand {
  const resolved = planMoveTargets({
    cards,
    moves,
    sender,
    newColumn,
    entryThreads,
    workflow,
  })
  if (resolved.kind === "refused") return REFUSED(resolved)
  const command = planMoveCommand(
    afterSteps(cards, resolved.first),
    resolved.moves,
    sender,
    running,
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

/**
 * Several moves as one (a keep's cards): each planned against the
 * cards as the ones before it left them, and accepted whole, or refused by
 * the first that is, naming its card.
 */
export function planMoves(
  cards: readonly CardRecord[],
  moves: readonly ResolvedMove[],
  sender: WriterId,
): MovesStep {
  const steps: PlaceStep[] = []
  let now = cards
  for (const move of moves) {
    const step = planMove(now, move, sender)
    if (step.kind === "refused") return step
    steps.push(step)
    now = afterSteps(now, [step])
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

/** Moves and what follows them (`MoveCommand`). */
export function planMoveCommand(
  cards: readonly CardRecord[],
  moves: readonly ResolvedMove[],
  sender: WriterId,
  running: (lane: ThreadId) => boolean,
): MoveCommand {
  const step = planMoves(cards, moves, sender)
  if (step.kind === "refused") return REFUSED(step)
  return { step, drain: lanesToDrain(cards, step.steps, running) }
}

/**
 * The lanes `steps` leave to drain, those not running: each a step leaves
 * a card queued on (a move's, or a reference made there), and each thread
 * put on a canvas from an inventory or a trash, whose queue waited there.
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
    const from = was.get(record.id)
    return record.kind === "thread" &&
      record.place.kind === "canvas" &&
      (from === "inventory" || from === "trash")
      ? [record.id]
      : []
  })
  return [...new Set(lanes)].filter(l => !running(l))
}
