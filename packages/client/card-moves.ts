// client/card-moves — the moves this tab sent, drawn until its copy of the
// places document holds them (ADR-0059). Pure.
//
// The host writes every place and answers each move. The answer travels on
// the command Line and the change to `places` travels apart from it, so
// either can reach this tab first. A move the host accepted is therefore
// drawn until the copy's `rev` reaches the one the answer carried: a copy at
// that `rev` holds the move and everything before it, whatever happened to
// the card since. Dropped at the answer alone, the card would jump back for
// a moment; dropped when the card looks moved, a move overtaken before the
// copy caught up (taken, or moved back) would never show, and would be drawn
// for good. A send is a move of its card too: out of the composer.
//
// The same state keeps this tab's history of moves (ADR-0052): an entry is
// recorded when the host accepts its move, so a refused move never enters
// it, and each sent move says what it does to the history as a value
// (`HistoryStep`). A swap in your inventory never reaches the host, so it is
// recorded at once. A take's chosen slot is an intent until the take is
// answered (`intentsOf`): the repair leaves it alone (`inventory.ts`).

import type {
  CardId,
  CardPlace,
  CardRecord,
  Move,
  MoveRefusal,
  PlaceKey,
  WriterId,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import type { Intents } from "./inventory.ts"
import type { ClosedColumn } from "./layout.ts"

/**
 * Where you were looking when you acted: a column, by key, or the inventory.
 * A refusal is drawn there (`Refusal`).
 */
export type ActedAt =
  | { readonly kind: "column"; readonly key: string }
  | { readonly kind: "inventory" }

export const AT_INVENTORY: ActedAt = { kind: "inventory" }

export const sameActedAt = (a: ActedAt, b: ActedAt): boolean =>
  a.kind === "column"
    ? b.kind === "column" && a.key === b.key
    : a.kind === b.kind

/** One move this tab made, as undo needs it. */
export type HistoryEntry =
  | {
      readonly kind: "handoff"
      readonly move: Move
      /** The slot it went into, or came out of; null for neither. */
      readonly slot: number | null
      /**
       * The fresh column at either end of it, as it was when the move was
       * made: an undo or redo into it reopens it if it has closed since.
       */
      readonly column: ClosedColumn | null
    }
  | {
      readonly kind: "swap"
      readonly a: number
      readonly b: number
      /** What the swap wrote: `a`'s card then, and `b`'s. */
      readonly cards: readonly [CardId | null, CardId | null]
    }

/** What a move does to the history once it is accepted. */
export type HistoryStep =
  /** A send, a discard, a composer's card coming into being: never recorded. */
  | { readonly kind: "none" }
  /** A new move: recorded, and redo cleared. */
  | { readonly kind: "record"; readonly entry: HistoryEntry }
  /** `entry` undone: it leaves the undo list when sent, for redo once accepted. */
  | { readonly kind: "undo"; readonly entry: HistoryEntry }
  /** `entry` redone: it leaves the redo list when sent, for undo once accepted. */
  | { readonly kind: "redo"; readonly entry: HistoryEntry }
  /** `entry` undone for good: a creation's removal, which has no redo. */
  | { readonly kind: "forget"; readonly entry: HistoryEntry }

export const NO_STEP: HistoryStep = { kind: "none" }

export interface MoveHistory {
  /** Newest last. */
  readonly undo: readonly HistoryEntry[]
  /** Newest last. */
  readonly redo: readonly HistoryEntry[]
}

/** Not yet answered, or accepted with the places document's `rev` after it. */
export type Answer =
  | { readonly state: "sent" }
  | { readonly state: "accepted"; readonly rev: number }

/** What every move this tab sends carries besides its target. */
interface Sent {
  readonly id: string
  readonly answer: Answer
  /** A take's chosen slot in your inventory; null for any other move. */
  readonly slot: number | null
  readonly actedAt: ActedAt
  readonly history: HistoryStep
}

/** A move this tab sent: a creation draws its record, any other its target. */
export type Pending =
  | (Sent & { readonly kind: "create"; readonly draft: CardRecord })
  | (Sent & { readonly kind: "move"; readonly move: Move })

/**
 * Something of yours refused, kept to be worded where you acted: a move the
 * host refused, a swap whose slots changed since, or a keep with no room.
 */
export type Refusal = {
  /** The card it was about; null for a keep, which is about a column's cards. */
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
  /** A keep whose cards outnumber the empty slots. */
  | { readonly code: "no-room"; readonly need: number; readonly free: number }
)

export interface MovesState {
  readonly pending: readonly Pending[]
  readonly refusals: readonly Refusal[]
  /** This tab's copy of the places document's `rev`. */
  readonly rev: number
  readonly history: MoveHistory
}

export const NO_MOVES: MovesState = {
  pending: [],
  refusals: [],
  rev: 0,
  history: { undo: [], redo: [] },
}

/** What the host's answer to a move means here. */
export type MoveAnswer =
  | { readonly kind: "accepted"; readonly rev: number }
  /** Dropped; with a refusal to word, or null for an answer the sender words itself. */
  | { readonly kind: "refused"; readonly refusal: Refusal | null }

export type MovesEvent =
  /** A move sent: it is drawn at once, and the refusals where it was made go. */
  | { readonly kind: "sent"; readonly pending: Pending }
  | {
      readonly kind: "answered"
      readonly id: string
      readonly answer: MoveAnswer
    }
  /** The copy of the places document changed, to `rev`. */
  | { readonly kind: "changed"; readonly rev: number }
  /** The host left: the session is over, as a client does not reconnect. */
  | { readonly kind: "hostLeft" }
  /** A swap in your inventory, written: it needs no host. */
  | { readonly kind: "swapped"; readonly step: HistoryStep }
  /** An entry undo or redo could not act on: dropped, and why kept. */
  | {
      readonly kind: "dropped"
      readonly entry: HistoryEntry
      readonly refusal: Refusal
    }
  /** Something refused before anything was sent. */
  | { readonly kind: "refused"; readonly refusal: Refusal }

const answered = (p: Pending, rev: number): Pending => ({
  ...p,
  answer: { state: "accepted", rev },
})

const drawn = (p: Pending, rev: number): boolean =>
  p.answer.state === "sent" || p.answer.rev > rev

const without = (
  list: readonly HistoryEntry[],
  entry: HistoryEntry,
): readonly HistoryEntry[] => list.filter(e => e !== entry)

/** The history once `step` is sent: an undone or redone entry leaves its list. */
function onSend(history: MoveHistory, step: HistoryStep): MoveHistory {
  switch (step.kind) {
    case "none":
    case "record":
      return history
    case "undo":
      return { ...history, undo: without(history.undo, step.entry) }
    case "redo":
      return { ...history, redo: without(history.redo, step.entry) }
    case "forget":
      return {
        undo: without(history.undo, step.entry),
        redo: without(history.redo, step.entry),
      }
  }
}

/** The history once `step`'s move is accepted. */
function onAccept(history: MoveHistory, step: HistoryStep): MoveHistory {
  switch (step.kind) {
    case "none":
    case "forget":
      return history
    case "record":
      return { undo: [...history.undo, step.entry], redo: [] }
    case "undo":
      return { ...history, redo: [...history.redo, step.entry] }
    case "redo":
      return { ...history, undo: [...history.undo, step.entry] }
  }
}

export function movesStep(state: MovesState, event: MovesEvent): MovesState {
  switch (event.kind) {
    case "sent": {
      const { pending } = event
      return {
        ...state,
        pending: [...state.pending, pending],
        refusals: state.refusals.filter(
          r => !sameActedAt(r.actedAt, pending.actedAt),
        ),
        history: onSend(state.history, pending.history),
      }
    }
    case "answered": {
      const entry = state.pending.find(p => p.id === event.id)
      if (entry === undefined) return state
      const rest = state.pending.filter(p => p.id !== event.id)
      const { answer } = event
      // Refused, an undone or redone entry is already off its list: dropped.
      if (answer.kind === "refused")
        return {
          ...state,
          pending: rest,
          refusals:
            answer.refusal === null
              ? state.refusals
              : [...state.refusals, answer.refusal],
        }
      const history = onAccept(state.history, entry.history)
      // The copy already holds it: `places` arrived first.
      if (answer.rev <= state.rev) return { ...state, pending: rest, history }
      return {
        ...state,
        pending: state.pending.map(p =>
          p.id === event.id ? answered(p, answer.rev) : p,
        ),
        history,
      }
    }
    case "swapped":
      return {
        ...state,
        refusals: state.refusals.filter(r => r.actedAt.kind !== "inventory"),
        history: onAccept(onSend(state.history, event.step), event.step),
      }
    case "dropped":
      return {
        ...state,
        refusals: [...state.refusals, event.refusal],
        history: {
          undo: without(state.history.undo, event.entry),
          redo: without(state.history.redo, event.entry),
        },
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

/** The slot each take this tab has in flight chose, by card. */
export function intentsOf(state: MovesState): Intents {
  const intents = new Map<CardId, number>()
  for (const p of state.pending) {
    if (p.slot === null || !drawn(p, state.rev)) continue
    intents.set(p.kind === "create" ? p.draft.id : p.move.card, p.slot)
  }
  return intents
}

/**
 * A key as the place it is drawn as. A queued one waits for the host to give
 * it an order, so it is drawn last in its lane's queue, queued by you.
 */
const placeOf = (key: PlaceKey, me: WriterId): CardPlace =>
  key.kind === "queued" ? { ...key, order: "\uffff", by: me } : key

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
    const now = cards.get(p.move.card)
    if (now === undefined) continue
    if (p.move.to === null) cards.delete(p.move.card)
    else cards.set(p.move.card, { ...now, place: placeOf(p.move.to, me) })
  }
  return [...cards.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
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
