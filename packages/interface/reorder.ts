// interface/reorder — where a column being moved lands. The drag engine
// (`use-drag.ts`) and Alt+arrows (`page-keys.ts`) are its shell.
//
// A gap is a place between columns: gap 0 is before the first, gap n after
// the last of n. A column dropped in the gap either side of itself does not move.

import type { CardId } from "@pinetrie/threads"
/** The gap a pointer at `x` is in: the number of columns whose centre is left of it. */
export function pointerGap(mids: readonly number[], x: number): number {
  return mids.filter(mid => mid < x).length
}

/** The index the column at `from` lands at when dropped in `gap`, or null if it stays put. */
export function landing(from: number, gap: number): number | null {
  if (gap === from || gap === from + 1) return null
  return gap > from ? gap - 1 : gap
}

/** Where Alt+← or Alt+→ moves the column at `from` of `count`, or null for other keys and no move. */
export function keyMove(
  from: number,
  count: number,
  key: string,
): number | null {
  const to =
    key === "ArrowLeft" ? from - 1 : key === "ArrowRight" ? from + 1 : null
  return to === null || to < 0 || to >= count || to === from ? null : to
}

/**
 * The card a drop at `x` on the strip lands after, from each drawn column's
 * card and centre in the strip's content (`mid`), in order: the column
 * before the gap the point is in (`pointerGap`); null for before every one.
 * A file dropped there is put as images in a media column made at that spot.
 */
export function cardBeforeGap(
  columns: readonly { readonly card: CardId; readonly mid: number }[],
  x: number,
): CardId | null {
  const gap = pointerGap(
    columns.map(c => c.mid),
    x,
  )
  return columns[gap - 1]?.card ?? null
}
