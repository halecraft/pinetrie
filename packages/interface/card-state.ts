// interface/card-state — the editor of a box that makes its card at the
// first input worth keeping, decided: your message's, and the box a new note
// or pinned card is written in. `editorState` decides each step and names
// what `useCardBox` (`packages/web/card-box.ts`) must do.
//
// One textarea edits the card. Until there is something worth keeping it is
// local, and takes your message here when it finds one. The input that makes
// it worth keeping creates the card and binds the same element to it; a send
// holds it until the host answers. Undo and redo in the box reach only its
// card. A new card's box has no send: it releases its card when focus leaves
// it.

import type { CardRecord, TextCardId } from "@pinetrie/core"
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
  /** The element is bound to this card's text. */
  | { readonly kind: "bound"; readonly card: TextCardId }
  /** A send is in flight, from this card or, with null, from the box alone. */
  | { readonly kind: "sending"; readonly card: TextCardId | null }

export type EditorEvent =
  /** The person typed. `card` is the id a new card would take. */
  | { readonly kind: "input"; readonly text: string; readonly card: TextCardId }
  /** Your card here exists: found on opening, or made by another of your tabs. */
  | { readonly kind: "found"; readonly card: TextCardId }
  /**
   * Your card here is gone: someone sent it, or it was discarded. An undo
   * past its creation only empties it, so it is not gone.
   */
  | { readonly kind: "gone" }
  /**
   * The box lets its card go, which stays where it is: the note box's,
   * when focus leaves it, so its note is drawn among the others.
   */
  | { readonly kind: "release" }
  | { readonly kind: "send" }
  /** The host answered the send; `spent` is whether it took the card's text. */
  | { readonly kind: "settled"; readonly spent: boolean }

/**
 * What the component does on the way to the next state:
 * - `create`: write the card from the element's text;
 * - `attach`: bind the element to the card, which exists;
 * - `detach`: unbind it, and empty it.
 */
type EditorAct = "create" | "attach" | "detach"

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

/** Whether the box holds no card, so an input worth keeping makes one. */
export const free = (state: EditorState): boolean => state.kind === "local"

/** The card the box shows, if any. */
export const shownBy = (state: EditorState): TextCardId | null =>
  state.kind === "bound" || state.kind === "sending" ? state.card : null

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
    case "release":
      // While sending, the host spends the card as part of this send: the
      // reply says how it went.
      return state.kind === "bound" ? step(LOCAL, ["detach"]) : stay(state)
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
 * What the box starts with: an unstarted thread's prefill, unless it opens with a
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
