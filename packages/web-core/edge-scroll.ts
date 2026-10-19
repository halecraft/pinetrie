// web-core/edge-scroll — how fast a strip or a column scrolls under a drag
// held near its edge, in px a frame. Where a moved column lands is
// interface's (`reorder.ts`).

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
