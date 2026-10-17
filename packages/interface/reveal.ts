// interface/reveal — bringing a card's place into view where an undo of moves
// acted.
//
// The host answers an undo with each card it moved and where it is now, so
// the place is shown as the undo acts.

import type { CardId, PlaceKey } from "@pinetrie/core"
import { placeEnd } from "@pinetrie/rules"
import { type ActedAt, AT_INVENTORY } from "@pinetrie/session"
import { heldByOthers } from "./canvas-columns.ts"
import {
  type Effect,
  type IntentState,
  layout,
  planOpenEntry,
  showCanvas,
  viewChangeEffect,
} from "./effects.ts"
import { planOpen } from "./layout.ts"

const at = (key: string): ActedAt => ({ kind: "column", key })

/**
 * The effects that show `place`, and where a refusal there is said: your
 * inventory's panel; a thread's end, or a comment's entry, as `openAt` shows an
 * entry; a note column, unfolded; your message at a thread not yet started, its
 * card, unfolded in its canvas; a canvas's card, the board. A queued `card` is
 * scrolled to in its column's dock, which scrolls apart from the thread.
 */
export function revealEffects(
  place: PlaceKey,
  state: IntentState,
  card: CardId | null = null,
): { readonly effects: readonly Effect[]; readonly actedAt: ActedAt } {
  switch (place.kind) {
    case "inventory":
      return {
        effects: [{ kind: "showInventory", brief: false }],
        actedAt: AT_INVENTORY,
      }
    // A card on a canvas: its column, unfolded in its canvas.
    case "canvas":
      return {
        effects:
          card === null
            ? showCanvas(place.canvas)
            : [
                ...showCanvas(place.canvas),
                viewChangeEffect(state, place.canvas, {
                  kind: "fold",
                  card,
                  unfolded: true,
                }),
              ],
        actedAt: AT_INVENTORY,
      }
    // A note: its note column, unfolded in its canvas.
    case "note": {
      const canvas = state.canvases.index.canvasOfCard.get(place.column)
      return {
        effects:
          canvas === undefined
            ? []
            : [
                ...showCanvas(canvas),
                viewChangeEffect(state, canvas, {
                  kind: "fold",
                  card: place.column,
                  unfolded: true,
                }),
              ],
        actedAt: at(place.column),
      }
    }
    // Pinned to a canvas: its canvas column, unfolded.
    case "canvas-pinned":
      return {
        effects: [
          ...showCanvas(place.canvas),
          viewChangeEffect(state, place.canvas, {
            kind: "foldCanvas",
            unfolded: true,
          }),
        ],
        actedAt: at(place.canvas),
      }
    // A canvas's card on the board: the board, open.
    case "board":
      return {
        effects: [layout({ kind: "board", open: true })],
        actedAt: AT_INVENTORY,
      }
    // Discarded: drawn nowhere, so nothing comes into view.
    case "trash":
      return { effects: [], actedAt: AT_INVENTORY }
    case "composing":
    case "pinned":
    case "queued":
    case "margin": {
      // A comment's entry, as a thread end is opened.
      const end =
        place.kind === "margin"
          ? place.entry in state.index.entries
            ? place.entry
            : null
          : placeEnd(place, state.index)
      // A thread this tab holds no entry of: its card, unfolded in its canvas.
      if (end === null) {
        const canvas = state.canvases.index.canvasOfCard.get(place.thread)
        return {
          effects:
            canvas === undefined
              ? []
              : [
                  ...showCanvas(canvas),
                  viewChangeEffect(state, canvas, {
                    kind: "fold",
                    card: place.thread,
                    unfolded: true,
                  }),
                ],
          actedAt: at(place.thread),
        }
      }
      const plan = planOpen(
        state.layout,
        state.index,
        end,
        state.canvases.index,
        state.cards.lanes,
        heldByOthers(state.cards.cards, state.cards.me),
      )
      return {
        effects: [
          ...planOpenEntry(end, state),
          ...(place.kind === "queued" && card !== null
            ? [{ kind: "revealCard", card } as const]
            : []),
        ],
        actedAt:
          plan?.kind === "scroll"
            ? at(plan.key)
            : plan?.kind === "unfold"
              ? at(plan.card)
              : AT_INVENTORY,
      }
    }
  }
}
