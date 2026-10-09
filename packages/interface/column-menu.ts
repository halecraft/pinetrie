// interface/column-menu — a card column's ⋯ (ADR-0116): what it offers for
// the canvas everyone shares, as values: its width, one column or two, the
// card's and the same for everyone; and a note column made just after it.
// Pure: the page's columns draw it.

import type { CardId, CardWidth } from "@pinetrie/core"
import type { Intent } from "./intent.ts"

/** One item of a column's ⋯. */
export interface ColumnMenuItem {
  readonly key: string
  readonly label: string
  readonly title: string
  readonly intent: Intent
}

/** What a column's ⋯ offers for its card `card`, now `width` columns wide. */
export function columnMenu(input: {
  readonly card: CardId
  readonly width: CardWidth
}): readonly ColumnMenuItem[] {
  const wide = input.width === 2
  return [
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
