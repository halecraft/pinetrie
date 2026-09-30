// client/card-state — the drafting card's editor, decided (ADR-0048).
//
// One textarea edits your card at a column's end. Until there is something
// worth keeping it is local; the input that makes it worth keeping creates
// the card and binds the same element to it; a send holds it until the host
// answers. `editorState` decides each step and names what the component must
// do; `card-editor.tsx` does it. Pure.

import type { CardId } from "@pineta/core"
import type { Prefill } from "./columns.ts"
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
  /** No card: the element holds what is typed, and nothing else does. */
  | { readonly kind: "local" }
  /** The element is bound to this card's text. */
  | { readonly kind: "bound"; readonly card: CardId }
  /** A send is in flight, from this card or, with null, from the box alone. */
  | { readonly kind: "sending"; readonly card: CardId | null }

export type EditorEvent =
  /** The person typed. `card` is the id a new card would take. */
  | { readonly kind: "input"; readonly text: string; readonly card: CardId }
  /** Your card here exists: found on opening, or made by another of your tabs. */
  | { readonly kind: "found"; readonly card: CardId }
  /** Your card here is gone: someone sent it, or it was discarded. */
  | { readonly kind: "gone" }
  | { readonly kind: "send" }
  /** The host answered the send; `spent` is whether it took the card's text. */
  | { readonly kind: "settled"; readonly spent: boolean }

/**
 * What the component does on the way to the next state:
 * - `create`: write the card from the element's text, then bind the element;
 * - `attach`: bind the element to a card that exists;
 * - `detach`: unbind it, and empty it;
 * - null: nothing.
 */
export type EditorAct = "create" | "attach" | "detach" | null

export interface EditorStep {
  readonly state: EditorState
  readonly act: EditorAct
}

const stay = (state: EditorState): EditorStep => ({ state, act: null })

export function editorState(
  state: EditorState,
  event: EditorEvent,
  prefill: Prefill | undefined,
): EditorStep {
  switch (event.kind) {
    case "input":
      return state.kind === "local" && needsCard(event.text, prefill)
        ? { state: { kind: "bound", card: event.card }, act: "create" }
        : stay(state)
    case "found":
      return state.kind === "local"
        ? { state: { kind: "bound", card: event.card }, act: "attach" }
        : stay(state)
    case "gone":
      // While sending, the host spends the card as part of this send: the
      // reply says how it went.
      return state.kind === "bound"
        ? { state: { kind: "local" }, act: "detach" }
        : stay(state)
    case "send":
      return state.kind === "sending"
        ? stay(state)
        : {
            state: {
              kind: "sending",
              card: state.kind === "bound" ? state.card : null,
            },
            act: null,
          }
    case "settled":
      if (state.kind !== "sending") return stay(state)
      if (event.spent) return { state: { kind: "local" }, act: "detach" }
      // A conflict or a refusal: nothing was sent, and the card is still
      // there, so nothing is restored.
      return state.card === null
        ? stay({ kind: "local" })
        : stay({ kind: "bound", card: state.card })
  }
}
