import fc from "fast-check"
import { describe, expect, test } from "vitest"
import { ENTER_AFTER, LEAVE_AFTER } from "./hysteresis.ts"
import { FIRST_RUNG_STATE, planRung, RUNG_BOUNDS, type Rung } from "./rung.ts"
import type { MachineSample } from "./sample.ts"

type Machine = MachineSample["machine"]
const GiB = 1024 ** 3

/** A machine of 10 GiB with `available` GiB free and `full avg10` of `full`; `some` the same unless given. */
const machine = (full: number | null, available = 8, some = full): Machine => ({
  memoryTotal: 10 * GiB,
  memoryAvailable: available * GiB,
  pressure:
    full === null || some === null
      ? null
      : { someAvg10: some, fullAvg10: full },
  counters: null,
  source: "whole-machine",
})

/** Each machine planned in turn from the first state; the rung after each. */
function rungs(machines: readonly Machine[]): Rung[] {
  let state = FIRST_RUNG_STATE
  return machines.map(m => {
    const planned = planRung(state, m)
    state = planned.state
    return planned.rung
  })
}
const times = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x)

describe("planRung", () => {
  test("a rung is entered only after ENTER_AFTER samples over its bound", () => {
    const got = rungs(times(ENTER_AFTER, machine(0, 8, 6)))
    expect(got).toEqual([...times(ENTER_AFTER - 1, 0), 1])
  })

  test("a rung is left only after LEAVE_AFTER samples clear of its bound", () => {
    const got = rungs([
      ...times(ENTER_AFTER, machine(0, 8, 6)),
      ...times(LEAVE_AFTER, machine(0)),
    ])
    expect(got.at(-2)).toBe(1)
    expect(got.at(-1)).toBe(0)
  })

  test("the rung moves one step a sample", () => {
    const got = rungs(times(ENTER_AFTER + 3, machine(15)))
    expect(got).toEqual([0, 0, 1, 2, 3, 3])
    const down = rungs([
      ...times(ENTER_AFTER + 3, machine(15)),
      ...times(LEAVE_AFTER + 2, machine(0)),
    ])
    expect(down.slice(-4)).toEqual([3, 2, 1, 0])
  })

  test("a rung with both kinds of bound is entered by either", () => {
    expect(rungs(times(ENTER_AFTER + 1, machine(0, 0.9))).at(-1)).toBe(2)
    expect(rungs(times(ENTER_AFTER + 1, machine(6, 8, 0))).at(-1)).toBe(2)
  })

  test("a rung with both kinds of bound is cleared only when both are clear", () => {
    const entered = times(ENTER_AFTER + 1, machine(6, 8, 0))
    const pressureClearMemoryShort = rungs([
      ...entered,
      ...times(LEAVE_AFTER + 2, machine(0, 1.2, 0)),
    ])
    expect(pressureClearMemoryShort.at(-1)).toBe(2)
    const bothClear = rungs([
      ...entered,
      ...times(LEAVE_AFTER + 2, machine(0, 8, 0)),
    ])
    expect(bothClear.at(-1)).toBe(0)
  })

  test("without PSI, rungs 2 and 3 are entered by available memory alone, and rung 1 is unmeasured", () => {
    const short = times(ENTER_AFTER + 2, machine(null, 0.4))
    expect(rungs(short).at(-1)).toBe(3)
    let state = FIRST_RUNG_STATE
    for (const m of short) state = planRung(state, m).state
    expect(state.levels.has(1)).toBe(false)
  })

  test("a reading crossing one bound back and forth never moves the rung once entered", () => {
    const { enter, clear } = RUNG_BOUNDS[3]
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 60 }),
        flips => {
          const across = (high: boolean) =>
            machine(high ? enter.fullAvg10 + 1 : clear.fullAvg10 + 1, 8, 0)
          const got = rungs([
            ...times(ENTER_AFTER + 2, across(true)),
            ...flips.map(across),
          ])
          expect(got.slice(ENTER_AFTER + 2)).toEqual(times(flips.length, 3))
        },
      ),
    )
  })
})
