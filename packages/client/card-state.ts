// client/card-state — the drafting card's editor, decided (ADR-0048).
//
// One textarea edits your card at a column's end. Until there is something
// worth keeping it is local; the input that makes it worth keeping creates
// the card and binds the same element to it; a send holds it until the host
// answers. Undo and redo in the box reach only its card (ADR-0052).
// `editorState` decides each step and names what the component must do;
// `card-editor.tsx` does it. Pure.

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
  /**
   * No card: the element holds what is typed, and nothing else does. `last`
   * is the card the box was bound to until it went without a send from here
   * (your undo past its creation, or someone else's send), which a redo in
   * the box can bring back.
   */
  | { readonly kind: "local"; readonly last: CardId | null }
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
  /** A redo in the box while it holds no card (`isRedo`). */
  | { readonly kind: "redo" }
  /** The host answered the send; `spent` is whether it took the card's text. */
  | { readonly kind: "settled"; readonly spent: boolean }

/**
 * What the component does on the way to the next state:
 * - `create`: write the card from the element's text, then bind the element;
 * - `attach`: bind the element to a card that exists;
 * - `detach`: unbind it, and empty it;
 * - `redo`: redo the last card's history (`local.last`);
 * - null: nothing.
 */
export type EditorAct = "create" | "attach" | "detach" | "redo" | null

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
        ? { state: { kind: "local", last: state.card }, act: "detach" }
        : stay(state)
    case "redo":
      return state.kind === "local" && state.last !== null
        ? { state, act: "redo" }
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
      if (event.spent)
        return { state: { kind: "local", last: null }, act: "detach" }
      // A conflict or a refusal: nothing was sent, and the card is still
      // there, so nothing is restored.
      return state.card === null
        ? stay({ kind: "local", last: null })
        : stay({ kind: "bound", card: state.card })
  }
}

/** A key press or an input event, as much of either as `isRedo` reads. */
export type RedoEvent =
  | {
      readonly key: string
      readonly metaKey: boolean
      readonly ctrlKey: boolean
      readonly shiftKey: boolean
    }
  | { readonly inputType: string }

/**
 * Whether an event asks to redo: Cmd/Ctrl+Shift+Z or Ctrl+Y, or a
 * `historyRedo` input (the Edit menu, a touch keyboard). The same events
 * Kyneta's `attach` redoes on, which it does not export.
 */
export function isRedo(e: RedoEvent): boolean {
  if ("inputType" in e) return e.inputType === "historyRedo"
  if (!(e.metaKey || e.ctrlKey)) return false
  const key = e.key.toLowerCase()
  return (key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey)
}

/**
 * Whether the host let go of a card's document: it left the document while
 * still connected. Only the host destroys card documents, and only those of
 * cards it has spent or swept (S64). An undo past a card's creation, yours or
 * another's, leaves the host in place; a departing host leaves
 * `exchange.peers` first, and a dropped one leaves nothing.
 */
export const hostLetGo = (input: {
  /** The host was among the document's peers before this change. */
  readonly hadHost: boolean
  /** It is among them after. */
  readonly hasHost: boolean
  /** The host is in `exchange.peers`. */
  readonly hostConnected: boolean
}): boolean => input.hadHost && !input.hasHost && input.hostConnected

/**
 * The cards whose copies this client destroys now: the host let go of their
 * documents, and their records are gone. The two arrive in either order (the
 * host's `dismiss` can come before its delete of the record, S64), so a card
 * the host let go of waits for its record to go: until then, a render may
 * still read its text, and would make a new copy.
 */
export const spentCards = (
  letGo: Iterable<CardId>,
  live: (id: CardId) => boolean,
): CardId[] => [...letGo].filter(id => !live(id))
