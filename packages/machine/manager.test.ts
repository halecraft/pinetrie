import {
  type MachineHealth,
  type SnapshotId,
  threadIdFor,
} from "@pinetrie/core"
import { entrySnapshotId } from "@pinetrie/core/fixtures"
import { KeeperClosed } from "@pinetrie/keeper"
import { describe, expect, test } from "vitest"
import {
  EMPTY_LISTING,
  fakeLaneFacts,
  fakeRecords,
  fakeStore,
  keptMeasurements,
  memoryIndex,
} from "./fixtures.ts"
import { ENTER_AFTER, LEAVE_AFTER } from "./hysteresis.ts"
import {
  createMachineManager,
  type ManageMode,
  type ManagerNews,
  TRIM_MEASUREMENTS_EVERY_SAMPLES,
} from "./manager.ts"
import type { MachineManager, MachineSensor } from "./ports.ts"
import type { SensedSample } from "./sample.ts"
import type { SnapshotIndex, SnapshotRow } from "./snapshot-index.ts"
import type { StoreListed, StoreRecords } from "./store.ts"
import { LEAVE_FREE_DEFAULT, type StoreSettings } from "./store-settings.ts"

const SETTINGS: StoreSettings = {
  max: null,
  leaveFree: LEAVE_FREE_DEFAULT,
  snapshotMetadata: 1024 ** 3,
}

const GiB = 1024 ** 3

const calm: SensedSample = {
  machine: {
    memoryTotal: 12 * GiB,
    memoryAvailable: 8 * GiB,
    pressure: { someAvg10: 0, fullAvg10: 0 },
    counters: null,
    source: "whole-machine",
  },
  lanes: [],
  lanesRunning: [],
  store: null,
  filesystem: null,
  serviceKills: [],
  hostStalledMs: 0,
}

/** A manager over `sensor`, with what its sink was written and what it told. */
function managed(sensor: MachineSensor, mode: ManageMode = "manage") {
  const written: MachineHealth[] = []
  const told: ManagerNews[] = []
  const manager = createMachineManager({
    sensor,
    sink: {
      write: async health => {
        written.push(health)
      },
    },
    settings: SETTINGS,
    mode,
    capabilities: { grow: false },
    index: memoryIndex(),
    store: fakeStore(EMPTY_LISTING).store,
    records: fakeRecords(),
    laneFacts: fakeLaneFacts(),
    measurements: keptMeasurements(),
    tell: news => told.push(news),
  })
  return { manager, written, told }
}

const steady: MachineSensor = { sample: async () => calm }
const reasons = (written: readonly MachineHealth[]) =>
  written.map(h =>
    h.causes[0]?.kind === "unsampled" ? h.causes[0].reason : h.state,
  )

test("unsampled is written at start and again at close", async () => {
  const { manager, written } = managed(steady)
  await manager.start()
  await manager.close()
  expect(reasons(written)).toEqual(["waiting", "neutral", "stopped"])
})

test("the sink is written once per change, and not for an unchanged sample", async () => {
  const { manager, written, told } = managed(steady)
  await manager.start()
  await manager.sample()
  await manager.sample()
  await manager.sample()
  expect(reasons(written)).toEqual(["waiting", "neutral"])
  expect(told).toEqual([
    {
      kind: "changed",
      health: { state: "neutral", causes: [], treatments: [] },
    },
  ])
})

test("a sensor that throws gives unsampled, with its error", async () => {
  const { manager, written } = managed({
    sample: async () => {
      throw new Error("lanehost did not answer")
    },
  })
  await manager.start()
  await manager.sample()
  expect(written.at(-1)).toEqual({
    state: "amber",
    causes: [
      { kind: "unsampled", reason: "failed", error: "lanehost did not answer" },
    ],
    treatments: [],
  })
})

test("two asks while a sample runs give one more sample, not two", async () => {
  let samples = 0
  const held = Promise.withResolvers<void>()
  const { manager } = managed({
    sample: async () => {
      samples++
      if (samples === 1) await held.promise
      return calm
    },
  })
  const first = manager.sample()
  await new Promise(resolve => setTimeout(resolve, 0))
  const second = manager.sample()
  const third = manager.sample()
  held.resolve()
  await Promise.all([first, second, third])
  expect(samples).toBe(2)
})

