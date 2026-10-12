// interface/column-menu — a card column's ⋯, as values: first what is yours
// alone, its fold; then what changes the canvas everyone shares.

import { type CardId, type CardWidth, isThreadId } from "@pinetrie/core"
import { moveWords } from "./card-frame.ts"
import { FOLD } from "./folded-column-view.ts"
import type { Intent } from "./intent.ts"

export interface ColumnMenuItem {
  readonly key: string
  readonly label: string
  readonly title: string
  readonly intent: Intent
}

/** A run of a column's ⋯: yours alone, the canvas's own items, or a thread's. */
export interface ColumnMenuSection {
  readonly key: "yours" | "canvas" | "thread"
  readonly items: readonly ColumnMenuItem[]
}

/**
 * What a column's ⋯ offers for its card `card`, now `width` columns wide.
 * It lists no task: a thread reaches another task through your inventory.
 */
export function columnMenu(input: {
  readonly card: CardId
  readonly width: CardWidth
}): readonly ColumnMenuSection[] {
  const wide = input.width === 2
  const yours: ColumnMenuSection = {
    key: "yours",
    items: [
      {
        key: "fold",
        label: "Fold",
        title: FOLD.title,
        intent: { kind: "fold", card: input.card, unfolded: false },
      },
    ],
  }
  const canvas: ColumnMenuSection = {
    key: "canvas",
    items: [
      {
        key: "width",
        label: wide ? "Make narrow" : "Make wide",
        title: wide
          ? "draw it one column wide, for everyone"
          : "draw it two columns wide, for everyone",
        intent: { kind: "cardWidth", card: input.card, width: wide ? 1 : 2 },
      },
    ],
  }
  if (!isThreadId(input.card)) return [yours, canvas]
  const source = input.card
  return [
    yours,
    canvas,
    {
      key: "thread",
      items: [
        {
          key: "copy",
          label: "Copy to this task",
          title: "a new thread forked at this one's end, just after it",
          intent: { kind: "copyThread", source, to: "here" },
        },
        {
          key: "copy-inventory",
          label: "Copy to your inventory",
          title: "a new thread forked at this one's end, in your inventory",
          intent: { kind: "copyThread", source, to: "inventory" },
        },
        {
          key: "take",
          label: moveWords("inventory").label,
          title:
            "put this thread away: its run stops, and only you can open it",
          intent: { kind: "takeIntoInventory", card: source },
        },
      ],
    },
  ]
}

/** The ⋯'s own name, for a screen reader. */
export const COLUMN_MENU_LABEL = "more for this column"
