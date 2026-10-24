import { describe, expect, test } from "vitest"
import { type ContainerWanted, planContainment } from "./containment.ts"

const FLOOR = 1_468_006_400
const lane: ContainerWanted = {
  processesMax: 16_384,
  expectedCpuWeight: null,
  readBack: { processesMax: 16_384, cpuWeight: 100 },
}
const service: ContainerWanted = {
  processesMax: 1024,
  expectedCpuWeight: 303,
  readBack: { processesMax: 1024, cpuWeight: 303 },
}
const plan = (
  containers: readonly ContainerWanted[],
  over: Partial<Parameters<typeof planContainment>[0]> = {},
) =>
  planContainment({
    wanted: { containers, servicesFloor: FLOOR },
    servicesFloorReadBack: FLOOR,
    cgroupDriver: "cgroupfs",
    ...over,
  })

describe("planContainment", () => {
  test("every control read back as wanted is contained", () => {
    expect(plan([lane, service])).toEqual({ kind: "contained" })
  })

  test("a Docker with no cgroup driver contains nothing, whatever its containers read", () => {
    expect(plan([lane, service], { cgroupDriver: "none" })).toEqual({
      kind: "not-contained",
      missing: ["processes", "cpu-weight", "services-floor"],
      why: "no-cgroup-driver",
    })
  })

  test("a container whose pids.max reads max is missing its process limit", () => {
    const unlimited = {
      ...lane,
      readBack: { processesMax: null, cpuWeight: 100 },
    }
    expect(plan([unlimited, service])).toEqual({
      kind: "not-contained",
      missing: ["processes"],
      why: "not-read-back",
    })
  })

  test("a service reading the default weight where its share's was wanted is missing its CPU weight", () => {
    const defaulted = {
      ...service,
      readBack: { processesMax: 1024, cpuWeight: 100 },
    }
    expect(plan([lane, defaulted])).toEqual({
      kind: "not-contained",
      missing: ["cpu-weight"],
      why: "not-read-back",
    })
  })

  test("a lane's default share is not judged", () => {
    const unweighted = {
      ...lane,
      readBack: { processesMax: 16_384, cpuWeight: null },
    }
    expect(plan([unweighted, lane])).toEqual({ kind: "contained" })
  })

  test("a floor wanted and not there is missing", () => {
    expect(plan([lane], { servicesFloorReadBack: null })).toEqual({
      kind: "not-contained",
      missing: ["services-floor"],
      why: "not-read-back",
    })
  })

  test("a host that keeps no floor does not judge one", () => {
    expect(
      planContainment({
        wanted: { containers: [service], servicesFloor: null },
        servicesFloorReadBack: null,
        cgroupDriver: "systemd",
      }),
    ).toEqual({ kind: "contained" })
  })
})
