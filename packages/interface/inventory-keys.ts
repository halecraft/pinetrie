// interface/inventory-keys — the keys that take into the inventory, put, undo
// and redo moves, move through the inventory's grid (ADR-0048 step 4), and
// fold the sidebar (ADR-0088).
// Pure: one table, from a key and where focus is to an intent or nothing.
// The key-system redesign replaces this file.
//
// Take into the inventory is Ctrl+Shift+I and put Ctrl+Shift+O, with Ctrl on a Mac too, where
// it is not Cmd and clashes with nothing. Elsewhere a browser may keep them
// for itself; the panel's buttons and drag still work. Folding the sidebar is
// Ctrl+Shift+L, the same way, beside the control at its foot. Undo and redo of a
// move are Cmd or Ctrl with Z (Shift+Z, or Ctrl+Y, to redo), only outside a
// text box, where they are the box's own text undo (ADR-0052).

import { type CardId, INVENTORY_COLUMNS, INVENTORY_SLOTS } from "@pinetrie/core"
import type { Intent } from "./intent.ts"

/** The part of a `KeyboardEvent` read here. */
export interface KeyLike {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

/** Where focus is when the key is pressed. */
export interface KeyFocus {
  /** The card whose box or heading has focus (`data-card`), if any. */
  readonly card: CardId | null
  /** Focus is in a text box: its undo keys are its own. */
  readonly inText: boolean
  /** Focus is in the inventory panel. */
  readonly inPanel: boolean
  /** The inventory's selected slot, and the card in it. */
  readonly selected: number
  readonly selectedCard: CardId | null
  /** The column that last held focus, by key: where a put lands. */
  readonly column: string | null
  /**
   * A page covers the workspace (ADR-0098): no key but the list's fold acts,
   * since a take, a put or an undo would act on columns no one can see.
   */
  readonly page: boolean
}

const GRID: Readonly<Record<string, GridStep>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  h: "left",
  l: "right",
  k: "up",
  j: "down",
}

/** The intent a key asks for, or null for a key that is not one of these. */
export function keyAct(event: KeyLike, focus: KeyFocus): Intent | null {
  const key = event.key.toLowerCase()
  const chord =
    event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey
  // The sidebar's width (ADR-0088), from anywhere, as the chords below.
  if (chord && key === "l") return { kind: "foldList" }
  if (focus.page) return null
  if (chord && key === "i")
    return focus.card === null
      ? null
      : { kind: "takeIntoInventory", card: focus.card }
  if (chord && key === "o")
    return focus.selectedCard === null || focus.column === null
      ? null
      : {
          kind: "put",
          card: focus.selectedCard,
          target: { kind: "column", key: focus.column },
        }
  if (focus.inText || event.altKey) return null
  const command = event.metaKey !== event.ctrlKey
  if (command && key === "z")
    return {
      kind: "undoMove",
      direction: event.shiftKey ? "redo" : "undo",
      inPanel: focus.inPanel,
    }
  if (event.ctrlKey && !event.metaKey && !event.shiftKey && key === "y")
    return { kind: "undoMove", direction: "redo", inPanel: focus.inPanel }
  const step = GRID[event.key]
  if (!focus.inPanel || step === undefined || event.ctrlKey || event.metaKey)
    return null
  return { kind: "selectSlot", slot: stepSlot(focus.selected, step) }
}

/** A grid move by arrow or `hjkl`. */
export type GridStep = "left" | "right" | "up" | "down"

/** The slot a grid move selects from `from`; it stops at the grid's edge. */
export function stepSlot(from: number, step: GridStep): number {
  const row = Math.floor(from / INVENTORY_COLUMNS)
  const col = from % INVENTORY_COLUMNS
  const rows = INVENTORY_SLOTS / INVENTORY_COLUMNS
  switch (step) {
    case "left":
      return row * INVENTORY_COLUMNS + Math.max(0, col - 1)
    case "right":
      return row * INVENTORY_COLUMNS + Math.min(INVENTORY_COLUMNS - 1, col + 1)
    case "up":
      return Math.max(0, row - 1) * INVENTORY_COLUMNS + col
    case "down":
      return Math.min(rows - 1, row + 1) * INVENTORY_COLUMNS + col
  }
}
