// client/card-state — the drafting card's editor, decided (ADR-0048).
//
// One textarea edits your card at a column's end. Until there is something
// worth keeping it is local, and takes your card here when it finds one;
// "+ card" empties it to ask for another (`blank`), and it then takes none.
// The input that makes it worth keeping creates the card and binds the same
// element to it; a send holds it until the host answers. Undo and redo in the
// box reach only its card (ADR-0052).
// `editorState` decides each step and names what the component must do;
// `card-editor.tsx` does it. Pure.

import type { CardId, CardRecord } from "@pinetrie/core"
import type { Pending, Prefill } from "./columns.ts"
import { sendable } from "./send.ts"

/**
 * Whether the box holds something worth a card: exactly what could be sent,
 * so the prefill alone (`@agent `) or whitespace never makes one. One rule
 * with `sendable`, so what is kept and what can be sent cannot drift apart.
 */
export const needsCard = (
  text: string,
  prefill: Prefill | undefined,
): boolean => sendable(text, prefill, false) !== null

export type EditorState =
  /**
   * No card: the element holds what is typed, and nothing else does. It
   * takes your card here when one is found.
   */
  | { readonly kind: "local" }
  /**
   * No card, after "+ card": as `local`, but a card found is not taken. The
   * one you were writing is drawn above with the column's other cards.
   */
  | { readonly kind: "blank" }
  /** The element is bound to this card's text. */
  | { readonly kind: "bound"; readonly card: CardId }
  /** A send is in flight, from this card or, with null, from the box alone. */
  | { readonly kind: "sending"; readonly card: CardId | null }

export type EditorEvent =
  /** The person typed. `card` is the id a new card would take. */
  | { readonly kind: "input"; readonly text: string; readonly card: CardId }
  /** Your card here exists: found on opening, or made by another of your tabs. */
  | { readonly kind: "found"; readonly card: CardId }
  /**
   * Your card here is gone: someone sent it, or it was discarded. An undo
   * past its creation only empties it (ADR-0059), so it is not gone.
   */
  | { readonly kind: "gone" }
  /** "+ card", shown only while bound: empty the box for another card. */
  | { readonly kind: "new" }
  | { readonly kind: "send" }
  /** The host answered the send; `spent` is whether it took the card's text. */
  | { readonly kind: "settled"; readonly spent: boolean }

/**
 * What the component does on the way to the next state:
 * - `create`: write the card from the element's text;
 * - `attach`: bind the element to the card, which exists;
 * - `detach`: unbind it, and empty it.
 */
export type EditorAct = "create" | "attach" | "detach"

export interface EditorStep {
  readonly state: EditorState
  /**
   * In order. A new card is created, then attached: bound first, the binding
   * would write the element's text into a card that does not exist yet, and
   * the first run of typing would be lost.
   */
  readonly acts: readonly EditorAct[]
}

const LOCAL: EditorState = { kind: "local" }
const BLANK: EditorState = { kind: "blank" }

/** Whether the box holds no card, so an input worth keeping makes one. */
export const free = (state: EditorState): boolean =>
  state.kind === "local" || state.kind === "blank"

/** The card the box shows, if any. */
export const shownBy = (state: EditorState): CardId | null =>
  state.kind === "bound" || state.kind === "sending" ? state.card : null

/**
 * The card a column leaves out of the cards it draws above its composer,
 * because the composer shows it. Before the composer says, and while it is
 * `local`, that is your newest card here (`yourCard`), which it takes at
 * once; after "+ card", none.
 */
export const shownBelow = (
  composer: EditorState | undefined,
  mine: CardId | undefined,
): CardId | null =>
  composer === undefined || composer.kind === "local"
    ? (mine ?? null)
    : shownBy(composer)

const step = (
  state: EditorState,
  acts: readonly EditorAct[] = [],
): EditorStep => ({ state, acts })
const stay = (state: EditorState): EditorStep => step(state)

export function editorState(
  state: EditorState,
  event: EditorEvent,
  prefill: Prefill | undefined,
): EditorStep {
  switch (event.kind) {
    case "input":
      return free(state) && needsCard(event.text, prefill)
        ? step({ kind: "bound", card: event.card }, ["create", "attach"])
        : stay(state)
    case "found":
      return state.kind === "local"
        ? step({ kind: "bound", card: event.card }, ["attach"])
        : stay(state)
    case "gone":
      // While sending, the host spends the card as part of this send: the
      // reply says how it went.
      return state.kind === "bound" ? step(LOCAL, ["detach"]) : stay(state)
    case "new":
      return state.kind === "bound" ? step(BLANK, ["detach"]) : stay(state)
    case "send":
      return state.kind === "sending"
        ? stay(state)
        : step({
            kind: "sending",
            card: state.kind === "bound" ? state.card : null,
          })
    case "settled":
      if (state.kind !== "sending") return stay(state)
      if (event.spent) return step(LOCAL, ["detach"])
      // A conflict or a refusal: nothing was sent, and the card is still
      // there, so nothing is restored.
      return state.card === null
        ? stay(LOCAL)
        : stay({ kind: "bound", card: state.card })
  }
}

/**
 * What the box starts with: a fresh column's prefill, unless it opens with a
 * message to send (`pending`) or a card that holds its own text.
 */
export const startText = (input: {
  readonly pending: Pending | undefined
  readonly card: CardRecord | undefined
  readonly prefill: Prefill | undefined
}): string =>
  input.pending === undefined && input.card === undefined
    ? (input.prefill?.text ?? "")
    : ""
