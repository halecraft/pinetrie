// interface/align — where a newly shown column is placed.
//
// A column opens with its first message level with its fork point in the
// column that shows it: by scrolling, or by a spacer above its first message
// when the fork point is lower than that message. A spacer only ever reaches
// a point on screen, so it is never taller than the view it lines up with.
// A fork point below its column's view is no fork point: level with it would
// be off screen, behind blank space.

/** What alignment measures, in px from the top of the new column's body. */
interface Placing {
  /**
   * The fork point's top, and the bottom of the viewport of the column that
   * shows it. Null when no other column shows it.
   */
  readonly fork: { readonly top: number; readonly shownTo: number } | null
  /** The first message's offset in the body's content, not counting the spacer. Null when there is none. */
  readonly first: number | null
}

export type Placement =
  /** At its end, as a column with no fork point opens. */
  | { readonly kind: "end" }
  | {
      readonly kind: "level"
      readonly spacer: number
      readonly scrollTop: number
    }

export function placement(p: Placing): Placement {
  const { fork, first } = p
  if (fork === null || first === null || fork.top >= fork.shownTo)
    return { kind: "end" }
  // Above its view, a fork point is met by scrolling alone: first > top.
  return first >= fork.top
    ? { kind: "level", spacer: 0, scrollTop: first - fork.top }
    : { kind: "level", spacer: fork.top - first, scrollTop: 0 }
}
