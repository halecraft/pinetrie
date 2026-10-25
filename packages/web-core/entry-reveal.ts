// web-core/entry-reveal — how far a column's messages scroll when its keys
// select an entry: its top into view, and as much below it as fits. A click
// selects what is already in view, so it scrolls nothing.

/** A box's top and bottom, both in one coordinate space. */
interface Extent {
  readonly top: number
  readonly bottom: number
}

/**
 * The scroll, in pixels down, that brings `entry` into `view`: none while it
 * is wholly in view; up to its top when its top is above; down towards its
 * bottom when its bottom is below, but never so far its top leaves, so an
 * entry taller than the view shows its top.
 */
export function entryRevealScroll(entry: Extent, view: Extent): number {
  if (entry.top < view.top) return entry.top - view.top
  if (entry.bottom > view.bottom)
    return Math.min(entry.bottom - view.bottom, entry.top - view.top)
  return 0
}
