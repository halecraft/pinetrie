// interface/grid-view — your inventory's slots as they are drawn (ADR-0048):
// cells in reading order, each a face or empty, the selection, and its rows
// (core's `grid.ts`). Pure: `inventoryView` builds one,
// and `CardGrid` (`packages/web/card-grid.tsx`) draws it.

import type { CardId, Grid, NoteColumnId, ThreadId } from "@pinetrie/core"
import type { CardTone } from "./card-frame.ts"
import { type DrawnCard, type Face, faceOf } from "./face.ts"
import type { NoteColumnView } from "./note-column-view.ts"
import type { ThreadFace } from "./thread-face.ts"

export interface GridCell {
  readonly index: number
  /** Its card, and the card at its least detail (`faceOf`); null for an empty cell. */
  readonly card: DrawnCard | null
  readonly face: Face | null
  readonly selected: boolean
}

export interface GridView {
  readonly grid: Grid
  readonly rows: number
  readonly cells: readonly GridCell[]
  readonly selected: number
  /** The selected cell's card; null when it is empty. */
  readonly card: DrawnCard | null
}

/**
 * `placed` (cell to card) drawn on `grid` as `tone`, `selected` selected.
 * `keyOf` labels a cell's face (the inventory's 1–9).
 */
const NONE: ReadonlyMap<never, never> = new Map<never, never>()

export function gridView(input: {
  readonly grid: Grid
  readonly tone: CardTone
  readonly placed: ReadonlyMap<number, DrawnCard>
  readonly selected: number
  /** Each card's text, by id; one not yet read is "". */
  readonly texts: ReadonlyMap<CardId, string>
  /** Each thread's face, by its id (ADR-0124). */
  readonly threads?: ReadonlyMap<ThreadId, ThreadFace>
  /** Each note column, as its column draws it. */
  readonly notes?: ReadonlyMap<NoteColumnId, NoteColumnView>
  readonly keyOf?: (cell: number) => string | null
}): GridView {
  const { rows } = input.grid
  const cells = Array.from({ length: rows * input.grid.width }, (_, index) => {
    const card = input.placed.get(index) ?? null
    return {
      index,
      card,
      face:
        card === null
          ? null
          : faceOf(card, {
              tone: input.tone,
              key: input.keyOf?.(index) ?? null,
              texts: input.texts,
              threads: input.threads ?? NONE,
              notes: input.notes ?? NONE,
            }),
      selected: index === input.selected,
    }
  })
  return {
    grid: input.grid,
    rows,
    cells,
    selected: input.selected,
    card: input.placed.get(input.selected) ?? null,
  }
}
