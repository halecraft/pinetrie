import fc from "fast-check"
import { describe, expect, test } from "vitest"
import { ENTER_AFTER, LEAVE_AFTER } from "./hysteresis.ts"
import { pressureScope } from "./pressure-scope.ts"
import {
  CGROUP_AT_ITS_LIMIT,
  MACHINE_SHORT,
  RECORDED_MEMORY_TOTAL,
  type RecordedSample,
} from "./recorded-loads.ts"
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
  reclaim: null,
  limitHits: null,
  source: "whole-machine",
})

/**
 * Each machine planned in turn from the first state, its pressure's scope
 * read against the reclaim of the one before; the rung after each.
 */
function rungs(machines: readonly Machine[]): Rung[] {
  let state = FIRST_RUNG_STATE
  let reclaimBefore: Machine["reclaim"] = null
  return machines.map(m => {
    const planned = planRung(
      state,
      m,
      pressureScope({ machine: m, reclaimBefore }),
    )
    state = planned.state
    reclaimBefore = m.reclaim
    return planned.rung
  })
}

/** A recorded load's samples as the machine reads them, its reclaim counted from 0 at its first. */
function recorded(samples: readonly RecordedSample[]): Machine[] {
  const reclaim = { allocStalls: 0, scannedDirect: 0, scannedByKswapd: 0 }
  return samples.map(([, full, some, share, stalls, direct, kswapd]) => {
    reclaim.allocStalls += stalls
    reclaim.scannedDirect += direct
    reclaim.scannedByKswapd += kswapd
    return {
      memoryTotal: RECORDED_MEMORY_TOTAL,
      memoryAvailable: Math.round(share * RECORDED_MEMORY_TOTAL),
      pressure: { someAvg10: some, fullAvg10: full },
      counters: null,
      reclaim: { ...reclaim },
      limitHits: null,
      source: "whole-machine",
    }
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
    for (const m of short)
      state = planRung(state, m, { kind: "unmeasured" }).state
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

  test("a stall in a cgroup at its own limit holds nothing", () => {
    const got = rungs(recorded(CGROUP_AT_ITS_LIMIT))
    expect(got.every(r => r === 0)).toBe(true)
  })

  test("the machine's own shortage holds starts", () => {
    const got = rungs(recorded(MACHINE_SHORT))
    expect(Math.max(...got)).toBe(2)
  })

  test("a contained stall reads its pressure bounds as unmeasured, and its available share as read", () => {
    const contained = {
      kind: "contained",
      pressure: { someAvg10: 30, fullAvg10: 30 },
    } as const
    let state = FIRST_RUNG_STATE
    for (const _ of times(ENTER_AFTER + 1, null))
      state = planRung(state, machine(30, 0.4), contained).state
    expect(state.rung).toBe(2)
    let calm = FIRST_RUNG_STATE
    for (const _ of times(ENTER_AFTER + 1, null))
      calm = planRung(calm, machine(30), contained).state
    expect(calm.rung).toBe(0)
  })
})
