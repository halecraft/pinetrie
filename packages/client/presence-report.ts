// client/presence-report — what this page writes about you: which thread end
// each column of the tab you are on reads (ADR-0024, ADR-0029), and when you
// are typing. PURE: `App` gathers and writes.

/** Each reported column's key, and the thread end it shows (null: none yet). */
export type Reported = ReadonlyMap<string, string | null>

/**
 * The presence writes that move `reported` to `now`. A column whose end is
 * new is set; a column no longer reported is cleared, so switching tabs
 * clears the last tab's columns, as closing a column does. A column with no
 * message yet (a new tab) follows no thread: it is never set, and one whose
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

/** Whether typing at `now` is written, the last write having been at `last`. */
export const typingDue = (last: number, now: number): boolean =>
  now - last >= TYPING_EVERY_MS
