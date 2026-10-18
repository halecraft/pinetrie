// interface/inventory-state — your inventory panel as this tab holds it: shown
// or not and why, the selected slot, and whether the bench has its card open.
// One reducer, as the search's (`searchReducer`): every act on the panel, from
// a key, a click, a take's landing or an undo, is an `InventoryAct`, and what
// follows is a value the page draws.

import type { MoveTarget } from "@pinetrie/core"

/**
 * Whether the panel is shown, and who opened it, which says who closes it:
 * the person (`held`) by ×, Escape or the toggle; a take while it was closed
 * (`peek`) by its own end; a refusal (`refusal`) by the person acting
 * elsewhere, once they have read it.
 */
export type InventoryShown =
  | { readonly kind: "closed" }
  | { readonly kind: "peek"; readonly id: number }
  | { readonly kind: "held" }
  | { readonly kind: "refusal" }

/** How a plan asks for the panel: held open, a peek, or for a refusal. */
export type ShowHow = "held" | "peek" | "refusal"

export interface InventoryState {
  readonly shown: InventoryShown
  /** How many peeks this tab has made: each names the next, so an old peek's end closes nothing. */
  readonly peeks: number
  readonly selected: number
  /** The selected slot's card opened full on the bench; folded, it is drawn normal. */
  readonly bench: "normal" | "open"
}

export type InventoryAct =
  /** The footer's toggle, and the account menu's. */
  | { readonly kind: "toggle" }
  /** The header's ×. */
  | { readonly kind: "close" }
  | { readonly kind: "show"; readonly how: ShowHow }
  /** A pointer over the panel, focus in it, or a drag over it. */
  | { readonly kind: "engage" }
  | { readonly kind: "peek-ended"; readonly id: number }
  /** A press outside the panel. */
  | { readonly kind: "acted-elsewhere" }
  | { readonly kind: "select"; readonly slot: number }
  /** Enter, or a click on the bench or the selected slot. */
  | { readonly kind: "open" }
  /** Escape with focus in the panel: the bench's card folds, else the panel closes. */
  | { readonly kind: "escape" }

export const INVENTORY_CLOSED: InventoryState = {
  shown: { kind: "closed" },
  peeks: 0,
  selected: 0,
  bench: "normal",
}

/** Whether the panel is drawn shown. */
export const isInventoryShown = (state: InventoryState): boolean =>
  state.shown.kind !== "closed"

/** How long a peek stays: the panel's growth, a card's flight, and a look. */
export const PEEK_MS = 200 + 450 * 2

const HELD: InventoryShown = { kind: "held" }
const CLOSED: InventoryShown = { kind: "closed" }

/** `state` after `act`. A show never lowers what is open: a peek over a held panel leaves it held. */
export function inventoryReducer(
  state: InventoryState,
  act: InventoryAct,
): InventoryState {
  const { shown } = state
  switch (act.kind) {
    // Pressed during a peek or a refusal, the toggle keeps it: what you
    // see open, you mean to hold.
    case "toggle":
      return shown.kind === "held"
        ? { ...state, shown: CLOSED, bench: "normal" }
        : { ...state, shown: HELD }
    case "close":
      return { ...state, shown: CLOSED, bench: "normal" }
    case "show":
      return shown.kind === "held" || act.how === "held"
        ? { ...state, shown: HELD }
        : act.how === "refusal"
          ? { ...state, shown: { kind: "refusal" } }
          : shown.kind === "refusal"
            ? state
            : {
                ...state,
                shown: { kind: "peek", id: state.peeks + 1 },
                peeks: state.peeks + 1,
              }
    case "engage":
      return shown.kind === "peek" || shown.kind === "refusal"
        ? { ...state, shown: HELD }
        : state
    case "peek-ended":
      return shown.kind === "peek" && shown.id === act.id
        ? { ...state, shown: CLOSED, bench: "normal" }
        : state
    case "acted-elsewhere":
      return shown.kind === "refusal"
        ? { ...state, shown: CLOSED, bench: "normal" }
        : state
    case "select":
      return { ...state, selected: act.slot, bench: "normal" }
    case "open":
      return { ...state, bench: "open" }
    case "escape":
      return state.bench === "open"
        ? { ...state, bench: "normal" }
        : { ...state, shown: CLOSED }
  }
}

/**
 * How a moved card flies: in place, or, into your inventory, as a ghost on
 * the page. A slot of a panel still growing from its toggle is scaled, and a
 * card flown inside it starts hundreds of pixels from where it was.
 */
export type Flight = "in-place" | "ghost"

/** How a card moved to `to` flies. */
export const cardFlight = (to: MoveTarget): Flight =>
  to.kind === "inventory" ? "ghost" : "in-place"
