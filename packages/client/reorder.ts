// client/reorder — where a column being moved lands. Pure; `use-column-drag.ts`
// and the header's grip are its shell.
//
// A gap is a place between columns: gap 0 is before the first, gap n after
// the last of n. A column dropped in the gap either side of itself does not move.

/** The gap a pointer at `x` is in: the number of columns whose centre is left of it. */
export function gapAt(mids: readonly number[], x: number): number {
  return mids.filter(mid => mid < x).length
}

/** The index the column at `from` lands at when dropped in `gap`, or null if it stays put. */
export function landing(from: number, gap: number): number | null {
  if (gap === from || gap === from + 1) return null
  return gap > from ? gap - 1 : gap
}

/** Where a key on its grip moves the column at `from` of `count`, or null for other keys and no move. */
export function keyMove(
  from: number,
  count: number,
  key: string,
): number | null {
  const to =
    key === "ArrowLeft"
      ? from - 1
      : key === "ArrowRight"
        ? from + 1
        : key === "Home"
          ? 0
          : key === "End"
            ? count - 1
            : null
  return to === null || to < 0 || to >= count || to === from ? null : to
}

/** How near an edge, in px, the strip starts to scroll. */
export const EDGE_ZONE = 48
/** The fastest the strip scrolls, in px a frame. */
export const EDGE_SPEED = 18

/**
 * How far to scroll the strip this frame, with the pointer at `x` and the
 * strip between `left` and `right`: faster the nearer an edge, negative near the
 * left one, zero outside both zones.
 */
export function edgeScroll(x: number, left: number, right: number): number {
  const pull = (away: number) =>
    Math.round(EDGE_SPEED * (1 - Math.max(away, 0) / EDGE_ZONE))
  // `0 -`, not unary minus: no pull is 0, never -0.
  if (x - left < EDGE_ZONE) return 0 - pull(x - left)
  if (right - x < EDGE_ZONE) return pull(right - x)
  return 0
}
