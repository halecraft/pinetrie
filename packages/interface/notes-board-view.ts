// interface/notes-board-view — what a thread's notes board draws (ADR-0113):
// its notes in their cells on `NOTES_GRID`, 4 wide and growing. Pure.
//
// The host gives every note a cell, but it counts the notes of a thread
// with no lane by where each was made (`boardOf`, `@pinetrie/rules`), so two
// of one thread can claim a cell. The board draws the older (by id) there
// and the other in the next empty cell, as it draws a note with no cell yet.

import {
  type CardId,
  type CardRecord,
  firstEmpty,
  NOTES_GRID,
} from "@pinetrie/core"
import { type GridView, gridView } from "./grid-view.ts"

/** Cell to note, as drawn: each note in its own cell, or the next empty. */
export function notesPlaced(
  notes: readonly CardRecord[],
): ReadonlyMap<number, CardRecord> {
  const placed = new Map<number, CardRecord>()
  const byId = [...notes].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  const wait: CardRecord[] = []
  for (const note of byId) {
    const cell = note.place.kind === "note" ? note.place.cell : null
    if (cell === null || placed.has(cell)) wait.push(note)
    else placed.set(cell, note)
  }
  for (const note of wait)
    placed.set(
      firstEmpty(NOTES_GRID, new Set(placed.keys())) ?? placed.size,
      note,
    )
  return placed
}

export function notesBoardView(input: {
  readonly notes: readonly CardRecord[]
  readonly selected: number
  /** Each note's text, by id; one not yet read is "". */
  readonly texts: ReadonlyMap<CardId, string>
}): GridView {
  return gridView({
    grid: NOTES_GRID,
    tone: "note",
    placed: notesPlaced(input.notes),
    selected: input.selected,
    texts: input.texts,
  })
}
