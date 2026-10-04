// client/reveal — bringing a card's place into view where an undo of moves
// acted (ADR-0052, ADR-0066). Pure.
//
// The host answers an undo with each card it moved and where it is now, so
// the place is shown as the undo acts. A fresh column the layout no longer
// holds is opened again from its place alone, in its root's tab: its key,
// its root and its branch point are in the place (`openFresh`).

import type { PlaceKey } from "@pineta/core"
import { placeEnd } from "@pineta/marginalia"
import { type ActedAt, AT_INVENTORY } from "./card-moves.ts"
import { type Effect, type IntentState, planOpenAt } from "./intent.ts"
import { columnsOf, planOpen, tabOfColumn } from "./layout.ts"

const at = (key: string): ActedAt => ({ kind: "column", key })

/**
 * The effects that show `place`, and where a refusal there is said: your
 * inventory's panel; a thread's end, as `openAt` shows an entry; or a fresh
 * column, shown in its tab, or opened again at the end of its root's tab.
 * A fresh column whose root the directory does not name belongs to a new
 * tab, whose history only that tab reaches while it is open, so the layout
 * holds it.
 */
export function revealOf(
  place: PlaceKey,
  state: IntentState,
  fresh: string,
): { readonly effects: readonly Effect[]; readonly actedAt: ActedAt } {
  switch (place.kind) {
    case "inventory":
      return {
        effects: [{ kind: "showInventory", brief: false }],
        actedAt: AT_INVENTORY,
      }
    case "fresh": {
      const tab = tabOfColumn(state.layout, place.column)
      if (tab !== undefined)
        return {
          effects: [{ kind: "layout", action: { kind: "show", tab } }],
          actedAt: at(place.column),
        }
      const root = state.rootEntries.get(place.root)
      if (root === undefined || place.at.kind !== "entry")
        return { effects: [], actedAt: at(place.column) }
      return {
        effects: [
          {
            kind: "layout",
            action: { kind: "show", tab: { kind: "root", root } },
          },
          {
            kind: "layout",
            action: {
              kind: "columns",
              root,
              action: {
                kind: "openFresh",
                key: place.column,
                at: place.at.id,
                after: columnsOf(state.layout, root).length - 1,
              },
            },
          },
        ],
        actedAt: at(place.column),
      }
    }
    case "drafting":
    case "pinned":
    case "queued": {
      const end =
        placeEnd(place, state.cards.me, state.cards.lanes, state.index) ??
        (place.at.kind === "entry" ? place.at.id : null)
      if (end === null) return { effects: [], actedAt: AT_INVENTORY }
      const plan = planOpen(state.layout, state.index, state.archive, end)
      return {
        effects: planOpenAt(end, state, fresh),
        actedAt:
          plan?.kind === "scroll"
            ? at(plan.key)
            : plan?.kind === "open"
              ? at(fresh)
              : AT_INVENTORY,
      }
    }
  }
}
