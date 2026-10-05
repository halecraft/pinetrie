// session/card-moves — the moves this tab sent, drawn until its copy of the
// places document holds them (ADR-0059). Pure.
//
// The host writes every place and answers each move. The answer travels on
// the command Line and the change to `places` travels apart from it, so
// either can reach this tab first. A move the host accepted is therefore
// drawn until the copy's `rev` reaches the one the answer carried: a copy at
// that `rev` holds the move and everything before it, whatever happened to
// the card since. Dropped at the answer alone, the card would jump back for
// a moment; dropped when the card looks moved, a move overtaken before the
// copy caught up (popped from its queue, or moved back) would never show, and would be drawn
// for good. A send is a move of its card too: out of the composer. So is a
// reorder (ADR-0048 step 7), drawn as the host's own rule would write it.
//
// The history of moves is the host's (ADR-0066), not kept here. The slot a
// take into the inventory chose is an intent until the take is answered
// (`intentsOf`): the repair leaves it alone (`inventory.ts`).

import type {
  CardId,
  CardPlace,
  CardRecord,
  Move,
  MoveRefusal,
  PlaceKey,
  Reorder,
  WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { planReorder } from "@pinetrie/rules"
import type { Intents } from "./inventory.ts"

/**
 * Where you were looking when you acted: a column, by key, or the inventory.
 * A refusal is drawn there (`CardRefusal`).
 */
export type ActedAt =
  | { readonly kind: "column"; readonly key: string }
  | { readonly kind: "inventory" }

export const AT_INVENTORY: ActedAt = { kind: "inventory" }

/** Column `key`, where a move was made. */
export const atColumn = (key: string): ActedAt => ({ kind: "column", key })

const sameActedAt = (a: ActedAt, b: ActedAt): boolean =>
  a.kind === "column"
    ? b.kind === "column" && a.key === b.key
    : a.kind === b.kind

/** What a move carries besides its target: where it was made, and the slot a take into the inventory chose. */
export interface MoveHow {
  readonly actedAt: ActedAt
  /** The slot a move into your inventory takes; null for any other move. */
  readonly slot: number | null
}

/** One card of several moved as one (a keep), with the slot it takes in your inventory. */
export interface SlotMove {
  readonly move: Move
  readonly slot: number | null
}

/** A move made in column `key` that takes no slot. */
export const IN_COLUMN = (key: string): MoveHow => ({
  actedAt: atColumn(key),
  slot: null,
})

/** A move made with no page: a suite's client. Its refusals are kept where no column is. */
export const OFF_PAGE: MoveHow = IN_COLUMN("")

/** Not yet answered, or accepted with the places document's `rev` after it. */
export type Answer =
  | { readonly state: "sent" }
  | { readonly state: "accepted"; readonly rev: number }

/**
 * What every move this tab sends carries besides its target. A command of
 * several moves (a keep) sends one of these per card, under one id.
 */
interface Sent {
  readonly id: string
  readonly answer: Answer
  /** The slot a take into your inventory chose; null for any other move. */
  readonly slot: number | null
  readonly actedAt: ActedAt
}

/**
 * A move this tab sent: a creation draws its record, a move its target, a
 * reorder what the host would write for it (`planReorder`).
 */
export type Pending =
  | (Sent & { readonly kind: "create"; readonly draft: CardRecord })
  | (Sent & { readonly kind: "move"; readonly move: Move })
  | (Sent & { readonly kind: "reorder"; readonly reorder: Reorder })

/**
 * Something of yours refused, kept to be worded where you acted: a move or
 * an undo the host refused, or an undone swap whose slots changed since.
 */
export type CardRefusal = {
  /** The card it was about; null when no one card is named. */
  readonly card: CardId | null
  readonly actedAt: ActedAt
} & (
  | {
      readonly code: MoveRefusal
      /**
       * `moved`: who put the card where it is now. `gone` from the queue:
       * who queued it, whose message it was sent as.
       */
      readonly by: WriterId | null
      /** The card was queued when the move was sent: gone, it was sent. */
      readonly fromQueue: boolean
    }
  /** An undone swap whose slots no longer hold what it wrote. */
  | { readonly code: "slots-changed" }
)

export interface MovesState {
  readonly pending: readonly Pending[]
  readonly refusals: readonly CardRefusal[]
  /** This tab's copy of the places document's `rev`. */
  readonly rev: number
}

export const NO_MOVES: MovesState = { pending: [], refusals: [], rev: 0 }

/** What the host's answer to a move means here. */
export type MoveAnswer =
  | { readonly kind: "accepted"; readonly rev: number }
  /** Dropped; with a refusal to word, or null for an answer the sender words itself. */
  | { readonly kind: "refused"; readonly refusal: CardRefusal | null }

export type MovesEvent =
  /**
   * Moves sent as one command: drawn at once, and the refusals where they
   * were made go.
   */
  | { readonly kind: "sent"; readonly pending: readonly Pending[] }
  | {
      readonly kind: "answered"
      readonly id: string
      readonly answer: MoveAnswer
    }
  /** The copy of the places document changed, to `rev`. */
  | { readonly kind: "changed"; readonly rev: number }
  /** The host left: the session is over, as a client does not reconnect. */
  | { readonly kind: "hostLeft" }
  /** You acted at `at` with no host to ask (a swap): the refusals there go. */
  | { readonly kind: "acted"; readonly at: ActedAt }
  /** Something refused before anything was sent, or by an undo. */
  | { readonly kind: "refused"; readonly refusal: CardRefusal }

const answered = (p: Pending, rev: number): Pending => ({
  ...p,
  answer: { state: "accepted", rev },
})

const drawn = (p: Pending, rev: number): boolean =>
  p.answer.state === "sent" || p.answer.rev > rev

export function movesStep(state: MovesState, event: MovesEvent): MovesState {
  switch (event.kind) {
    case "sent": {
      const { pending } = event
      return {
        ...state,
        pending: [...state.pending, ...pending],
        refusals: state.refusals.filter(
          r => !pending.some(p => sameActedAt(r.actedAt, p.actedAt)),
        ),
      }
    }
    case "answered": {
      // Every move the command sent: one, or a keep's several.
      if (!state.pending.some(p => p.id === event.id)) return state
      const rest = state.pending.filter(p => p.id !== event.id)
      const { answer } = event
      if (answer.kind === "refused")
        return {
          ...state,
          pending: rest,
          refusals:
            answer.refusal === null
              ? state.refusals
              : [...state.refusals, answer.refusal],
        }
      // The copy already holds it: `places` arrived first.
      if (answer.rev <= state.rev) return { ...state, pending: rest }
      return {
        ...state,
        pending: state.pending.map(p =>
          p.id === event.id ? answered(p, answer.rev) : p,
        ),
      }
    }
    case "acted":
      return {
        ...state,
        refusals: state.refusals.filter(r => !sameActedAt(r.actedAt, event.at)),
      }
    case "refused":
      return { ...state, refusals: [...state.refusals, event.refusal] }
    case "changed": {
      if (event.rev === state.rev) return state
      const pending = state.pending.filter(p => drawn(p, event.rev))
      return {
        ...state,
        rev: event.rev,
        pending:
          pending.length === state.pending.length ? state.pending : pending,
      }
    }
    case "hostLeft":
      return state.pending.length === 0 ? state : { ...state, pending: [] }
  }
}

/** The card a pending move moves. */
export const cardOfPending = (p: Pending): CardId =>
  p.kind === "create"
    ? p.draft.id
    : p.kind === "reorder"
      ? p.reorder.card
      : p.move.card

/** A move sent as `id`, unanswered; with `draft`, a creation drawn as that record. */
export function pendingOf(
  id: string,
  move: Move,
  how: MoveHow,
  draft: CardRecord | null,
): Pending {
  const sent = {
    id,
    answer: { state: "sent" },
    slot: how.slot,
    actedAt: how.actedAt,
  } as const
  return draft === null
    ? { ...sent, kind: "move", move }
    : { ...sent, kind: "create", draft }
}

/**
 * The slot an accepted move writes: one into your inventory, at the slot
 * its take into the inventory chose. Null for any other move, or answer.
 */
export function slotOnAccept(
  p: Pending,
  answer: MoveAnswer,
): { readonly card: CardId; readonly slot: number } | null {
  if (p.kind === "reorder") return null
  const into = p.kind === "create" ? p.draft.place : p.move.to
  return answer.kind === "accepted" &&
    into?.kind === "inventory" &&
    p.slot !== null
    ? { card: cardOfPending(p), slot: p.slot }
    : null
}

/**
 * `move` with its queue's text version as this client has it: the host pops
 * a queued card only once it holds that much (S96). Any other move is
 * returned as it is.
 */
export const stampSeen = (move: Move, seen: string): Move =>
  move.to?.kind === "queued" ? { ...move, to: { ...move.to, seen } } : move

/** The slot each take into the inventory this tab has in flight chose, by card. */
export function intentsOf(state: MovesState): Intents {
  const intents = new Map<CardId, number>()
  for (const p of state.pending) {
    if (p.slot === null || !drawn(p, state.rev)) continue
    intents.set(cardOfPending(p), p.slot)
  }
  return intents
}

/** An order key after every one the host assigns (`orderAfter`). */
const LAST = "\uffff"

/**
 * A key as the place it is drawn as. A queued or pinned one waits for the
 * host to give it an order, so it is drawn last among its kind, a queued one
 * queued by you.
 */
export const drawnPlace = (key: PlaceKey, me: WriterId): CardPlace =>
  key.kind === "queued"
    ? { ...key, order: LAST, by: me }
    : key.kind === "pinned"
      ? { ...key, order: LAST }
      : key

/**
 * The host's records, with this tab's moves its copy does not yet hold drawn
 * over them, oldest card first. With nothing drawn it returns `records`
 * itself, so a change to the document that no move of yours touches gives
 * the page no new array.
 */
export function withPending(
  records: readonly CardRecord[],
  state: MovesState,
  me: WriterId,
): readonly CardRecord[] {
  const shown = state.pending.filter(p => drawn(p, state.rev))
  if (shown.length === 0) return records
  const cards = new Map(records.map(c => [c.id, c] as const))
  for (const p of shown) {
    if (p.kind === "create") {
      if (!cards.has(p.draft.id)) cards.set(p.draft.id, p.draft)
      continue
    }
    if (p.kind === "reorder") {
      // Drawn as the host would write it, over what is drawn so far: a
      // reorder it would refuse is drawn as nothing.
      const step = planReorder([...cards.values()], p.reorder)
      const steps =
        step.kind === "steps" ? step.steps : step.kind === "write" ? [step] : []
      for (const w of steps)
        if (w.kind === "write") cards.set(w.record.id, w.record)
      continue
    }
    const now = cards.get(p.move.card)
    if (now === undefined) continue
    if (p.move.to === null) cards.delete(p.move.card)
    else cards.set(p.move.card, { ...now, place: drawnPlace(p.move.to, me) })
  }
  return [...cards.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
}

/**
 * The host's records, this tab's moves, and the cards drawn from the two
 * (`withPending`): changed in one step, so whoever hears one change reads
 * the other already changed with it.
 */
export interface LocalState {
  readonly records: readonly CardRecord[]
  readonly moves: MovesState
  readonly cards: readonly CardRecord[]
}

export type LocalEvent =
  | MovesEvent
  /** The copy of the places changed: its records, and its `rev`. */
  | {
      readonly kind: "records"
      readonly records: readonly CardRecord[]
      readonly rev: number
    }

/**
 * The state after `event`. It is `state` itself when nothing changed, and
 * `cards` keeps its identity while the drawn cards do, so a reader redraws
 * only for a change it reads.
 */
export function localStep(
  state: LocalState,
  event: LocalEvent,
  me: WriterId,
): LocalState {
  const records = event.kind === "records" ? event.records : state.records
  const moves = movesStep(
    state.moves,
    event.kind === "records" ? { kind: "changed", rev: event.rev } : event,
  )
  if (records === state.records && moves === state.moves) return state
  return { records, moves, cards: withPending(records, moves, me) }
}

/**
 * The host's answer to a move, or to a send from a card. Written, running,
 * queued or moved, it is accepted at the answer's `rev`. A refused move is a
 * refusal to word. Anything else (busy, a conflict, a refusal or a failure)
 * left the card where it was, and the sender words it.
 */
export function answerOf(
  outcome: Outcome,
  rev: number | null,
  context: {
    readonly card: CardId
    readonly actedAt: ActedAt
    /** Who queued the card, when the move was of a queued card. */
    readonly queuedBy: WriterId | null
  },
): MoveAnswer {
  switch (outcome.kind) {
    case "moved":
    case "appended":
    case "started":
    case "queued":
      return { kind: "accepted", rev: rev ?? 0 }
    case "unmoved":
      return {
        kind: "refused",
        refusal: {
          card: context.card,
          actedAt: context.actedAt,
          code: outcome.code,
          by: outcome.code === "gone" ? context.queuedBy : outcome.by,
          fromQueue: context.queuedBy !== null,
        },
      }
    default:
      return { kind: "refused", refusal: null }
  }
}
