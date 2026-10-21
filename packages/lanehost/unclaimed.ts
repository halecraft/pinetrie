// lanehost/unclaimed — a lane's output events that arrive before the `bash`
// call they are of claims its run: the call learns its run from the lane's
// channel, and the observer's events come by another. Held per lane, a
// bounded count, so the bound can make a call undivided, never silently
// short.

import type { OutputEvent } from "@pinetrie/core"

/** How many output events a lane holds for runs no call has claimed. */
export const UNCLAIMED_PER_LANE = 4096

/**
 * How many runs a lane remembers having let go of: their late output (a
 * background job's, after its call returned) is dropped, not held for a
 * claim that never comes.
 */
export const RELEASED_KEPT = 1024

/** One more output event of an unclaimed run: held, or, past the bound, lost. */
export const planUnclaimed = (held: number): "hold" | "lose" =>
  held < UNCLAIMED_PER_LANE ? "hold" : "lose"

/**
 * What a claim delivers first: the run's held events, and, when the bound
 * lost any, an `output-lost` before them, so the call's join is undivided.
 */
export const claimedEvents = (
  held: readonly OutputEvent[],
  lost: number,
): readonly OutputEvent[] =>
  lost > 0 ? [{ kind: "output-lost", count: lost }, ...held] : held
