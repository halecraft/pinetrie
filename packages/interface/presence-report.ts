// interface/presence-report — what this page writes about you: which thread end
// each column of the root you are on reads (ADR-0024, ADR-0029), and when you
// are typing, and in which card. PURE: `App` gathers and writes.

import type { CardId } from "@pinetrie/core"

/** Each reported column's key, and the thread end it shows (null: none yet). */
export type Reported = ReadonlyMap<string, string | null>

/**
 * The presence writes that move `reported` to `now`. A column whose end is
 * new is set; a column no longer reported is cleared, so switching tabs
 * clears the last tab's columns, as closing a column does. A column with no
 * message yet (a new tab) shows no thread: it is never set, and one whose
 * end turned null is left as it was.
 */
export function planReading(
  reported: Reported,
  now: Reported,
): {
  readonly set: readonly (readonly [key: string, end: string])[]
  readonly clear: readonly string[]
} {
  const set: (readonly [string, string])[] = []
  for (const [key, end] of now)
    if (end !== null && reported.get(key) !== end) set.push([key, end])
  const clear = [...reported.keys()].filter(key => !now.has(key))
  return { set, clear }
}

/** How often typing is written, at most. */
export const TYPING_EVERY_MS = 1_000

/** The last typing written: when, and in which card (null: none yet). */
export interface TypedLast {
  readonly at: number
  readonly card: CardId | null
}

/**
 * Whether typing at `now` in `card` is written: a second after the last
 * write, or at once in another card, since the host pops no card someone
 * is typing in (ADR-0048 step 7).
 */
export const typingDue = (
  last: TypedLast,
  now: number,
  card: CardId | null,
): boolean => card !== last.card || now - last.at >= TYPING_EVERY_MS
