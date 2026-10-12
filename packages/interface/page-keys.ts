// interface/page-keys — the page's own keys, wherever focus is: take into
// the inventory, put, undo and redo moves, and fold the sidebar, and open and
// close a search of the thread's task. A grid's own keys are `grid-keys.ts`'s.
// One table, from a key and where focus is to an intent or nothing.
//
// Take into the inventory is Ctrl+Shift+I and put Ctrl+Shift+O, with Ctrl on a
// Mac too, where it is not Cmd and clashes with nothing. Elsewhere a browser
// may keep them for itself; the panel's buttons and drag still work. Folding
// the sidebar is Ctrl+Shift+L, the same way, beside the control at its foot.
// Undo and redo of a move are Cmd or Ctrl with Z (Shift+Z, or Ctrl+Y, to redo),
// only outside a text box, where they are the box's own text undo. The put key
// puts the card in your hand in the column you were last in, never into a text
// box, which only a paste types into. Cmd+C, Cmd+X and Cmd+V are no keys here:
// they are the page's `copy`, `cut` and `paste` events (`clipboard.ts` in the
// page). `/` opens a search outside a text box; Escape closes it from the
// search itself, its field included. Alt+← and Alt+→ move the column focus is
// in one place, outside a text box, where they move by word, and outside the
// inventory, where they swap slots.

import type { Focus } from "./focus.ts"
import type { Intent } from "./intent.ts"
import { keyMove } from "./reorder.ts"

/** The part of a `KeyboardEvent` read here. */
export interface KeyLike {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

/** The intent a key asks for, or null for a key that is not one of these. */
export function keyAct(event: KeyLike, focus: Focus): Intent | null {
  const key = event.key.toLowerCase()
  const chord =
    event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey
  // The sidebar's width, from anywhere, as the chords below.
  if (chord && key === "l") return { kind: "foldList" }
  if (focus.page) return null
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey
  // Before the text box's guard: the search's field is a text box.
  if (plain && event.key === "Escape" && focus.search === "focused")
    return { kind: "search", act: { kind: "close" } }
  if (chord && key === "i")
    return focus.card === null
      ? null
      : { kind: "takeIntoInventory", card: focus.card }
  if (chord && key === "o")
    return focus.selectedCard === null || focus.column === null
      ? null
      : {
          kind: "put",
          source: { kind: "card", card: focus.selectedCard },
          target: { kind: "column", key: focus.column },
          how: "move",
        }
  const altOnly =
    event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
  if (altOnly && !focus.inText && !focus.inPanel && focus.inColumn !== null) {
    const { card, position, count } = focus.inColumn
    const to = keyMove(position, count, event.key)
    return to === null
      ? null
      : { kind: "moveColumn", column: { kind: "card", card }, to }
  }
  if (focus.inText || event.altKey) return null
  if (plain && event.key === "/" && focus.search !== "unavailable")
    return { kind: "search", act: { kind: "open" } }
  const command = event.metaKey !== event.ctrlKey
  if (command && key === "z")
    return {
      kind: "undoMove",
      direction: event.shiftKey ? "redo" : "undo",
      inPanel: focus.inPanel,
    }
  if (event.ctrlKey && !event.metaKey && !event.shiftKey && key === "y")
    return { kind: "undoMove", direction: "redo", inPanel: focus.inPanel }
  return null
}