test("a refused write is written again at the next sample", async () => {
  let refuse = true
  const written: MachineHealth[] = []
  const told: ManagerNews[] = []
  const manager = createMachineManager({
    sensor: steady,
    sink: {
      write: async health => {
        if (refuse && health.state === "neutral") throw new Error("closed")
        written.push(health)
      },
    },
    settings: SETTINGS,
    mode: "manage",
    capabilities: { grow: false },
    index: memoryIndex(),
    store: fakeStore(EMPTY_LISTING).store,
    records: fakeRecords(),
    laneFacts: fakeLaneFacts(),
    measurements: keptMeasurements(),
    tell: news => told.push(news),
  })
  await manager.start()
  await manager.sample()
  refuse = false
  await manager.sample()
  expect(reasons(written)).toEqual(["waiting", "neutral"])
  expect(told.map(n => n.kind)).toContain("unwritten")
})

test("a skipped snapshot is counted in the next sample, and only in it", async () => {
  const { manager, written } = managed(steady)
  await manager.start()
  manager.noteSnapshotSkipped()
  manager.noteSnapshotSkipped()
  await manager.sample()
  expect(written.at(-1)?.causes).toEqual([
    { kind: "snapshot-skipped", count: 2 },
  ])
  // Counted again, it would be seen each sample, and never leave.
  for (let i = 0; i < LEAVE_AFTER; i++) await manager.sample()
  expect(written.at(-1)?.causes).toEqual([])
})

