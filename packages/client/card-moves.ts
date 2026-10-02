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

import type {
  CardId,
  CardPlace,
  CardRecord,
  LaneName,
  Move,
  MoveRefusal,
  PlaceKey,
  WriterId,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"

/** Not yet answered, or accepted with the places document's `rev` after it. */
export type Answer =
  | { readonly state: "sent" }
  | { readonly state: "accepted"; readonly rev: number }

/** A move this tab sent: a creation draws its record, any other its target. */
export type Pending =
  | {
      readonly id: string
      readonly kind: "create"
      readonly draft: CardRecord
      readonly answer: Answer
    }
  | {
      readonly id: string
      readonly kind: "move"
      readonly move: Move
      readonly answer: Answer
    }

/** A move of yours the host refused, kept to be worded in its lane's column. */
export interface Refusal {
  readonly card: CardId
  /** The lane the card was queued on or for, or null for none. */
  readonly lane: LaneName | null
  readonly code: MoveRefusal
  /**
   * `moved`: who put the card where it is now. `gone` from the queue: who
   * queued it, whose message it was sent as.
   */
  readonly by: WriterId | null
  /** The card was queued when the move was sent: gone, it was sent. */
  readonly fromQueue: boolean
}

export interface MovesState {
  readonly pending: readonly Pending[]
  readonly refusals: readonly Refusal[]
  /** This tab's copy of the places document's `rev`. */
  readonly rev: number
}

export const NO_MOVES: MovesState = { pending: [], refusals: [], rev: 0 }

/** What the host's answer to a move means here. */
export type MoveAnswer =
  | { readonly kind: "accepted"; readonly rev: number }
  /** Dropped; with a refusal to word, or null for an answer the sender words itself. */
  | { readonly kind: "refused"; readonly refusal: Refusal | null }

export type MovesEvent =
  /** A move sent: it is drawn at once, and the refusals in its lane go. */
  | {
      readonly kind: "sent"
      readonly pending: Pending
      readonly lane: LaneName | null
    }
  | {
      readonly kind: "answered"
      readonly id: string
      readonly answer: MoveAnswer
    }
  /** The copy of the places document changed, to `rev`. */
  | { readonly kind: "changed"; readonly rev: number }
  /** The host left: the session is over, as a client does not reconnect. */
  | { readonly kind: "hostLeft" }

const answered = (p: Pending, rev: number): Pending => ({
  ...p,
  answer: { state: "accepted", rev },
})

const drawn = (p: Pending, rev: number): boolean =>
  p.answer.state === "sent" || p.answer.rev > rev

export function movesStep(state: MovesState, event: MovesEvent): MovesState {
  switch (event.kind) {
    case "sent":
      return {
        ...state,
        pending: [...state.pending, event.pending],
        refusals:
          event.lane === null
            ? state.refusals
            : state.refusals.filter(r => r.lane !== event.lane),
      }
    case "answered": {
      const entry = state.pending.find(p => p.id === event.id)
      if (entry === undefined) return state
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
    readonly lane: LaneName | null
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
          lane: context.lane,
          code: outcome.code,
          by: outcome.code === "gone" ? context.queuedBy : outcome.by,
          fromQueue: context.queuedBy !== null,
        },
      }
    default:
      return { kind: "refused", refusal: null }
  }
}
