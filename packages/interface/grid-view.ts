// interface/grid-view — your inventory's slots as they are drawn (ADR-0048):
// cells in reading order, each a face or empty, the selection, and its rows
// (core's `grid.ts`). Pure: `inventoryView` builds one,
// and `CardGrid` (`packages/web/card-grid.tsx`) draws it.

import type { CardId, CardRecord, Grid, ThreadId } from "@pinetrie/core"
import { type CardFaceView, type CardTone, cardFace } from "./card-frame.ts"
import type { ThreadFace } from "./thread-face.ts"

export interface GridCell {
  readonly index: number
  /** Its card, and the card folded; null for an empty cell. */
  readonly card: CardRecord | null
  readonly face: CardFaceView | null
  /** A thread's card: its face (ADR-0124); null for any other. */
  readonly thread: ThreadFace | null
  readonly selected: boolean
}

export interface GridView {
  readonly grid: Grid
  readonly rows: number
  readonly cells: readonly GridCell[]
  readonly selected: number
  /** The selected cell's card; null when it is empty. */
  readonly card: CardRecord | null
}

/**
 * `placed` (cell to card) drawn on `grid` as `tone`, `selected` selected.
 * `keyOf` labels a cell's face (the inventory's 1–9).
 */
export function gridView(input: {
  readonly grid: Grid
  readonly tone: CardTone
  readonly placed: ReadonlyMap<number, CardRecord>
  readonly selected: number
  /** Each card's text, by id; one not yet read is "". */
  readonly texts: ReadonlyMap<CardId, string>
  /** Each thread's face, by its id; one without is drawn by its card's face. */
  readonly threads?: ReadonlyMap<ThreadId, ThreadFace>
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
          : cardFace(card, input.texts.get(card.id) ?? "", {
              tone: input.tone,
              key: input.keyOf?.(index) ?? null,
            }),
      thread:
        card?.kind === "thread" ? (input.threads?.get(card.id) ?? null) : null,
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
