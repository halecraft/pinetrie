// machine/freshness — whether the reading the gate holds lanes on is still
// fresh, counted in ticks of the sample timer, never in time: a sample may
// never end (an await with no bound), and a reading no sample replaces must
// not hold a lane for as long as the host runs.

/**
 * Ticks of the sample timer with no fresh sample ended, after which the
 * reading holds nothing. Through an hour at a 15–20% memory stall, samples
 * were measured ending every tick (one row each 5 s), so six leaves a
 * sample five ticks to spare.
 */
export const READING_OVERDUE_AFTER_TICKS = 6

export interface FreshnessState {
  /** Ticks counted since the host started. */
  readonly ticks: number
  /** The tick the last fresh sample ended at; null before the first. */
  readonly lastFreshEnd: number | null
  /** The tick the reading went overdue at; null while fresh. */
  readonly overdueAt: number | null
}

export const FIRST_FRESHNESS: FreshnessState = {
  ticks: 0,
  lastFreshEnd: null,
  overdueAt: null,
}

export const isOverdue = (state: FreshnessState): boolean =>
  state.overdueAt !== null

/**
 * A tick counted: overdue once `bound` ticks pass since the last fresh end,
 * or since the host started before any.
 */
export function nextTickFreshness(
  state: FreshnessState,
  bound: number,
): FreshnessState {
  const ticks = state.ticks + 1
  if (state.overdueAt !== null) return { ...state, ticks }
  const since = ticks - (state.lastFreshEnd ?? 0)
  return { ...state, ticks, overdueAt: since >= bound ? ticks : null }
}

/**
 * A sample that started at `startedAt` ended: fresh, unless it started
 * before the tick the reading went overdue, as a sample that hung did. A
 * tick is counted before the sample it queues starts, so one that reads
 * `overdueAt` started after it. A fresh end makes the reading fresh again.
 */
export function sampleEndFreshness(
  state: FreshnessState,
  startedAt: number,
): { readonly state: FreshnessState; readonly isFresh: boolean } {
  if (state.overdueAt !== null && startedAt < state.overdueAt)
    return { state, isFresh: false }
  return {
    state: { ...state, lastFreshEnd: state.ticks, overdueAt: null },
    isFresh: true,
  }
}
