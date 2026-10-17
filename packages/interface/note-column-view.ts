// interface/note-column-view — a canvas's note columns as the page draws them:
// each a title and its notes in one order, a column of the canvas at its rank
// there (`canvasColumns`). `NoteColumn` (`packages/web/note-column.tsx`) draws
// one.

import type { CardRecord, NoteColumnId, NoteColumnRecord } from "@pinetrie/core"
import {
  type CardOnCanvas,
  NEW_NOTES_TITLE,
  type NoteCard,
  notesIn,
} from "@pinetrie/rules"

/** One note column, as drawn. */
export interface NoteColumnView {
  readonly column: NoteColumnId
  /** Its title, or `NEW_NOTES_TITLE` while it has none. */
  readonly title: string
  /** Its stored title, or null: what the rename field starts with. */
  readonly titled: string | null
  /** Its notes, in order. */
  readonly notes: readonly NoteCard[]
}

/** `canvas`'s note columns, in its order, each with its notes from `cards`. */
export function canvasNoteColumns(input: {
  readonly onCanvas: readonly CardOnCanvas[]
  readonly cards: readonly CardRecord[]
  readonly titles: ReadonlyMap<NoteColumnId, NoteColumnRecord>
}): readonly NoteColumnView[] {
  return input.onCanvas.flatMap(c => {
    if (c.kind !== "note-column") return []
    const titled = input.titles.get(c.id)?.title ?? null
    return [
      {
        column: c.id,
        title: titled ?? NEW_NOTES_TITLE,
        titled,
        notes: notesIn(input.cards, c.id),
      },
    ]
  })
}

/** A note column's notes: how many there are. */
export const noteCountWords = (n: number): string =>
  n === 0 ? "no notes" : n === 1 ? "1 note" : `${n} notes`

/** A note column with none: where a drop makes one. */
export const NOTES_EMPTY = "drop a card here to make it a note"