describe("the disk upkeep", () => {
  const LANE = threadIdFor("00000001-0000-7000-8000-000000000000")
  const [A, B] = [entrySnapshotId(1), entrySnapshotId(2)] as const
  const kept = (
    snapshot: SnapshotId,
    more: Partial<SnapshotRow> = {},
  ): SnapshotRow => ({
    snapshot,
    lane: LANE,
    changed: 0,
    used: 1,
    branched: false,
    state: "kept",
    ...more,
  })
  const upkept = (input: {
    readonly index: SnapshotIndex
    readonly listing?: StoreListed
    readonly mode?: ManageMode
    readonly records?: StoreRecords
  }) => {
    const { store, did } = fakeStore(
      input.listing ?? { snapshots: [A, B], lanes: [], nested: [] },
    )
    const manager = createMachineManager({
      sensor: steady,
      sink: { write: async () => {} },
      settings: SETTINGS,
      mode: input.mode ?? "manage",
      capabilities: { grow: false },
      index: input.index,
      store,
      records: input.records ?? fakeRecords(),
      laneFacts: fakeLaneFacts(),
      measurements: keptMeasurements(),
      tell: () => {},
    })
    return { manager, did }
  }
  const settle = async (m: MachineManager) => {
    await m.idle()
    await m.close()
  }

  test("a first upkeep settles a dead host's reservations from the listing before it plans", async () => {
    const index = memoryIndex([
      kept(A, { state: "reserved" }),
      kept(B, { state: "reserved" }),
    ])
    index.markComplete()
    const { manager } = upkept({
      index,
      listing: { snapshots: [A], lanes: [], nested: [] },
    })
    manager.requestUpkeep()
    await settle(manager)
    expect(index.rows().map(r => r.state)).toEqual(["kept", "deleted"])
  })

  test("an archive's snapshots are marked to delete, then deleted by the upkeep it asks for", async () => {
    const index = memoryIndex([kept(A), kept(B, { used: 2 })])
    index.markComplete()
    const { manager, did } = upkept({ index })
    await manager.markArchivedForDeletion([A])
    await settle(manager)
    expect(did).toEqual([`snapshot ${A}`])
    expect(index.rows().find(r => r.snapshot === A)?.state).toBe("deleted")
  })

  test("observing, nothing is deleted: rows are marked, and no upkeep runs", async () => {
    const index = memoryIndex([kept(A), kept(B, { used: 2 })])
    index.markComplete()
    const { manager, did } = upkept({ index, mode: "observe" })
    await manager.markArchivedForDeletion([A])
    manager.requestUpkeep()
    await settle(manager)
    expect(did).toEqual([])
  })

  test("a restore before the upkeep plans keeps its lanes' rows, and nothing is deleted", async () => {
    const index = memoryIndex([
      kept(A, { state: "to-delete" }),
      kept(B, { used: 2 }),
    ])
    index.markComplete()
    const { manager, did } = upkept({ index })
    await manager.keepRestored([LANE])
    await settle(manager)
    expect(did).toEqual([])
    expect(index.rows().find(r => r.snapshot === A)?.state).toBe("kept")
  })

  test("a restore asked while an upkeep step runs lands after it, never between its plan and its deletion", async () => {
    const index = memoryIndex([
      kept(A, { state: "to-delete" }),
      kept(B, { used: 2 }),
    ])
    index.markComplete()
    const gate = Promise.withResolvers<void>()
    const { store, did } = fakeStore({
      snapshots: [A, B],
      lanes: [],
      nested: [],
    })
    const manager = createMachineManager({
      sensor: steady,
      sink: { write: async () => {} },
      settings: SETTINGS,
      mode: "manage",
      capabilities: { grow: false },
      index,
      store: {
        ...store,
        listing: async () => {
          await gate.promise
          return store.listing()
        },
      },
      records: fakeRecords(),
      laneFacts: fakeLaneFacts(),
      measurements: keptMeasurements(),
      tell: () => {},
    })
    manager.requestUpkeep()
    await new Promise(resolve => setTimeout(resolve, 0))
    const restored = manager.keepRestored([LANE])
    gate.resolve()
    await restored
    await settle(manager)
    // The step planned A's deletion before the restore, and carried it out.
    expect(did).toEqual([`snapshot ${A}`])
    expect(index.rows().find(r => r.snapshot === A)?.state).toBe("deleted")
  })

  test("the health gaining room-low asks for an upkeep, which frees the least recently used", async () => {
    const index = memoryIndex([kept(A), kept(B, { used: 2 })])
    index.markComplete()
    const { store, did } = fakeStore({
      snapshots: [A, B],
      lanes: [],
      nested: [],
    })
    const low: MachineSensor = {
      sample: async () => ({
        ...calm,
        store: {
          size: 200 * GiB,
          unallocated: GiB,
          data: { total: 90 * GiB, used: 40 * GiB },
          metadata: { total: 4 * GiB, used: GiB },
        },
      }),
    }
    const manager = createMachineManager({
      sensor: low,
      sink: { write: async () => {} },
      settings: SETTINGS,
      mode: "manage",
      capabilities: { grow: false },
      index,
      store,
      records: fakeRecords(),
      laneFacts: fakeLaneFacts(),
      measurements: keptMeasurements(),
      tell: () => {},
    })
    await manager.start()
    for (let i = 0; i < ENTER_AFTER; i++) await manager.sample()
    await settle(manager)
    // B is the lane's newest, and stays.
    expect(did).toEqual([`snapshot ${A}`])
  })

  test("an incomplete index is filled from every root's records first, and an unindexed name goes only after", async () => {
    const index = memoryIndex()
    const { manager, did } = upkept({
      index,
      records: fakeRecords({
        roots: new Map([["r-1", [{ snapshot: A, lane: LANE, changed: 3 }]]]),
        live: [LANE],
      }),
    })
    manager.requestUpkeep()
    await settle(manager)
    expect(index.isComplete()).toBe(true)
    expect(index.rows()).toMatchObject([
      { snapshot: A, state: "kept", changed: 3 },
    ])
    expect(did).toEqual([`snapshot ${B}`])
  })
})

