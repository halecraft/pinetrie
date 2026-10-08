// interface/grid-keys — the keys a card grid takes while it has focus
// (ADR-0048, ADR-0113): arrows and `hjkl` move the selection, Alt+arrows
// move the selected card a cell, Enter opens it (on an empty cell of a grid
// that makes cards, a new card there), and Escape folds it again.
// Pure: one table, from a key and the grid's state to an act or nothing. The
// key-system redesign replaces this file.

import { type Grid, type GridStep, step } from "@pinetrie/core"
import type { KeyLike } from "./inventory-keys.ts"

export type GridAct =
  | { readonly kind: "select"; readonly cell: number }
  /** The selected card to `to`: a swap with a card there. */
  | { readonly kind: "move"; readonly from: number; readonly to: number }
  | { readonly kind: "open" }
  /** A new card in the selected cell, empty, opened. */
  | { readonly kind: "create" }
  | { readonly kind: "fold" }

const STEPS: Readonly<Record<string, GridStep>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  h: "left",
  l: "right",
  k: "up",
  j: "down",
}

/** What a grid is when a key is pressed. */
export interface GridKeyState {
  readonly grid: Grid
  /** The rows drawn (`rowsShown`): a move stops at the last. */
  readonly rows: number
  readonly selected: number
  /** The selected cell holds a card. */
  readonly hasCard: boolean
  /** An empty cell makes a new card: a notes board's, not your inventory's. */
  readonly creates: boolean
  /** The selected card is open, whole. */
  readonly open: boolean
  /** Focus is in a text box: the open card's, whose keys are its own. */
  readonly inText: boolean
}

/** The act a key asks of a grid, or null for none of its keys. */
export function gridKeyAct(event: KeyLike, at: GridKeyState): GridAct | null {
  if (event.key === "Escape")
    return at.open && !event.altKey && !event.ctrlKey && !event.metaKey
      ? { kind: "fold" }
      : null
  if (at.inText || event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (event.key === "Enter")
    return event.altKey
      ? null
      : at.hasCard
        ? { kind: "open" }
        : at.creates
          ? { kind: "create" }
          : null
  const dir = STEPS[event.key]
  if (dir === undefined) return null
  const to = step(at.grid, at.rows, at.selected, dir)
  if (!event.altKey) return { kind: "select", cell: to }
  // A move: only with a card, and only to another cell.
  return at.hasCard && to !== at.selected
    ? { kind: "move", from: at.selected, to }
    : null
}
