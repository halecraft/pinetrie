// machine/hysteresis — a level's and an event's count from sample to sample:
// what the health value's causes and the memory rungs share. Every threshold
// counts samples, never time: the lane VM runs after the Mac's own work, so a
// sample may come late, and a count stays what it means.

/** Samples in a row over a level's threshold before it is active. */
export const ENTER_AFTER = 3
/** Samples in a row under a level's lower threshold, or without its event, before it leaves. */
export const LEAVE_AFTER = 6

/**
 * One level's or event's count, carrying `value` as last measured.
 * Inactive, `count` is samples in a row over its threshold; active,
 * samples in a row clear of its lower one (or, for an event, without it).
 */
export interface Tracked<V> {
  readonly active: boolean
  readonly count: number
  readonly value: V
}

/** What a sample says of one level: over its threshold, clear of its lower one, or between. */
export type LevelReading<V> =
  | { readonly kind: "over"; readonly value: V }
  | { readonly kind: "between"; readonly value: V }
  | { readonly kind: "clear" }
  /** Not measured this sample: counts stay as they are. */
  | { readonly kind: "unmeasured" }

/** A level's next state from what this sample read; null once it is neither active nor counting. */
export function nextLevelState<V>(
  was: Tracked<V> | undefined,
  reading: LevelReading<V>,
): Tracked<V> | null {
  if (reading.kind === "unmeasured") return was ?? null
  if (was === undefined || !was.active) {
    if (reading.kind !== "over") return null
    const count = (was?.count ?? 0) + 1
    return count >= ENTER_AFTER
      ? { active: true, count: 0, value: reading.value }
      : { active: false, count, value: reading.value }
  }
  if (reading.kind !== "clear")
    return { active: true, count: 0, value: reading.value }
  const count = was.count + 1
  return count >= LEAVE_AFTER ? null : { ...was, count }
}

/** An event's next state: active the sample it is seen, gone after `LEAVE_AFTER` without it. */
export function nextEventState<V>(
  was: Tracked<V> | undefined,
  seen: V | null,
): Tracked<V> | null {
  if (seen !== null) return { active: true, count: 0, value: seen }
  if (was === undefined) return null
  const count = was.count + 1
  return count >= LEAVE_AFTER ? null : { ...was, count }
}