describe("memory", () => {
  const LANE = threadIdFor("t-1")
  /** A sensor whose `full avg10` is what `pressure.full` says at each sample, `LANE` running when `running` says so. */
  const pressured = () => {
    const now = { full: 0, running: false }
    const sensor: MachineSensor = {
      sample: async () => ({
        ...calm,
        machine: {
          ...calm.machine,
          pressure: { someAvg10: now.full, fullAvg10: now.full },
        },
        lanesRunning: now.running ? [LANE] : [],
      }),
    }
    return { now, sensor }
  }
  /** Samples until the rung has climbed to 2 and held starts. */
  const toRung2 = async (manager: MachineManager) => {
    for (let i = 0; i < ENTER_AFTER + 2; i++) await manager.sample()
  }

  test("waitUntilAllowed settles at once when allowed, and once a later plan allows", async () => {
    const { now, sensor } = pressured()
    const { manager } = managed(sensor)
    await manager.start()
    await manager.waitUntilAllowed(LANE, "container-start")
    now.full = 6
    await toRung2(manager)
    let started = false
    const start = manager.waitUntilAllowed(LANE, "container-start").then(() => {
      started = true
    })
    await manager.sample()
    expect(started).toBe(false)
    now.full = 0
    for (let i = 0; i < LEAVE_AFTER + 2 && !started; i++) await manager.sample()
    await start
    expect(started).toBe(true)
  })

  test("a start waiting is among the lanes waiting to start, and leaves them on its abort", async () => {
    const { now, sensor } = pressured()
    const { manager, written } = managed(sensor)
    await manager.start()
    now.full = 6
    await toRung2(manager)
    const abort = new AbortController()
    const start = manager.waitUntilAllowed(
      LANE,
      "container-start",
      abort.signal,
    )
    await manager.sample()
    expect(written.at(-1)?.treatments).toEqual([
      { lane: LANE, treatment: { kind: "waiting-to-start" } },
    ])
    abort.abort(new Error("stopped"))
    await expect(start).rejects.toThrow("stopped")
    await manager.sample()
    expect(written.at(-1)?.treatments).toEqual([])
  })

  test("a running lane whose cgroup was not read may still call from rung 2", async () => {
    const { now, sensor } = pressured()
    const { manager } = managed(sensor)
    await manager.start()
    now.full = 6
    now.running = true
    await toRung2(manager)
    await manager.waitUntilAllowed(LANE, "tool-call")
    await expect(
      Promise.race([
        manager
          .waitUntilAllowed(threadIdFor("t-2"), "tool-call")
          .then(() => "allowed"),
        Promise.resolve("held"),
      ]),
    ).resolves.toBe("held")
  })

  test("observing holds nothing, and says memory is short", async () => {
    const { now, sensor } = pressured()
    const { manager, written } = managed(sensor, "observe")
    await manager.start()
    now.full = 6
    await toRung2(manager)
    await manager.waitUntilAllowed(LANE, "container-start")
    expect(written.at(-1)?.causes).toEqual([
      { kind: "memory-short", rung: 2, isHolding: false },
    ])
    expect(written.at(-1)?.treatments).toEqual([])
  })

  test("close refuses every waiter", async () => {
    const { now, sensor } = pressured()
    const { manager } = managed(sensor)
    await manager.start()
    now.full = 6
    await toRung2(manager)
    const start = manager.waitUntilAllowed(LANE, "container-start")
    await manager.close()
    await expect(start).rejects.toBeInstanceOf(KeeperClosed)
  })
})

describe("measurements", () => {
  test.each(["manage", "observe"] as const)(
    "every sample is measured, and they are trimmed every TRIM_MEASUREMENTS_EVERY_SAMPLES samples, %s",
    async mode => {
      const measurements = keptMeasurements()
      const manager = createMachineManager({
        sensor: steady,
        sink: { write: async () => {} },
        settings: SETTINGS,
        mode,
        capabilities: { grow: false },
        index: memoryIndex(),
        store: fakeStore(EMPTY_LISTING).store,
        records: fakeRecords(),
        laneFacts: fakeLaneFacts(),
        measurements,
        tell: () => {},
      })
      await manager.start()
      for (let i = 0; i < TRIM_MEASUREMENTS_EVERY_SAMPLES; i++)
        await manager.sample()
      expect(measurements.samples).toHaveLength(
        TRIM_MEASUREMENTS_EVERY_SAMPLES + 1,
      )
      expect(measurements.samples.every(s => s.mode === mode)).toBe(true)
      expect(measurements.trims.count).toBe(1)
    },
  )
})
