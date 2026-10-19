// interface/column-motion — which column a layout action folds or unfolds,
// and which way: what any client animates, or ignores. How the page moves
// it is web-core's (`planFoldMotion`).

import type { ColumnKey } from "./columns.ts"
import type { LayoutAction } from "./layout.ts"

/** A column's fold, as its layout action names it, and which way. */
export interface ColumnMotion {
  readonly column: ColumnKey
  readonly unfolded: boolean
}

/** The column a layout action folds or unfolds, and which way; null for any other action. */
export function foldMotion(action: LayoutAction): ColumnMotion | null {
  if (action.kind !== "view") return null
  const { change } = action
  switch (change.kind) {
    case "fold":
      return {
        column: { kind: "card", card: change.card },
        unfolded: change.unfolded,
      }
    case "fold-canvas":
      return {
        column: { kind: "canvas", canvas: action.canvas },
        unfolded: change.unfolded,
      }
    default:
      return null
  }
}
