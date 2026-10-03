// client/inventory-keys — the keys that take, put, undo and redo moves, and
// move through the inventory's grid (ADR-0048 step 4). Pure: one table, from
// a key and where focus is to an intent or nothing. The key-system redesign
// replaces this file.
//
// Take is Ctrl+Shift+I and put Ctrl+Shift+O, with Ctrl on a Mac too, where
// it is not Cmd and clashes with nothing. Elsewhere a browser may keep them
// for itself; the panel's buttons and drag still work. Undo and redo of a
// move are Cmd or Ctrl with Z (Shift+Z, or Ctrl+Y, to redo), only outside a
// text box, where they are the box's own text undo (ADR-0052).

import type { CardId } from "@pineta/core"
import type { Intent } from "./intent.ts"
import { type GridStep, stepSlot } from "./inventory.ts"

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
  if (chord && key === "i")
    return focus.card === null ? null : { kind: "take", card: focus.card }
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
