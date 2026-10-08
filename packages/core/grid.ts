// core/grid — the one grid rule for your inventory and a thread's notes
// board (ADR-0048, ADR-0113). A cell is an index in reading order, as an
// inventory slot is: an address, the same for everyone, and a gap stays a
// gap. Pure.

/** A grid: its width, and its rows, fixed or growing with what it holds. */
export interface Grid {
  readonly width: number
  /** A fixed count, or "grows": one empty row below the last taken one. */
  readonly rows: number | "grows"
}

/** A move through a grid by arrow or `hjkl`. */
export type GridStep = "left" | "right" | "up" | "down"

/** Your inventory: 3 rows of 6. */
export const INVENTORY_GRID = { width: 6, rows: 3 } as const satisfies Grid

/** How many cards an inventory holds: every cell of its grid (ADR-0048). */
export const INVENTORY_SLOTS = INVENTORY_GRID.width * INVENTORY_GRID.rows

/** A thread's notes board: 4 wide, growing a row at a time. */
export const NOTES_GRID: Grid = { width: 4, rows: "grows" }

/** Whether `n` is a cell of `grid` (any row, for one that grows). */
export const isCell = (grid: Grid, n: number): boolean =>
  Number.isInteger(n) &&
  n >= 0 &&
  (grid.rows === "grows" || n < grid.width * grid.rows)

/**
 * The rows drawn: a fixed grid's own; a growing one's last taken row and
 * one empty row below it.
 */
export function rowsShown(grid: Grid, taken: ReadonlySet<number>): number {
  if (grid.rows !== "grows") return grid.rows
  const last = Math.max(-1, ...taken)
  return Math.floor(last / grid.width) + 2
}

/**
 * The first empty cell in reading order, from `start` if it is empty; null
 * when a fixed grid is full. A growing grid always has one.
 */
export function firstEmpty(
  grid: Grid,
  taken: ReadonlySet<number>,
  start?: number,
): number | null {
  if (start !== undefined && isCell(grid, start) && !taken.has(start))
    return start
  const cells = grid.rows === "grows" ? taken.size + 1 : grid.width * grid.rows
  for (let n = 0; n < cells; n++) if (!taken.has(n)) return n
  return null
}

/** The cell a move selects from `from` in `rows` rows; it stops at the grid's edge. */
export function step(
  grid: Grid,
  rows: number,
  from: number,
  dir: GridStep,
): number {
  const { width } = grid
  const row = Math.floor(from / width)
  const col = from % width
  switch (dir) {
    case "left":
      return row * width + Math.max(0, col - 1)
    case "right":
      return row * width + Math.min(width - 1, col + 1)
    case "up":
      return Math.max(0, row - 1) * width + col
    case "down":
      return Math.min(rows - 1, row + 1) * width + col
  }
}
