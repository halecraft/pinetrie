// interface/column-menu — a card column's ⋯ (ADR-0116): what it offers for
// the canvas everyone shares, as values: its width, one column or two, the
// card's and the same for everyone; a note column made just after it; and
// for a thread's card, a copy here or in your inventory, and a take into
// your inventory (ADR-0127). Pure: the page's columns draw it.

import { type CardId, type CardWidth, isThreadId } from "@pinetrie/core"
import { moveWords } from "./card-frame.ts"
import type { Intent } from "./intent.ts"

/** One item of a column's ⋯. */
export interface ColumnMenuItem {
  readonly key: string
  readonly label: string
  readonly title: string
  readonly intent: Intent
}

/** A run of a column's ⋯: the canvas's own items, or a thread's. */
export interface ColumnMenuSection {
  readonly key: "canvas" | "thread"
  readonly items: readonly ColumnMenuItem[]
}

/**
 * What a column's ⋯ offers for its card `card`, now `width` columns wide.
 * It lists no task: a thread reaches another task through your inventory
 * (ADR-0127).
 */
export function columnMenu(input: {
  readonly card: CardId
  readonly width: CardWidth
}): readonly ColumnMenuSection[] {
  const wide = input.width === 2
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
      {
        key: "note-column",
        label: "Add a note column here",
        title: "a new note column just after this one, for everyone",
        intent: { kind: "addNoteColumn", after: input.card },
      },
    ],
  }
  if (!isThreadId(input.card)) return [canvas]
  const source = input.card
  return [
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

/** The task column's own way to make a note column: first on the canvas. */
export const FIRST_NOTE_COLUMN = {
  label: "+ note column",
  title: "a new note column first on the canvas, for everyone",
  className: "add-note-column",
} as const

/** The ⋯'s own name, for a screen reader. */
export const COLUMN_MENU_LABEL = "more for this column, for everyone"
