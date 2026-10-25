// threads/grid — the one grid rule for your inventory. A cell is an index in
// reading order: an address, the same for everyone, and a gap stays a gap.

/** A grid: its width, and its rows. */
export interface Grid {
  readonly width: number
  readonly rows: number
}

/** A move through a grid by arrow or `hjkl`. */
export type GridStep = "left" | "right" | "up" | "down"

/** Your inventory: 6 rows of 2, two compact slots to a column. */
export const INVENTORY_GRID = { width: 2, rows: 6 } as const satisfies Grid

/** How many cards an inventory holds: every cell of its grid. */
export const INVENTORY_SLOTS = INVENTORY_GRID.width * INVENTORY_GRID.rows

/**
 * The grid that draws an inventory of `inventoryCount` cards: the
 * inventory's, with a row for every two past its slots while it has more (a
 * limit lowered, or cards an undo brought back), so none of its cards is out
 * of sight. Takes still aim at `INVENTORY_GRID` alone.
 */
export const inventoryGrid = (inventoryCount: number): Grid => ({
  width: INVENTORY_GRID.width,
  rows: Math.max(
    INVENTORY_GRID.rows,
    Math.ceil(inventoryCount / INVENTORY_GRID.width),
  ),
})

/** Whether `n` is a cell of `grid`. */
export const isCell = (grid: Grid, n: number): boolean =>
  Number.isInteger(n) && n >= 0 && n < grid.width * grid.rows

/** The first empty cell in reading order, from `start` if it is empty; null when the grid is full. */
export function firstEmpty(
  grid: Grid,
  taken: ReadonlySet<number>,
  start?: number,
): number | null {
  if (start !== undefined && isCell(grid, start) && !taken.has(start))
    return start
  for (let n = 0; n < grid.width * grid.rows; n++) if (!taken.has(n)) return n
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
