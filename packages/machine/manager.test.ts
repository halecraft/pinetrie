import {
  type MachineHealth,
  type SnapshotId,
  threadIdFor,
} from "@pinetrie/core"
import { entrySnapshotId } from "@pinetrie/core/fixtures"
import { createKeeper, KeeperClosed } from "@pinetrie/keeper"
import { describe, expect, test } from "vitest"
import {
  EMPTY_LISTING,
  fakeLaneFacts,
  fakeRecords,
  fakeStore,
  keptMeasurements,
  memoryIndex,
  recordingSink,
} from "./fixtures.ts"
import { READING_OVERDUE_AFTER_TICKS } from "./freshness.ts"
import { ENTER_AFTER, LEAVE_AFTER } from "./hysteresis.ts"
import {
  createMachineManager,
  type ManageMode,
  type ManagerNews,
  TRIM_MEASUREMENTS_EVERY_SAMPLES,
} from "./manager.ts"
import type { MachineManager, MachineSensor, RepairControls } from "./ports.ts"
import {
  decodeRepairState,
  encodeRepairState,
  type RepairOutcome,
} from "./repair.ts"
import type { SensedSample } from "./sample.ts"
import {
  type SnapshotIndex,
  type SnapshotRow,
  snapshotCost,
} from "./snapshot-index.ts"
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
    reclaim: null,
    limitHits: null,
    source: "whole-machine",
  },
  lanes: [],
  lanesRunning: [],
  store: null,
  filesystem: null,
  services: [],
  containment: { kind: "contained" },
  serviceKills: [],
  hostStalledMs: 0,
}

/** What a manager over `sensor` is made with, writing nowhere and telling nothing. */
const managedDeps = (
  sensor: MachineSensor,
  mode: ManageMode = "manage",
): Parameters<typeof createMachineManager>[0] => ({
  sensor,
  makeSink: recordingSink(),
  settings: SETTINGS,
  mode,
  capabilities: { grow: false, repairDisk: false },
  index: memoryIndex(),
  store: fakeStore(EMPTY_LISTING).store,
  records: fakeRecords(),
  laneFacts: fakeLaneFacts(),
  measurements: keptMeasurements(),
  readRepair: null,
  repair: null,
  tell: () => {},
})

