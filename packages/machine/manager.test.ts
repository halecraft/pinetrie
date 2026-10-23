import type { MachineHealth } from "@pinetrie/core"
import { expect, test } from "vitest"
import { LEAVE_AFTER } from "./health.ts"
import { createMachineManager, type ManagerNews } from "./manager.ts"
import type { MachineSensor } from "./ports.ts"
import type { SensedSample } from "./sample.ts"
import { LEAVE_FREE_DEFAULT } from "./store-settings.ts"

const GiB = 1024 ** 3

const calm: SensedSample = {
  machine: {
    memoryTotal: 12 * GiB,
    memoryAvailable: 8 * GiB,
    pressure: { someAvg10: 0, fullAvg10: 0 },
  },
  lanes: [],
  store: null,
  filesystem: null,
  serviceKills: [],
  hostStalledMs: 0,
}

/** A manager over `sensor`, with what its sink was written and what it told. */
function managed(sensor: MachineSensor) {
  const written: MachineHealth[] = []
  const told: ManagerNews[] = []
  const manager = createMachineManager({
    sensor,
    sink: {
      write: async health => {
        written.push(health)
      },
    },
    settings: { leaveFree: LEAVE_FREE_DEFAULT },
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
    { kind: "changed", health: { state: "neutral", causes: [] } },
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
    settings: { leaveFree: LEAVE_FREE_DEFAULT },
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
