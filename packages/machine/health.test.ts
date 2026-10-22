import { threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  ENTER_AFTER,
  FIRST_MEMORY,
  type HealthMemory,
  LEAVE_AFTER,
  type Planned,
  planHealth,
} from "./health.ts"
import type { MachineSample } from "./sample.ts"
import { LEAVE_FREE_DEFAULT } from "./store-settings.ts"

const GiB = 1024 ** 3
const settings = { leaveFree: LEAVE_FREE_DEFAULT }
const lane = threadIdFor("t-1")

/** A calm machine: room to spare, no pressure, one lane. */
const calm: MachineSample = {
  machine: {
    memoryTotal: 12 * GiB,
    memoryAvailable: 8 * GiB,
    pressure: { someAvg10: 0, fullAvg10: 0 },
  },
  lanes: [
    {
      lane,
      current: GiB,
      anon: GiB / 4,
      file: GiB / 2,
      limit: 4 * GiB,
      oomKills: 0,
      pressure: { someAvg10: 0, fullAvg10: 0 },
    },
  ],
  store: {
    size: 200 * GiB,
    unallocated: 100 * GiB,
    data: { total: 90 * GiB, used: 40 * GiB },
    metadata: { total: 4 * GiB, used: GiB },
  },
  filesystem: { size: 1000 * GiB, free: 500 * GiB },
  hostStalledMs: 0,
}

const withUnallocated = (bytes: number): MachineSample => ({
  ...calm,
  store: calm.store === null ? null : { ...calm.store, unallocated: bytes },
})
const withFullAvg10 = (fullAvg10: number): MachineSample => ({
  ...calm,
  machine: { ...calm.machine, pressure: { someAvg10: fullAvg10, fullAvg10 } },
})
const withOomKills = (oomKills: number): MachineSample => ({
  ...calm,
  lanes: calm.lanes.map(l => ({ ...l, oomKills })),
})

/** Each sample planned in turn from the first memory; every plan, in order. */
function run(
  samples: readonly MachineSample[],
  from: HealthMemory = FIRST_MEMORY,
): readonly Planned[] {
  let memory = from
  return samples.map(sample => {
    const planned = planHealth(memory, { kind: "sampled", sample }, settings)
    memory = planned.memory
    return planned
  })
}
const kinds = (p: Planned | undefined) => p?.health.causes.map(c => c.kind)
const times = <T>(n: number, x: T): readonly T[] =>
  Array.from({ length: n }, () => x)

describe("levels", () => {
  test("a level enters only after ENTER_AFTER samples over its threshold", () => {
    const plans = run(times(ENTER_AFTER, withFullAvg10(20)))
    expect(plans.slice(0, -1).map(kinds)).toEqual(times(ENTER_AFTER - 1, []))
    expect(kinds(plans.at(-1))).toEqual(["memory-stalls"])
    expect(plans.at(-1)?.health.state).toBe("amber")
  })

  test("a level leaves only after LEAVE_AFTER samples under its lower threshold", () => {
    const plans = run([
      ...times(ENTER_AFTER, withFullAvg10(20)),
      ...times(LEAVE_AFTER, withFullAvg10(1)),
    ])
    expect(kinds(plans.at(-2))).toEqual(["memory-stalls"])
    expect(kinds(plans.at(-1))).toEqual([])
    expect(plans.at(-1)?.health.state).toBe("neutral")
  })

  test("a value crossing one threshold back and forth does not flap", () => {
    const entered = run(times(ENTER_AFTER, withFullAvg10(20)))
    const memory = entered.at(-1)?.memory ?? FIRST_MEMORY
    const flapping = run(
      times(4 * LEAVE_AFTER, 0).map((_, i) =>
        withFullAvg10(i % 2 === 0 ? 9 : 11),
      ),
      memory,
    )
    expect(flapping.every(p => !p.changed)).toBe(true)
    expect(kinds(flapping.at(-1))).toEqual(["memory-stalls"])

    const outside = run(
      times(4 * ENTER_AFTER, 0).map((_, i) =>
        withFullAvg10(i % 2 === 0 ? 9 : 11),
      ),
      run([calm])[0]?.memory,
    )
    expect(outside.every(p => !p.changed)).toBe(true)
  })

  test("a level not measured keeps its count", () => {
    const noStore: MachineSample = { ...calm, store: null }
    const plans = run([
      withUnallocated(GiB / 2),
      noStore,
      withUnallocated(GiB / 2),
      noStore,
      withUnallocated(GiB / 2),
    ])
    expect(kinds(plans.at(-1))).toEqual(["room-spent"])
  })
})

