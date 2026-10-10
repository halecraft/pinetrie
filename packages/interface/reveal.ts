// interface/reveal — bringing a card's place into view where an undo of moves
// acted (ADR-0052, ADR-0066). Pure.
//
// The host answers an undo with each card it moved and where it is now, so
// the place is shown as the undo acts. A fresh column the layout no longer
// holds is opened again from its place alone, in its task: its key (the
// thread it minted), its task and its branch point are in the place
// (`openFresh`).

import { type CardId, isThreadId, type PlaceKey } from "@pinetrie/core"
import { placeEnd } from "@pinetrie/rules"
import { type ActedAt, AT_INVENTORY } from "@pinetrie/session"
import { heldByOthers } from "./canvas-columns.ts"
import {
  changeViewOf,
  type Effect,
  type IntentState,
  planOpenAt,
  show,
  showTask,
} from "./effects.ts"
import { hereOfColumn, planOpen } from "./layout.ts"

const at = (key: string): ActedAt => ({ kind: "column", key })

/**
 * The effects that show `place`, and where a refusal there is said: your
 * inventory's panel; a thread's end, or a comment's entry, as `openAt`
 * shows an entry; a note
 * column, unfolded; or a fresh column, shown where it is, or opened again
 * after the thread it forks from. A fresh column whose task has no message
 * yet belongs to a new tab, whose history only that tab reaches while it is
 * open, so the layout holds it. A queued `card` is scrolled to in its
 * column's dock, which scrolls apart from the thread (ADR-0113).
 */
export function revealOf(
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
    case "fresh": {
      const here = hereOfColumn(state.layout, place.column)
      if (here !== undefined)
        return { effects: show(here), actedAt: at(place.column) }
      const { task, column } = place
      if (place.at.kind !== "entry" || !isThreadId(column))
        return { effects: [], actedAt: at(column) }
      return {
        effects: [
          ...showTask(task),
          changeViewOf(state, task, {
            kind: "openFresh",
            thread: column,
            at: place.at.id,
          }),
        ],
        actedAt: at(column),
      }
    }
    // A card on a canvas: its column, unfolded in its task (ADR-0116).
    case "canvas":
      return {
        effects:
          card === null
            ? showTask(place.task)
            : [
                ...showTask(place.task),
                changeViewOf(state, place.task, {
                  kind: "fold",
                  card,
                  unfolded: true,
                }),
              ],
        actedAt: AT_INVENTORY,
      }
    // A note: its note column, unfolded in its task (ADR-0116).
    case "note": {
      const task = state.tasks.index.taskOfCard.get(place.column)
      return {
        effects:
          task === undefined
            ? []
            : [
                ...showTask(task),
                changeViewOf(state, task, {
                  kind: "fold",
                  card: place.column,
                  unfolded: true,
                }),
              ],
        actedAt: at(place.column),
      }
    }
    // Pinned to a task: its task column, unfolded (ADR-0116).
    case "task-pinned":
      return {
        effects: [
          ...showTask(place.task),
          changeViewOf(state, place.task, { kind: "foldTask", unfolded: true }),
        ],
        actedAt: at(place.task),
      }
    // Discarded: drawn nowhere, so nothing comes into view.
    case "trash":
      return { effects: [], actedAt: AT_INVENTORY }
    case "composing":
    case "pinned":
    case "queued":
    case "margin": {
      // A comment's entry, as a thread end is opened (ADR-0126).
      const end =
        place.kind === "margin"
          ? place.entry in state.index.entries
            ? place.entry
            : null
          : placeEnd(place, state.index)
      // A thread this tab holds no entry of: its card, unfolded in its task.
      if (end === null) {
        const task = state.tasks.index.taskOfCard.get(place.thread)
        return {
          effects:
            task === undefined
              ? []
              : [
                  ...showTask(task),
                  changeViewOf(state, task, {
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
        state.tasks.index,
        state.cards.lanes,
        heldByOthers(state.cards.cards, state.cards.me),
      )
      return {
        effects: [
          ...planOpenAt(end, state),
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