/** A manager over `sensor`, with what its sink was written and what it told. */
function managed(sensor: MachineSensor, mode: ManageMode = "manage") {
  const written: MachineHealth[] = []
  const told: ManagerNews[] = []
  const manager = createMachineManager({
    ...managedDeps(sensor, mode),
    makeSink: recordingSink(written),
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
  await manager.idle()
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
    ...managedDeps(steady),
    makeSink: recordingSink(
      written,
      health => refuse && health.state === "neutral",
    ),
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
    const measurements = keptMeasurements()
    const manager = createMachineManager({
      ...managedDeps(steady),
      mode: input.mode ?? "manage",
      index: input.index,
      store,
      records: input.records ?? fakeRecords(),
      measurements,
    })
    return { manager, did, measurements }
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

  test("a deletion is recorded once, with its snapshots' estimated cost", async () => {
    const index = memoryIndex([kept(A, { changed: 10 }), kept(B, { used: 2 })])
    index.markComplete()
    const { manager, measurements } = upkept({ index })
    await manager.markArchivedForDeletion([A])
    await settle(manager)
    expect(measurements.events).toEqual([
      {
        kind: "snapshots-deleted",
        count: 1,
        bytes: snapshotCost({ changed: 10 }),
      },
    ])
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
      ...managedDeps(steady),
      index,
      store: {
        ...store,
        listing: async () => {
          await gate.promise
          return store.listing()
        },
      },
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
      ...managedDeps(low),
      index,
      store,
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

  test("the latest reading is none before a sample, then the last sample with what was planned from it", async () => {
    const { now, sensor } = pressured()
    const { manager } = managed(sensor)
    expect(manager.latestReading()).toBeNull()
    await manager.start()
    now.full = 6
    await toRung2(manager)
    const start = manager.waitUntilAllowed(LANE, "container-start")
    await manager.sample()
    const latest = manager.latestReading()
    const reading = latest?.kind === "fresh" ? latest : null
    expect([
      reading?.sample.machine.pressure?.fullAvg10,
      reading?.rung,
      reading?.held,
      reading?.health.treatments,
    ]).toEqual([
      6,
      2,
      [{ lane: LANE, treatment: { kind: "waiting-to-start" } }],
      [{ lane: LANE, treatment: { kind: "waiting-to-start" } }],
    ])
    await manager.close()
    await start.catch(() => {})
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

  test("the lanes are ranked only once memory is short enough for their order to decide", async () => {
    const { now, sensor } = pressured()
    let ranked = 0
    const manager = createMachineManager({
      ...managedDeps(sensor),
      laneFacts: {
        lanesByImportance: async lanes => {
          ranked++
          return lanes
        },
        programInFlight: () => null,
      },
    })
    await manager.start()
    now.running = true
    for (let i = 0; i < ENTER_AFTER + 2; i++) await manager.sample()
    expect(ranked).toBe(0)
    now.full = 6
    await toRung2(manager)
    expect(ranked).toBeGreaterThan(0)
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

  /** Settles after every microtask queued now: what has not settled by then waits on something else. */
  const turn = () => new Promise(resolve => setImmediate(resolve))

  test("a sample never waits on a documents step that waits at the gate", async () => {
    const { now, sensor } = pressured()
    // The host's documents' keeper, and its sink writing the latest value
    // in a merged step on it.
    const docs = createKeeper<string>()
    const written: MachineHealth[] = []
    let latest: MachineHealth | null = null
    const manager = createMachineManager({
      ...managedDeps(sensor),
      makeSink: () => ({
        write(health) {
          latest = health
          void docs.once("health", async () => {
            if (latest !== null) written.push(latest)
          })
        },
        writesFlushed: () => docs.idle(),
      }),
    })
    await manager.start()
    now.full = 6
    await toRung2(manager)
    // A get-the-latest's step, waiting at the gate for its lane's start.
    let stepEnded = false
    void docs
      .run(() => manager.waitUntilAllowed(LANE, "container-start"))
      .then(() => {
        stepEnded = true
      })
    let sampled = false
    void manager.sample().then(() => {
      sampled = true
    })
    await turn()
    expect(sampled).toBe(true)
    now.full = 0
    for (let i = 0; i < LEAVE_AFTER + 2 && !stepEnded; i++)
      await manager.sample()
    await turn()
    expect(stepEnded).toBe(true)
  })

  test("isLaneActivityAllowed answers as waitUntilAllowed settles", async () => {
    const answers = async (mode: ManageMode) => {
      const { now, sensor } = pressured()
      const { manager } = managed(sensor, mode)
      await manager.start()
      const both = async () => {
        let settled = false
        void manager.waitUntilAllowed(LANE, "container-start").then(
          () => {
            settled = true
          },
          () => {},
        )
        await turn()
        return [manager.isLaneActivityAllowed(LANE, "container-start"), settled]
      }
      const before = await both()
      now.full = 6
      await toRung2(manager)
      const short = await both()
      await manager.close().catch(() => {})
      return [before, short]
    }
    expect(await answers("manage")).toEqual([
      [true, true],
      [false, false],
    ])
    expect(await answers("observe")).toEqual([
      [true, true],
      [true, true],
    ])
  })

  /** `pressured`, whose sample waits while `hang.on`, until `hang.release`. */
  const hanging = () => {
    const p = pressured()
    let release = Promise.withResolvers<void>()
    const hang = {
      on: false,
      release: () => {
        hang.on = false
        release.resolve()
        release = Promise.withResolvers<void>()
      },
    }
    const sensor: MachineSensor = {
      sample: async () => {
        if (hang.on) await release.promise
        return p.sensor.sample()
      },
    }
    return { now: p.now, sensor, hang }
  }
  const ticks = (manager: MachineManager, count: number) => {
    for (let i = 0; i < count; i++) manager.sampleTick()
  }
  /** A sample started at the next tick, hanging, then ticks until the reading is overdue. */
  const hungUntilOverdue = async (
    manager: MachineManager,
    hang: { on: boolean },
  ) => {
    hang.on = true
    ticks(manager, 1)
    await turn()
    ticks(manager, READING_OVERDUE_AFTER_TICKS - 1)
    await turn()
  }

  test("a reading no sample replaces lets every hold go, and says so", async () => {
    const { now, sensor, hang } = hanging()
    const { manager, written } = managed(sensor)
    await manager.start()
    now.full = 6
    await toRung2(manager)
    let started = false
    void manager.waitUntilAllowed(LANE, "container-start").then(() => {
      started = true
    })
    await manager.sample()
    hang.on = true
    ticks(manager, 1)
    await turn()
    ticks(manager, READING_OVERDUE_AFTER_TICKS - 2)
    await turn()
    expect(started).toBe(false)
    ticks(manager, 1)
    await turn()
    expect(started).toBe(true)
    expect(manager.isLaneActivityAllowed(LANE, "container-start")).toBe(true)
    expect(written.at(-1)).toEqual({
      state: "amber",
      causes: [
        { kind: "unsampled", reason: "overdue", error: null },
        { kind: "memory-short", rung: 2, isHolding: false },
      ],
      treatments: [],
    })
    expect(manager.latestReading()?.kind).toBe("overdue")
    hang.release()
    await manager.close()
  })

  test("a sample that hung holds nothing when it ends, and the next plans as usual", async () => {
    const { now, sensor, hang } = hanging()
    const measurements = keptMeasurements()
    const told: ManagerNews[] = []
    const manager = createMachineManager({
      ...managedDeps(sensor),
      measurements,
      tell: news => told.push(news),
    })
    await manager.start()
    now.full = 6
    await toRung2(manager)
    expect(manager.isLaneActivityAllowed(LANE, "container-start")).toBe(false)
    const measured = measurements.samples.length
    await hungUntilOverdue(manager, hang)
    expect(manager.isLaneActivityAllowed(LANE, "container-start")).toBe(true)
    hang.release()
    await manager.idle()
    expect(told.filter(n => n.kind === "stale-sample")).toHaveLength(1)
    // Only the sample queued behind it is measured, and holds again.
    expect(measurements.samples.length).toBe(measured + 1)
    expect(manager.isLaneActivityAllowed(LANE, "container-start")).toBe(false)
    expect(manager.latestReading()?.kind).toBe("fresh")
    await manager.close()
  })

  test("after an overdue health, a fresh sample writes its health though it is the one from before", async () => {
    const { sensor, hang } = hanging()
    const { manager, written } = managed(sensor)
    await manager.start()
    await manager.idle()
    await hungUntilOverdue(manager, hang)
    hang.release()
    await manager.idle()
    expect(reasons(written)).toEqual([
      "waiting",
      "neutral",
      "overdue",
      "neutral",
    ])
    await manager.close()
  })

  test("close returns with a sample that never ends, whose end then changes nothing", async () => {
    const { sensor, hang } = hanging()
    const { manager, written } = managed(sensor)
    await manager.start()
    await manager.idle()
    hang.on = true
    void manager.sample()
    await turn()
    await manager.close()
    hang.release()
    await turn()
    expect(reasons(written)).toEqual(["waiting", "neutral", "stopped"])
  })

  test("close waits for its last write to land", async () => {
    const written: MachineHealth[] = []
    let landing = Promise.resolve()
    const manager = createMachineManager({
      ...managedDeps(steady),
      makeSink: () => ({
        write(health) {
          landing = landing.then(turn).then(() => void written.push(health))
        },
        writesFlushed: () => landing,
      }),
    })
    await manager.start()
    await manager.idle()
    await manager.close()
    expect(reasons(written).at(-1)).toBe("stopped")
  })
})

describe("measurements", () => {
  test.each(["manage", "observe"] as const)(
    "every sample is measured, and they are trimmed every TRIM_MEASUREMENTS_EVERY_SAMPLES samples, %s",
    async mode => {
      const measurements = keptMeasurements()
      const manager = createMachineManager({
        ...managedDeps(steady),
        mode,
        measurements,
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

  test("a lane's OOM kill, a service's and the host's stall are each recorded once, as the sample that saw them", async () => {
    const lane = threadIdFor("t-1")
    const cgroup = (oomKills: number) => ({
      lane,
      current: GiB,
      anon: GiB,
      file: 0,
      limit: 2 * GiB,
      oomKills,
      limitHits: { max: 0, high: 0 },
      pressure: null,
    })
    const samples: SensedSample[] = [
      { ...calm, lanes: [cgroup(0)], lanesRunning: [lane] },
      {
        ...calm,
        lanes: [cgroup(1)],
        lanesRunning: [lane],
        serviceKills: ["disks"],
        hostStalledMs: 1500,
      },
      { ...calm, lanes: [cgroup(1)], lanesRunning: [lane] },
    ]
    let at = 0
    const measurements = keptMeasurements()
    const manager = createMachineManager({
      ...managedDeps({
        sample: async () => samples[Math.min(at++, 2)] ?? calm,
      }),
      measurements,
    })
    await manager.start()
    await manager.sample()
    await manager.sample()
    await manager.idle()
    expect(measurements.events).toEqual([
      { kind: "lane-oom-killed", lane },
      { kind: "service-oom-killed", service: "disks" },
      { kind: "host-stalled", ms: 1500 },
    ])
  })

  test("a sample after one whose observer's max was lower records it at its limit", async () => {
    const observer = (max: number): SensedSample["services"][number] => ({
      service: "observer",
      memory: {
        kind: "read",
        currentBytes: GiB / 2,
        limitBytes: GiB / 2,
        limitHits: { max, high: 0 },
      },
    })
    const samples: SensedSample[] = [
      { ...calm, services: [observer(100)] },
      { ...calm, services: [observer(141)] },
      { ...calm, services: [observer(141)] },
    ]
    let at = 0
    const measurements = keptMeasurements()
    const manager = createMachineManager({
      ...managedDeps({
        sample: async () => samples[Math.min(at++, 2)] ?? calm,
      }),
      measurements,
    })
    await manager.start()
    await manager.sample()
    await manager.sample()
    await manager.idle()
    expect(measurements.events).toEqual([
      {
        kind: "cgroup-at-limit",
        subject: { kind: "service", service: "observer" },
        maxHits: 41,
        highHits: 0,
      },
    ])
  })

  test("an observer meeting its limit sample after sample is a cause in the health written", async () => {
    let max = 0
    const { manager, written } = managed({
      sample: async () => {
        max += 10
        return {
          ...calm,
          services: [
            {
              service: "observer",
              memory: {
                kind: "read",
                currentBytes: GiB / 2,
                limitBytes: GiB / 2,
                limitHits: { max, high: 0 },
              },
            },
          ],
        }
      },
    })
    await manager.start()
    for (let i = 0; i < ENTER_AFTER; i++) await manager.sample()
    await manager.idle()
    expect(written.at(-1)?.causes).toEqual([
      {
        kind: "cgroup-at-limit",
        subject: { kind: "service", service: "observer" },
      },
    ])
  })

  test("a host in a lane's own cgroup at its limit is recorded, and is no cause", async () => {
    let max = 0
    const measurements = keptMeasurements()
    const written: MachineHealth[] = []
    const manager = createMachineManager({
      ...managedDeps({
        sample: async () => {
          max += 10
          return {
            ...calm,
            machine: {
              ...calm.machine,
              source: "own-cgroup",
              limitHits: { max, high: 0 },
            },
          }
        },
      }),
      makeSink: recordingSink(written),
      measurements,
    })
    await manager.start()
    for (let i = 0; i < ENTER_AFTER + 1; i++) await manager.sample()
    await manager.idle()
    expect(measurements.events[0]).toEqual({
      kind: "cgroup-at-limit",
      subject: { kind: "own" },
      maxHits: 10,
      highHits: 0,
    })
    expect(written.at(-1)?.causes).toEqual([])
  })

  test("the machine's reclaim is recorded as its rise with each sample, and none for an own-cgroup sample", async () => {
    const reclaim = (allocStalls: number) => ({
      allocStalls,
      scannedDirect: 10 * allocStalls,
      scannedByKswapd: 100 * allocStalls,
    })
    const whole = (stalls: number): SensedSample => ({
      ...calm,
      machine: { ...calm.machine, reclaim: reclaim(stalls) },
    })
    const own: SensedSample = {
      ...calm,
      machine: { ...calm.machine, source: "own-cgroup", reclaim: null },
    }
    const samples = [whole(300), whole(320), own, own]
    let at = 0
    const measurements = keptMeasurements()
    const manager = createMachineManager({
      ...managedDeps({ sample: async () => samples[at++] ?? own }),
      measurements,
    })
    await manager.start()
    await manager.sample()
    await manager.sample()
    await manager.sample()
    await manager.idle()
    expect(measurements.samples.map(s => s.reclaim)).toEqual([
      null,
      reclaim(20),
      null,
      null,
    ])
  })

  test("each sample's scope is recorded, and a stall with no machine reclaim holds nothing", async () => {
    const reclaim = { allocStalls: 5, scannedDirect: 50, scannedByKswapd: 500 }
    const stalled: SensedSample = {
      ...calm,
      machine: {
        ...calm.machine,
        pressure: { someAvg10: 30, fullAvg10: 25 },
        reclaim,
      },
    }
    const measurements = keptMeasurements()
    const manager = createMachineManager({
      ...managedDeps({ sample: async () => stalled }),
      measurements,
    })
    await manager.start()
    for (let i = 0; i < ENTER_AFTER + 2; i++) await manager.sample()
    await manager.idle()
    expect(measurements.samples.map(s => s.scope)).toEqual([
      "machine",
      ...Array.from({ length: ENTER_AFTER + 2 }, () => "contained"),
    ])
    expect(measurements.samples.map(s => s.rung)).not.toContain(1)
    expect(manager.latestReading()).toMatchObject({ kind: "fresh", rung: 0 })
  })

  test("a measurement that cannot be written is told, and the sample goes on", async () => {
    const told: ManagerNews[] = []
    const written: MachineHealth[] = []
    const manager = createMachineManager({
      ...managedDeps(steady),
      makeSink: recordingSink(written),
      measurements: {
        ...keptMeasurements(),
        recordSample: () => {
          throw new Error("disk full")
        },
      },
      tell: news => told.push(news),
    })
    await manager.start()
    await manager.sample()
    expect(told).toContainEqual({ kind: "unmeasured", error: "disk full" })
    expect(reasons(written)).toEqual(["waiting", "neutral"])
  })
})

describe("the lane VM's repair", () => {
  const spent: SensedSample = {
    ...calm,
    store: {
      size: 64 * GiB,
      unallocated: GiB / 2,
      data: { used: 32 * GiB, total: 63 * GiB },
      metadata: { used: GiB / 2, total: GiB },
    },
  }
  const lane = threadIdFor("t-repair")

  /** Controls that record each step, the boot held until `boot` resolves. */
  function fakeControls(shared: { text: string | null; lockHeld: boolean }) {
    const steps: string[] = []
    const boot = Promise.withResolvers<RepairOutcome>()
    const controls: RepairControls<"held", "launcher"> = {
      takeRepairLock: async () => {
        steps.push("take")
        shared.lockHeld = true
        return "held"
      },
      lockLost: () => new Promise(() => {}),
      readRepair: async () => ({ ...shared }),
      repairBootMissing: async () => null,
      diskSize: async () => 64 * GiB,
      stopVmForRepair: async () => {
        steps.push("stop")
      },
      awaitLauncherGone: async () => {
        steps.push("launcher")
        return "launcher"
      },
      growForRepair: async () => {
        steps.push("grow")
        return 128 * GiB
      },
      bootRepair: async () => {
        steps.push("boot")
        return boot.promise
      },
      writeRepairState: async (_held, state) => {
        shared.text = encodeRepairState(state)
      },
      releaseRepairLocks: async () => {
        steps.push("release")
        shared.lockHeld = false
      },
    }
    return { controls, steps, boot }
  }

  function repairing(
    shared: { text: string | null; lockHeld: boolean },
    controls: RepairControls<"held", "launcher"> | null,
    sensed: SensedSample = spent,
    mode: ManageMode = "manage",
  ) {
    const written: MachineHealth[] = []
    const measurements = keptMeasurements()
    const manager = createMachineManager({
      ...managedDeps({ sample: async () => sensed }),
      makeSink: recordingSink(written),
      mode,
      capabilities: { grow: true, repairDisk: true },
      measurements,
      readRepair: async () => ({ ...shared }),
      repair: controls,
    })
    return { manager, written, measurements }
  }

  /** A sample, then the upkeep, which finds nothing to delete, the room spent. */
  async function untilExhausted(manager: MachineManager) {
    await manager.start()
    await manager.sample()
    manager.requestUpkeep()
    await manager.idle()
  }

  test("a sample with the room spent and nothing to delete repairs, beside the loop, once", async () => {
    const shared = { text: null, lockHeld: false }
    const { controls, steps, boot } = fakeControls(shared)
    const { manager, written } = repairing(shared, controls)
    await untilExhausted(manager)
    await manager.sample()
    // The boot runs; samples go on, and are not held behind it.
    await manager.sample()
    await manager.sample()
    expect(steps).toEqual(["take", "stop", "launcher", "grow", "boot"])
    expect(written.at(-1)?.causes[0]).toMatchObject({
      kind: "disk-being-repaired",
    })
    boot.resolve({
      leftUnallocated: 60 * GiB,
      leftMetadata: { size: GiB, used: GiB / 2 },
      failed: null,
    })
    await manager.idle()
    await new Promise(r => setTimeout(r, 0))
    expect(steps.at(-1)).toBe("release")
    expect(decodeRepairState(shared.text)).toMatchObject({ kind: "done" })
    expect(steps.filter(s => s === "take")).toHaveLength(1)
  })

  test("a sample taken before the repair has written its state asks for no second", async () => {
    const shared = { text: null, lockHeld: false }
    const { controls } = fakeControls(shared)
    const taking = Promise.withResolvers<"held">()
    let takes = 0
    const { manager } = repairing(shared, {
      ...controls,
      takeRepairLock: () => {
        takes++
        return taking.promise
      },
    })
    await untilExhausted(manager)
    await manager.sample()
    await manager.sample()
    expect(takes).toBe(1)
  })

  test("observing, or where nothing is repaired, the room spent is said and nothing is repaired", async () => {
    const shared = { text: null, lockHeld: false }
    const { manager, written } = repairing(shared, null)
    await untilExhausted(manager)
    await manager.sample()
    expect(shared.text).toBeNull()
    expect(written.at(-1)?.causes.map(c => c.kind)).toContain("room-spent")
  })

  test("another host's recorded failure stops this host's repair, until the disk could grow", async () => {
    const shared = {
      text: encodeRepairState({
        kind: "failed",
        why: "no room",
        sizeAtFailure: 64 * GiB,
      }),
      lockHeld: false,
    }
    const { controls, steps } = fakeControls(shared)
    const { manager, written } = repairing(shared, controls)
    await untilExhausted(manager)
    await manager.sample()
    expect(steps).toEqual([])
    expect(written.at(-1)?.causes[0]).toEqual({
      kind: "disk-repair-failed",
      why: "no room",
    })
  })

  test("a failed repair asked for again runs as a person asked, whatever the disk could grow to, and is recorded once", async () => {
    const shared = {
      text: encodeRepairState({
        kind: "failed",
        why: "no room",
        sizeAtFailure: 1024 * GiB,
      }),
      lockHeld: false,
    }
    const { controls, steps, boot } = fakeControls(shared)
    const { manager, measurements } = repairing(shared, controls, calm)
    await manager.start()
    await manager.sample()
    manager.askRepairAgain()
    await manager.idle()
    await new Promise(r => setTimeout(r, 0))
    expect(steps).toEqual(["take", "stop", "launcher", "grow", "boot"])
    expect(measurements.decisions.find(d => d.kind === "repair")).toMatchObject(
      { from: "failed", to: "detected" },
    )
    expect(measurements.events).toEqual([{ kind: "repair-asked-again" }])
    boot.resolve({ leftUnallocated: null, leftMetadata: null, failed: "x" })
    await manager.close()
  })

  test("a repair asked for again with none failed changes nothing", async () => {
    const shared = { text: null, lockHeld: false }
    const { controls, steps } = fakeControls(shared)
    const { manager, measurements } = repairing(shared, controls, calm)
    await manager.start()
    manager.askRepairAgain()
    await manager.sample()
    await manager.idle()
    expect([steps, shared.text, measurements.events]).toEqual([[], null, []])
    await manager.close()
  })

  test("another host's repair holds this host's lanes, and its VM start does not", async () => {
    const shared = {
      text: encodeRepairState({ kind: "booting-repair", progress: [] }),
      lockHeld: true,
    }
    const { manager } = repairing(shared, null, calm)
    await manager.start()
    await manager.sample()
    let called = false
    const call = manager.waitUntilAllowed(lane, "tool-call").then(() => {
      called = true
    })
    await new Promise(r => setTimeout(r, 0))
    expect(called).toBe(false)
    shared.text = encodeRepairState({ kind: "idle" })
    await manager.sample()
    await call
    expect(called).toBe(true)
  })
})