describe("the store's room", () => {
  test("a store with less unallocated than its minimum is low, amber", () => {
    const low = run(times(ENTER_AFTER, withUnallocated(10 * GiB))).at(-1)
    expect(low?.health).toEqual({
      state: "amber",
      causes: [{ kind: "room-low", unallocated: 10 * GiB, minimum: 20 * GiB }],
    })
  })

  test("a spent store is red, and not also said to be low", () => {
    const spent = run(times(ENTER_AFTER, withUnallocated(GiB / 2))).at(-1)
    expect(spent?.health.state).toBe("red")
    expect(kinds(spent)).toEqual(["room-spent"])
  })

  test("metadata nearly full is red only with no room to grow it", () => {
    const fullMetadata = (unallocated: number): MachineSample => ({
      ...calm,
      store: {
        size: 200 * GiB,
        unallocated,
        data: { total: 190 * GiB, used: 100 * GiB },
        metadata: { total: 4 * GiB, used: 3.9 * GiB },
      },
    })
    expect(
      kinds(run(times(ENTER_AFTER, fullMetadata(GiB / 2))).at(-1)),
    ).toContain("metadata-full")
    expect(
      kinds(run(times(ENTER_AFTER, fullMetadata(50 * GiB))).at(-1)),
    ).not.toContain("metadata-full")
  })

  test("a filesystem with less free than the store leaves is low", () => {
    const sample = { ...calm, filesystem: { size: 1000 * GiB, free: 80 * GiB } }
    expect(run(times(ENTER_AFTER, sample)).at(-1)?.health.causes).toEqual([
      { kind: "filesystem-low", free: 80 * GiB, leaveFree: 100 * GiB },
    ])
  })
})

describe("events", () => {
  test("a rise in a lane's OOM kills is a cause on its one sample", () => {
    const plans = run([withOomKills(2), withOomKills(3)])
    expect(plans.at(-1)?.health.causes).toEqual([
      { kind: "lane-oom-killed", lane },
    ])
  })

  test("a lane's steady OOM count is no cause, nor is the count it is first seen with", () => {
    const plans = run(times(ENTER_AFTER + 1, withOomKills(2)))
    expect(plans.every(p => kinds(p)?.length === 0)).toBe(true)
  })

  test("an event leaves after LEAVE_AFTER samples without it", () => {
    const plans = run([
      withOomKills(0),
      withOomKills(1),
      ...times(LEAVE_AFTER, withOomKills(1)),
    ])
    expect(kinds(plans.at(-2))).toEqual(["lane-oom-killed"])
    expect(kinds(plans.at(-1))).toEqual([])
  })

  test("a host stall over a second is a cause on its one sample", () => {
    const plans = run([{ ...calm, hostStalledMs: 1500 }])
    expect(plans[0]?.health.causes).toEqual([
      { kind: "host-stalls", stalledMs: 1500 },
    ])
    expect(kinds(run([{ ...calm, hostStalledMs: 900 }])[0])).toEqual([])
  })
})

describe("the value", () => {
  test("the state is the worst cause's, and the causes are worst first", () => {
    const both: MachineSample = {
      ...withUnallocated(GiB / 2),
      machine: withFullAvg10(20).machine,
    }
    const health = run(times(ENTER_AFTER, both)).at(-1)?.health
    expect(health?.state).toBe("red")
    expect(health?.causes.map(c => c.kind)).toEqual([
      "room-spent",
      "memory-stalls",
    ])
  })

  test("a plan is changed only when its state or causes differ, not their measures", () => {
    const plans = run([
      calm,
      calm,
      ...times(ENTER_AFTER, withUnallocated(10 * GiB)),
      withUnallocated(9 * GiB),
    ])
    expect(plans.map(p => p.changed)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
    ])
  })

  test("a failed sample adds unsampled to the causes it leaves standing", () => {
    const entered = run(times(ENTER_AFTER, withFullAvg10(20))).at(-1)
    const failed = planHealth(
      entered?.memory ?? FIRST_MEMORY,
      { kind: "failed", error: "lanehost did not answer" },
      settings,
    )
    expect(failed.changed).toBe(true)
    expect(failed.health.causes).toEqual([
      { kind: "unsampled", reason: "failed", error: "lanehost did not answer" },
      { kind: "memory-stalls", fullAvg10: 20 },
    ])
    const back = planHealth(
      failed.memory,
      { kind: "sampled", sample: withFullAvg10(20) },
      settings,
    )
    expect(back.changed).toBe(true)
    expect(kinds(back)).toEqual(["memory-stalls"])
  })
})
