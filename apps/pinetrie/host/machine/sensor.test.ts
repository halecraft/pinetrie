import { threadIdFor } from "@pinetrie/core"
import type { ServiceKillWatch } from "@pinetrie/docker"
import type { MachineRead } from "@pinetrie/lanehost"
import { describe, expect, test } from "vitest"
import {
  createSensor,
  ownCgroupMachine,
  planSample,
  serviceReadings,
} from "./sensor.ts"

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
  counters: null,
  store: null,
  containers: [
    { id: "id-a", memory },
    { id: "id-b", memory: null },
  ],
}

test("each running lane's cgroup is its sample, and a lane whose cgroup was not found is left out of it but still running", () => {
  const sample = planSample({
    running: [
      { lane: a, id: "id-a" },
      { lane: b, id: "id-b" },
    ],
    services: [],
    read,
    own: null,
    filesystem: { size: 10, free: 5 },
    serviceKills: [],
    hostStalledMs: 1200,
  })
  expect(sample.lanes).toEqual([{ lane: a, ...memory }])
  expect(sample.lanesRunning).toEqual([a, b])
  expect(sample.machine).toEqual({
    memoryTotal: 1000,
    memoryAvailable: 600,
    pressure: { someAvg10: 1, fullAvg10: 0 },
    counters: null,
    source: "whole-machine",
  })
  expect([sample.filesystem, sample.hostStalledMs]).toEqual([
    { size: 10, free: 5 },
    1200,
  ])
})

test("a sample whose read fails leaves the kills heard for the next", async () => {
  let reads = 0
  const reach: Parameters<typeof createSensor>[0] = {
    memorySource: "whole-machine",
    runningLanes: async () => [],
    runningServices: async () => [],
    machineSample: async () => {
      reads += 1
      if (reads === 1) throw new Error("no answer")
      return { ...read, containers: [] }
    },
    storeVolume: "/",
  }
  let heard: ("disks" | "observer")[] = ["observer"]
  const kills: Pick<ServiceKillWatch, "take"> = {
    take: async () => {
      const taken = heard
      heard = []
      return taken
    },
  }
  const sensor = createSensor(reach, kills)
  await expect(sensor.sample()).rejects.toThrow("no answer")
  expect((await sensor.sample()).serviceKills).toEqual(["observer"])
})

test("a service's memory is its container's cgroup, against its limit; one not running or not read says why", () => {
  const memoryById = new Map([
    ["id-disks", memory],
    ["id-observer", null],
  ])
  const services = [
    { service: "disks", id: "id-disks" },
    { service: "observer", id: "id-observer" },
  ] as const
  expect(serviceReadings(services, memoryById, false)).toEqual([
    {
      service: "disks",
      memory: { kind: "read", currentBytes: 100, limitBytes: 400 },
    },
    {
      service: "privileged",
      memory: { kind: "unreadable", why: "it is not running" },
    },
    {
      service: "observer",
      memory: { kind: "unreadable", why: "its cgroup could not be read" },
    },
  ])
})

test("a host in a lane reads no observer: the host outside runs it", () => {
  const observer = serviceReadings(
    [{ service: "observer", id: "id-a" }],
    new Map([["id-a", memory]]),
    true,
  ).find(s => s.service === "observer")
  expect(observer?.memory).toEqual({
    kind: "unreadable",
    why: "the host outside this lane runs it",
  })
})

describe("a host in a lane reads its own cgroup as the machine", () => {
  const MiB = 1024 ** 2
  const own = {
    max: `${512 * MiB}\n`,
    current: `${511 * MiB}\n`,
    stat: `anon 1048576\ninactive_file ${504 * MiB}\nworkingset_refault_anon 3\nworkingset_refault_file 7\n`,
    pressure:
      "some avg10=0.13 avg60=0.05 avg300=0.01 total=54829\nfull avg10=0.13 avg60=0.05 avg300=0.01 total=54000\n",
  }

  test("its available is its limit less its use but its inactive cache, so a cgroup full of cache has room", () => {
    expect(ownCgroupMachine(own, { total: 8000 * MiB, available: 10 })).toEqual(
      {
        memoryTotal: 512 * MiB,
        memoryAvailable: 505 * MiB,
        pressure: { someAvg10: 0.13, fullAvg10: 0.13 },
        counters: {
          refaultAnon: 3,
          refaultFile: 7,
          stallSomeUs: 54829,
          stallFullUs: 54000,
        },
      },
    )
  })

  test("with no limit, its memory is the whole machine's, its pressure its own", () => {
    const got = ownCgroupMachine(
      { ...own, max: "max\n" },
      { total: 8000 * MiB, available: 6000 * MiB },
    )
    expect([got.memoryTotal, got.memoryAvailable]).toEqual([
      8000 * MiB,
      6000 * MiB,
    ])
    expect(got.pressure).toEqual({ someAvg10: 0.13, fullAvg10: 0.13 })
  })

  test("its sample says it read its own cgroup, never the machine's pressure", () => {
    const sample = planSample({
      running: [],
      services: [],
      read,
      own,
      filesystem: null,
      serviceKills: [],
      hostStalledMs: 0,
    })
    expect(sample.machine.source).toBe("own-cgroup")
    expect(sample.machine.pressure).not.toEqual(read.pressure)
  })
})
