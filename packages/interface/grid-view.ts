// interface/grid-view — your inventory's slots as they are drawn: cells in
// reading order, each a compact or empty, the selection, and its rows.

import type {
  CardId,
  Grid,
  NoteColumnId,
  ThreadId,
  ThreadName,
  WriterId,
} from "@pinetrie/core"
import type { CardTone } from "./card-frame.ts"
import { type Compact, cardCompact, type DrawnCard } from "./compact.ts"
import { isDiscardable } from "./discardable.ts"
import type { NoteColumnView } from "./note-column-view.ts"
import type { ThreadGlance } from "./thread-glance.ts"

export interface GridCell {
  readonly index: number
  /** Its card, and the card at its least detail (`cardCompact`); null for an empty cell. */
  readonly card: DrawnCard | null
  readonly compact: Compact | null
  readonly selected: boolean
  /** Whether its card may be trashed from here (`isDiscardable`): the bench's trash and Delete. */
  readonly discards: boolean
}

export interface GridView {
  readonly grid: Grid
  readonly rows: number
  readonly cells: readonly GridCell[]
  readonly selected: number
  /** The selected cell's card; null when it is empty. */
  readonly card: DrawnCard | null
}

const NONE: ReadonlyMap<never, never> = new Map<never, never>()

/**
 * `placed` (cell to card) drawn on `grid` as `tone`, `selected` selected.
 * `keyOf` labels a cell's compact (the inventory's 1–9).
 */
export function gridView(input: {
  readonly grid: Grid
  readonly tone: CardTone
  readonly placed: ReadonlyMap<number, DrawnCard>
  readonly selected: number
  /** Who draws it: whose cards the bench's trash and Delete may trash. */
  readonly me: WriterId
  /** Each card's text, by id; one not yet read is "". */
  readonly texts: ReadonlyMap<CardId, string>
  /** Each thread's glance, by its id. */
  readonly threads?: ReadonlyMap<ThreadId, ThreadGlance>
  /** Each note column, as its column draws it. */
  readonly notes?: ReadonlyMap<NoteColumnId, NoteColumnView>
  /** Each thread's name, which a reference names as where it is from. */
  readonly threadNames?: ReadonlyMap<ThreadId, ThreadName>
  readonly keyOf?: (cell: number) => string | null
}): GridView {
  const { rows } = input.grid
  const cells = Array.from({ length: rows * input.grid.width }, (_, index) => {
    const card = input.placed.get(index) ?? null
    return {
      index,
      card,
      compact:
        card === null
          ? null
          : cardCompact(card, {
              tone: input.tone,
              key: input.keyOf?.(index) ?? null,
              texts: input.texts,
              threads: input.threads ?? NONE,
              notes: input.notes ?? NONE,
              threadNames: input.threadNames ?? NONE,
            }),
      selected: index === input.selected,
      discards: card !== null && isDiscardable(card, input.me),
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
