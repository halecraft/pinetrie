import { describe, expect, test } from "vitest"
import {
  ENTER_AFTER,
  LEAVE_AFTER,
  type LevelReading,
  nextEventState,
  nextLevelState,
  type Tracked,
} from "./hysteresis.ts"

const over: LevelReading<string> = { kind: "over", value: "v" }
const between: LevelReading<string> = { kind: "between", value: "v" }
const clear: LevelReading<string> = { kind: "clear" }
const unmeasured: LevelReading<string> = { kind: "unmeasured" }

/** Each reading stepped in turn from nothing; whether the level was active after each. */
function activeAfter(readings: readonly LevelReading<string>[]): boolean[] {
  let state: Tracked<string> | null = null
  return readings.map(r => {
    state = nextLevelState(state ?? undefined, r)
    return state?.active ?? false
  })
}
const times = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x)

describe("a level", () => {
  test("is active only after ENTER_AFTER readings over in a row", () => {
    expect(activeAfter(times(ENTER_AFTER, over))).toEqual([
      ...times(ENTER_AFTER - 1, false),
      true,
    ])
  })

  test("a reading between its thresholds starts its count again before it is active", () => {
    const readings = [...times(ENTER_AFTER - 1, over), between, over]
    expect(activeAfter(readings).at(-1)).toBe(false)
  })

  test("leaves only after LEAVE_AFTER clear readings in a row, a between one keeping it", () => {
    const entered = times(ENTER_AFTER, over)
    expect(
      activeAfter([...entered, ...times(LEAVE_AFTER - 1, clear), between]).at(
        -1,
      ),
    ).toBe(true)
    const left = activeAfter([...entered, ...times(LEAVE_AFTER, clear)])
    expect(left.at(-2)).toBe(true)
    expect(left.at(-1)).toBe(false)
  })

  test("an unmeasured reading keeps its count", () => {
    const readings = times(ENTER_AFTER, over).flatMap(r => [r, unmeasured])
    expect(activeAfter(readings).at(-1)).toBe(true)
  })
})

describe("an event", () => {
  test("is active the sample it is seen, and gone after LEAVE_AFTER without it", () => {
    let state = nextEventState<string>(undefined, "seen")
    expect(state?.active).toBe(true)
    for (let i = 1; i < LEAVE_AFTER; i++) {
      state = nextEventState(state ?? undefined, null)
      expect(state).not.toBeNull()
    }
    expect(nextEventState(state ?? undefined, null)).toBeNull()
  })
})
