import { threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  FIRST_HEALTH_STATE,
  type HealthPlanState,
  type MemoryShort,
  NOTHING_BESIDE,
  type Planned,
  planHealth,
} from "./health.ts"
import { ENTER_AFTER, LEAVE_AFTER } from "./hysteresis.ts"
import type { MachineSample } from "./sample.ts"
import { LEAVE_FREE_DEFAULT } from "./store-settings.ts"

const GiB = 1024 ** 3
const settings = { leaveFree: LEAVE_FREE_DEFAULT, max: null }
const NO_GROW = { grow: false, repairDisk: false }
const lane = threadIdFor("t-1")

/** A calm machine: room to spare, no pressure, one lane. */
const calm: MachineSample = {
  machine: {
    memoryTotal: 12 * GiB,
    memoryAvailable: 8 * GiB,
    pressure: { someAvg10: 0, fullAvg10: 0 },
    counters: null,
    reclaim: null,
    limitHits: null,
    source: "whole-machine",
  },
  lanes: [
    {
      lane,
      current: GiB,
      anon: GiB / 4,
      file: GiB / 2,
      limit: 4 * GiB,
      oomKills: 0,
      limitHits: { max: 0, high: 0 },
      pressure: { someAvg10: 0, fullAvg10: 0 },
    },
  ],
  lanesRunning: [lane],
  store: {
    size: 200 * GiB,
    unallocated: 100 * GiB,
    data: { total: 90 * GiB, used: 40 * GiB },
    metadata: { total: 4 * GiB, used: GiB },
  },
  filesystem: { size: 1000 * GiB, free: 500 * GiB },
  services: [],
  serviceKills: [],
  hostStalledMs: 0,
  snapshotsSkipped: 0,
  upkeep: { freeing: false, exhausted: false },
}

const withUnallocated = (bytes: number): MachineSample => ({
  ...calm,
  store: calm.store === null ? null : { ...calm.store, unallocated: bytes },
})
/** The store's filesystem with `free` of its 1000 GiB, which leaves 100 GiB free: low under it, clear again over 110. */
const withFree = (free: number): MachineSample => ({
  ...calm,
  filesystem: { size: 1000 * GiB, free },
})
const FILESYSTEM_LOW = withFree(80 * GiB)
const withOomKills = (oomKills: number): MachineSample => ({
  ...calm,
  lanes: calm.lanes.map(l => ({ ...l, oomKills })),
})

/** Each sample planned in turn from the first memory; every plan, in order. */
function run(
  samples: readonly MachineSample[],
  from: HealthPlanState = FIRST_HEALTH_STATE,
): readonly Planned[] {
  let state = from
  return samples.map(sample => {
    const planned = planHealth(
      state,
      { kind: "sampled", sample },
      settings,
      NO_GROW,
      NOTHING_BESIDE,
    )
    state = planned.state
    return planned
  })
}
const kinds = (p: Planned | undefined) => p?.health.causes.map(c => c.kind)
const times = <T>(n: number, x: T): readonly T[] =>
  Array.from({ length: n }, () => x)

