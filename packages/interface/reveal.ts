// interface/reveal — bringing a card's place into view where an undo of moves
// acted.
//
// The host answers an undo with each card it moved and where it is now, so
// the place is shown as the undo acts.

import type { CardId, EntryId, PlaceKey, ThreadId } from "@pinetrie/core"
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
        effects: [{ kind: "inventory", act: { kind: "show", how: "held" } }],
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
    // A note or an image: its column, unfolded in its canvas.
    case "note":
    case "image":
      return showColumn(place.column, state)
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
    // A comment on an image: the image's column.
    case "margin": {
      const { on } = place
      if (on.kind === "card") {
        const image = state.cards.cards.find(c => c.id === on.card)
        return image?.place.kind === "image"
          ? showColumn(image.place.column, state)
          : { effects: [], actedAt: AT_INVENTORY }
      }
      // A comment's entry, as a thread end is opened.
      return showThread(
        on.thread,
        on.entry in state.index.entries ? on.entry : null,
        null,
        state,
      )
    }
    case "composing":
    case "pinned":
    case "queued":
      return showThread(
        place.thread,
        placeEnd(place, state.index),
        place.kind === "queued" ? card : null,
        state,
      )
  }
}

/** A column of a canvas, unfolded there: a note column, a media column. */
function showColumn(
  column: CardId,
  state: IntentState,
): { readonly effects: readonly Effect[]; readonly actedAt: ActedAt } {
  const canvas = state.canvases.index.canvasOfCard.get(column)
  return {
    effects:
      canvas === undefined
        ? []
        : [
            ...showCanvas(canvas),
            viewChangeEffect(state, canvas, {
              kind: "fold",
              card: column,
              unfolded: true,
            }),
          ],
    actedAt: at(column),
  }
}

/**
 * `thread` opened at `end`, a queued `card` scrolled to in its dock; with no
 * end this tab holds, its card, unfolded in its canvas.
 */
function showThread(
  thread: ThreadId,
  end: EntryId | null,
  card: CardId | null,
  state: IntentState,
): { readonly effects: readonly Effect[]; readonly actedAt: ActedAt } {
  if (end === null) return showColumn(thread, state)
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
      ...(card !== null ? [{ kind: "revealCard", card } as const] : []),
    ],
    actedAt:
      plan?.kind === "scroll"
        ? at(plan.key)
        : plan?.kind === "unfold"
          ? at(plan.card)
          : AT_INVENTORY,
  }
}
