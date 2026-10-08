// interface/reveal — bringing a card's place into view where an undo of moves
// acted (ADR-0052, ADR-0066). Pure.
//
// The host answers an undo with each card it moved and where it is now, so
// the place is shown as the undo acts. A fresh column the layout no longer
// holds is opened again from its place alone, in its root's tab: its key,
// its root and its branch point are in the place (`openFresh`).

import type { CardId, PlaceKey } from "@pinetrie/core"
import { placeEnd } from "@pinetrie/rules"
import { type ActedAt, AT_INVENTORY } from "@pinetrie/session"
import { type Effect, type IntentState, planOpenAt, show } from "./effects.ts"
import { columnsOf, hereOfColumn, planOpen } from "./layout.ts"

const at = (key: string): ActedAt => ({ kind: "column", key })

/**
 * The effects that show `place`, and where a refusal there is said: your
 * inventory's panel; a thread's end, as `openAt` shows an entry; or a fresh
 * column, shown where it is, or opened again at the end of its root's
 * columns. A fresh column whose root the directory does not name belongs to
 * a new tab, whose history only that tab reaches while it is open, so the
 * layout holds it. A queued `card` is scrolled to in its column's dock,
 * which scrolls apart from the thread (ADR-0113).
 */
export function revealOf(
  place: PlaceKey,
  state: IntentState,
  fresh: string,
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
        return { effects: show(here, state), actedAt: at(place.column) }
      const root = state.rootEntries.get(place.root)
      if (root === undefined || place.at.kind !== "entry")
        return { effects: [], actedAt: at(place.column) }
      return {
        effects: [
          ...show({ kind: "root", root }, state),
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
    // Discarded: drawn nowhere, so nothing comes into view.
    case "gone":
      return { effects: [], actedAt: AT_INVENTORY }
    case "composing":
    case "note":
    case "pinned":
    case "queued": {
      const end =
        placeEnd(place, state.cards.me, state.cards.lanes, state.index) ??
        (place.at.kind === "entry" ? place.at.id : null)
      if (end === null) return { effects: [], actedAt: AT_INVENTORY }
      const plan = planOpen(state.layout, state.index, end)
      return {
        effects: [
          ...planOpenAt(end, state, fresh),
          ...(place.kind === "queued" && card !== null
            ? [{ kind: "revealCard", card } as const]
            : []),
        ],
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
