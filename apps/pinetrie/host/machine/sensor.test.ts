import { threadIdFor } from "@pinetrie/core"
import type { MachineRead } from "@pinetrie/lanehost"
import { expect, test } from "vitest"
import { planSample } from "./sensor.ts"

const a = threadIdFor("0197a3c2-5b1e-7c4d-8e2f-1a2b3c4d5e6f")
const b = threadIdFor("0197a3c2-5b1e-7c4d-8e2f-1a2b3c4d5e70")
const memory = {
  current: 100,
  anon: 40,
  file: 50,
  limit: 400,
  oomKills: 0,
  pressure: null,
}
const read: MachineRead = {
  memory: { total: 1000, available: 600 },
  pressure: { someAvg10: 1, fullAvg10: 0 },
  store: null,
  containers: [
    { id: "id-a", memory },
    { id: "id-b", memory: null },
  ],
}

test("each running lane's cgroup is its sample, and a lane whose cgroup was not found is left out", () => {
  const sample = planSample({
    running: [
      { lane: a, id: "id-a" },
      { lane: b, id: "id-b" },
    ],
    read,
    filesystem: { size: 10, free: 5 },
    hostStalledMs: 1200,
  })
  expect(sample.lanes).toEqual([{ lane: a, ...memory }])
  expect(sample.machine).toEqual({
    memoryTotal: 1000,
    memoryAvailable: 600,
    pressure: { someAvg10: 1, fullAvg10: 0 },
  })
  expect([sample.filesystem, sample.hostStalledMs]).toEqual([
    { size: 10, free: 5 },
    1200,
  ])
})