describe("levels", () => {
  test("a level enters only after ENTER_AFTER samples over its threshold", () => {
    const plans = run(times(ENTER_AFTER, FILESYSTEM_LOW))
    expect(plans.slice(0, -1).map(kinds)).toEqual(times(ENTER_AFTER - 1, []))
    expect(kinds(plans.at(-1))).toEqual(["filesystem-low"])
    expect(plans.at(-1)?.health.state).toBe("amber")
  })

  test("a level leaves only after LEAVE_AFTER samples under its lower threshold", () => {
    const plans = run([
      ...times(ENTER_AFTER, FILESYSTEM_LOW),
      ...times(LEAVE_AFTER, withFree(200 * GiB)),
    ])
    expect(kinds(plans.at(-2))).toEqual(["filesystem-low"])
    expect(kinds(plans.at(-1))).toEqual([])
    expect(plans.at(-1)?.health.state).toBe("neutral")
  })

  test("a value crossing one threshold back and forth does not flap", () => {
    const entered = run(times(ENTER_AFTER, FILESYSTEM_LOW))
    const memory = entered.at(-1)?.state ?? FIRST_HEALTH_STATE
    const flapping = run(
      times(4 * LEAVE_AFTER, 0).map((_, i) =>
        withFree((i % 2 === 0 ? 105 : 95) * GiB),
      ),
      memory,
    )
    expect(flapping.every(p => !p.changed)).toBe(true)
    expect(kinds(flapping.at(-1))).toEqual(["filesystem-low"])

    const outside = run(
      times(4 * ENTER_AFTER, 0).map((_, i) =>
        withFree((i % 2 === 0 ? 105 : 95) * GiB),
      ),
      run([calm])[0]?.state,
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
      causes: [
        {
          kind: "room-low",
          unallocated: 10 * GiB,
          minimum: 20 * GiB,
          grows: false,
        },
      ],
      treatments: [],
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

  test("a service's kill heard is a cause naming it, until LEAVE_AFTER samples without one", () => {
    const plans = run([
      { ...calm, serviceKills: ["observer"] },
      ...times(LEAVE_AFTER, calm),
    ])
    expect(plans[0]?.health).toEqual({
      state: "amber",
      causes: [{ kind: "service-oom-killed", service: "observer" }],
      treatments: [],
    })
    expect(kinds(plans.at(-2))).toEqual(["service-oom-killed"])
    expect(kinds(plans.at(-1))).toEqual([])
  })

  test("two services killed are two causes", () => {
    const plans = run([
      { ...calm, serviceKills: ["disks", "observer", "disks"] },
    ])
    expect(plans[0]?.health.causes).toEqual([
      { kind: "service-oom-killed", service: "disks" },
      { kind: "service-oom-killed", service: "observer" },
    ])
  })

  test("a host stall over a second is a cause on its one sample", () => {
    const plans = run([{ ...calm, hostStalledMs: 1500 }])
    expect(plans[0]?.health.causes).toEqual([
      { kind: "host-stalls", stalledMs: 1500 },
    ])
    expect(kinds(run([{ ...calm, hostStalledMs: 900 }])[0])).toEqual([])
  })

  test("the upkeep freeing room is amber, and nothing left to delete with the room under its floor is red", () => {
    const low = withUnallocated(10 * GiB)
    const freeing = run(
      times(ENTER_AFTER, {
        ...low,
        upkeep: { freeing: true, exhausted: false },
      }),
    ).at(-1)
    expect(kinds(freeing)).toEqual(["room-low", "freeing-room"])
    const stuck = run(
      times(ENTER_AFTER, {
        ...low,
        upkeep: { freeing: false, exhausted: true },
      }),
    ).at(-1)
    expect(stuck?.health).toEqual({
      state: "red",
      causes: [
        {
          kind: "room-unrecoverable",
          unallocated: 10 * GiB,
          minimum: 20 * GiB,
          isRepaired: false,
        },
        {
          kind: "room-low",
          unallocated: 10 * GiB,
          minimum: 20 * GiB,
          grows: false,
        },
      ],
      treatments: [],
    })
  })

  test("a skipped snapshot is a cause counting them, until LEAVE_AFTER samples without one", () => {
    const plans = run([
      { ...calm, snapshotsSkipped: 2 },
      ...times(LEAVE_AFTER, calm),
    ])
    expect(plans[0]?.health).toEqual({
      state: "amber",
      causes: [{ kind: "snapshot-skipped", count: 2 }],
      treatments: [],
    })
    expect(kinds(plans.at(-2))).toEqual(["snapshot-skipped"])
    expect(kinds(plans.at(-1))).toEqual([])
  })
})

describe("the value", () => {
  test("the state is the worst cause's, and the causes are worst first", () => {
    const both: MachineSample = {
      ...withUnallocated(GiB / 2),
      filesystem: FILESYSTEM_LOW.filesystem,
    }
    const health = run(times(ENTER_AFTER, both)).at(-1)?.health
    expect(health?.state).toBe("red")
    expect(health?.causes.map(c => c.kind)).toEqual([
      "room-spent",
      "filesystem-low",
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
    const entered = run(times(ENTER_AFTER, FILESYSTEM_LOW)).at(-1)
    const failed = planHealth(
      entered?.state ?? FIRST_HEALTH_STATE,
      { kind: "failed", error: "lanehost did not answer" },
      settings,
      NO_GROW,
      NOTHING_BESIDE,
    )
    expect(failed.changed).toBe(true)
    expect(failed.health.causes).toEqual([
      { kind: "unsampled", reason: "failed", error: "lanehost did not answer" },
      { kind: "filesystem-low", free: 80 * GiB, leaveFree: 100 * GiB },
    ])
    const back = planHealth(
      failed.state,
      { kind: "sampled", sample: FILESYSTEM_LOW },
      settings,
      NO_GROW,
      NOTHING_BESIDE,
    )
    expect(back.changed).toBe(true)
    expect(kinds(back)).toEqual(["filesystem-low"])
  })
})

describe("memory", () => {
  const plan = (memory: MemoryShort, from = FIRST_HEALTH_STATE) =>
    planHealth(from, { kind: "sampled", sample: calm }, settings, NO_GROW, {
      memory,
      repair: null,
    })

  test("memory short from rung 2 is amber, with the lanes held listed beside it", () => {
    const held = [{ lane, treatment: { kind: "paused" } } as const]
    expect(plan({ rung: 1, isHolding: true, held: [] }).health.causes).toEqual(
      [],
    )
    expect(plan({ rung: 3, isHolding: true, held }).health).toEqual({
      state: "amber",
      causes: [{ kind: "memory-short", rung: 3, isHolding: true }],
      treatments: held,
    })
  })

  test("a rung changing, or a lane held, is a change; nothing else of memory is", () => {
    const two = plan({ rung: 2, isHolding: true, held: [] })
    const three = plan({ rung: 3, isHolding: true, held: [] }, two.state)
    expect(three.changed).toBe(true)
    const held = plan(
      {
        rung: 3,
        isHolding: true,
        held: [{ lane, treatment: { kind: "paused" } }],
      },
      three.state,
    )
    expect(held.changed).toBe(true)
    const same = plan(
      {
        rung: 3,
        isHolding: true,
        held: [{ lane, treatment: { kind: "paused" } }],
      },
      held.state,
    )
    expect(same.changed).toBe(false)
  })
})
