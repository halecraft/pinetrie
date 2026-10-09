// interface/reveal — bringing a card's place into view where an undo of moves
// acted (ADR-0052, ADR-0066). Pure.
//
// The host answers an undo with each card it moved and where it is now, so
// the place is shown as the undo acts. A fresh column the layout no longer
// holds is opened again from its place alone, in its task: its key, its
// task and its branch point are in the place (`openFresh`).

import type { CardId, PlaceKey } from "@pinetrie/core"
import { placeEnd } from "@pinetrie/rules"
import { type ActedAt, AT_INVENTORY } from "@pinetrie/session"
import type { Minted } from "./columns.ts"
import {
  type Effect,
  entryOfTask,
  type IntentState,
  planOpenAt,
  show,
  showTask,
} from "./effects.ts"
import { columnsOf, hereOfColumn, planOpen } from "./layout.ts"

const at = (key: string): ActedAt => ({ kind: "column", key })

/**
 * The effects that show `place`, and where a refusal there is said: your
 * inventory's panel; a thread's end, as `openAt` shows an entry; or a fresh
 * column, shown where it is, or opened again at the end of its task's
 * columns. A fresh column whose task has no message yet belongs to a new
 * tab, whose history only that tab reaches while it is open, so the layout
 * holds it. A queued `card` is scrolled to in its column's dock,
 * which scrolls apart from the thread (ADR-0113).
 */
export function revealOf(
  place: PlaceKey,
  state: IntentState,
  minted: Minted,
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
      const { task } = place
      const entry = entryOfTask(state, task)
      if (entry === null || place.at.kind !== "entry")
        return { effects: [], actedAt: at(place.column) }
      return {
        effects: [
          ...showTask(task),
          {
            kind: "layout",
            action: {
              kind: "columns",
              task,
              entry,
              action: {
                kind: "openFresh",
                key: place.column,
                thread: minted.thread,
                at: place.at.id,
                after: columnsOf(state.layout, task, entry).length - 1,
              },
            },
          },
        ],
        actedAt: at(place.column),
      }
    }
    // A card on a canvas: its task comes into view.
    case "canvas":
      return { effects: showTask(place.task), actedAt: AT_INVENTORY }
    // A note: its note column's task, where the column is drawn (ADR-0116).
    case "note": {
      const task = state.tasks.index.taskOfCard.get(place.column)
      return {
        effects: task === undefined ? [] : showTask(task),
        actedAt: at(place.column),
      }
    }
    // A target alone: no card is ever there.
    case "notes":
      return { effects: [], actedAt: AT_INVENTORY }
    // Discarded: drawn nowhere, so nothing comes into view.
    case "gone":
      return { effects: [], actedAt: AT_INVENTORY }
    case "composing":
    case "pinned":
    case "queued": {
      const end =
        placeEnd(place, state.index) ??
        (place.at.kind === "entry" ? place.at.id : null)
      if (end === null) return { effects: [], actedAt: AT_INVENTORY }
      const plan = planOpen(
        state.layout,
        state.index,
        end,
        state.tasks.index.taskOfThread,
        state.entries,
      )
      return {
        effects: [
          ...planOpenAt(end, state, minted.key),
          ...(place.kind === "queued" && card !== null
            ? [{ kind: "revealCard", card } as const]
            : []),
        ],
        actedAt:
          plan?.kind === "scroll"
            ? at(plan.key)
            : plan?.kind === "open"
              ? at(minted.key)
              : AT_INVENTORY,
      }
    }
  }
}
