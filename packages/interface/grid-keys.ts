// interface/grid-keys — the keys a grid takes while it has focus (ADR-0048):
// your inventory's, and a column's messages as a grid one cell wide
// (ADR-0126). Arrows and `hjkl` move the selection, Alt+arrows move the
// selected card a cell, Enter opens it, Escape folds it again, and `c`
// comments on a column's selected entry.
// Pure: one table, from a key and the grid's state to an act or nothing. The
// key-system redesign replaces this file.

import { type Grid, type GridStep, step } from "@pinetrie/core"
import type { KeyLike } from "./page-keys.ts"

export type GridAct =
  | { readonly kind: "select"; readonly cell: number }
  /** The selected card to `to`: a swap with a card there. */
  | { readonly kind: "move"; readonly from: number; readonly to: number }
  | { readonly kind: "open" }
  | { readonly kind: "fold" }
  /** Comment on the selected entry: a note in its margin (ADR-0126). */
  | { readonly kind: "comment" }

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
  /** The rows drawn: a move stops at the last. */
  readonly rows: number
  readonly selected: number
  /** The selected cell holds a card. */
  readonly hasCard: boolean
  /** The selected card is open, whole. */
  readonly open: boolean
  /** Focus is in a text box: the open card's, whose keys are its own. */
  readonly inText: boolean
  /** Its cells are entries that take comments: a column's messages. */
  readonly comments: boolean
}

/** The act a key asks of a grid, or null for none of its keys. */
export function gridKeyAct(event: KeyLike, at: GridKeyState): GridAct | null {
  if (event.key === "Escape")
    return at.open && !event.altKey && !event.ctrlKey && !event.metaKey
      ? { kind: "fold" }
      : null
  if (at.inText || event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (event.key === "Enter")
    return event.altKey || !at.hasCard ? null : { kind: "open" }
  if (event.key === "c")
    return at.comments && at.hasCard && !event.altKey
      ? { kind: "comment" }
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
