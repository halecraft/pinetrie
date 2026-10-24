import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  cgroupCandidates,
  deviceName,
  isContainerId,
  memoryCounters,
  parseInactiveFile,
  parseLimitHits,
  parseMeminfo,
  parseMemoryEvents,
  parseMemoryMax,
  parseMemoryStat,
  parsePressure,
  parsePressureTotals,
  parseReclaim,
  planBtrfsRoom,
  readContainers,
  readServicesFloor,
  SERVICES_CGROUP,
} from "./machine.ts"

// As the lane VM's kernel writes them.
const MEMINFO = [
  "MemTotal:       12234560 kB",
  "MemFree:          310200 kB",
  "MemAvailable:    8159232 kB",
  "Buffers:           10240 kB",
].join("\n")
const MACHINE_PRESSURE = [
  "some avg10=12.31 avg60=11.02 avg300=6.10 total=35855907",
  "full avg10=9.67 avg60=9.49 avg300=5.46 total=24431930",
].join("\n")
const MEMORY_STAT = [
  "anon 268435456",
  "file 805306368",
  "kernel 12582912",
  "workingset_refault_anon               0",
].join("\n")
const MEMORY_EVENTS = [
  "low 0",
  "high 0",
  "max 31",
  "oom 2",
  "oom_kill 2",
  "oom_group_kill 0",
].join("\n")
// A lane VM short of memory: tasks stalled to reclaim in two zones.
const VMSTAT = [
  "workingset_refault_anon 0",
  "workingset_refault_file 136994458",
  "pgmajfault 753",
  "pgscan_kswapd 138109863",
  "pgscan_direct 1297949",
  "pgscan_khugepaged 0",
  "pgscan_proactive 0",
  "pgscan_anon 0",
  "pgscan_file 139407812",
  "allocstall_dma 0",
  "allocstall_normal 322",
  "allocstall_movable 27674",
  "allocstall_device 0",
].join("\n")
const ID = "6785fca0587a9b4f0b1c305c652fb18e5b0ee0306239a70602a80c44cd7a1717"

describe("parsers", () => {
  test("meminfo's total and available, in bytes", () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      total: 12234560 * 1024,
      available: 8159232 * 1024,
    })
    expect(parseMeminfo("MemTotal: 1 kB")).toBeNull()
  })

  test("a pressure file's avg10s", () => {
    expect(parsePressure(MACHINE_PRESSURE)).toEqual({
      someAvg10: 12.31,
      fullAvg10: 9.67,
    })
    expect(
      parsePressure("some avg10=0.00 avg60=0.00 avg300=0.00 total=0"),
    ).toEqual({ someAvg10: 0, fullAvg10: 0 })
    expect(parsePressure("")).toBeNull()
  })

  test("memory.stat's anon and file", () => {
    expect(parseMemoryStat(MEMORY_STAT)).toEqual({
      anon: 268435456,
      file: 805306368,
    })
  })

  test("memory.events' OOM kills", () => {
    expect(parseMemoryEvents(MEMORY_EVENTS)).toBe(2)
    expect(parseMemoryEvents("oom_kill 0")).toBe(0)
  })

  test("memory.events' limit hits: max met and high gone over", () => {
    expect(parseLimitHits(MEMORY_EVENTS)).toEqual({ max: 31, high: 0 })
    expect(parseLimitHits("low 0\nhigh 7\nmax 0\n")).toEqual({
      max: 0,
      high: 7,
    })
  })

  test("vmstat's reclaim: every zone's stalls summed, and both scans", () => {
    expect(parseReclaim(VMSTAT)).toEqual({
      allocStalls: 322 + 27674,
      scannedDirect: 1297949,
      scannedByKswapd: 138109863,
    })
  })

  test("a vmstat without reclaim's counters reads none", () => {
    expect(
      parseReclaim("workingset_refault_file 7\npgscan_kswapd 0\n"),
    ).toBeNull()
    expect(parseReclaim(VMSTAT.replace("pgscan_direct 1297949", ""))).toBeNull()
  })

  test("memory.max's bytes, and max as no ceiling", () => {
    expect(parseMemoryMax("4294967296\n")).toBe(4 * 1024 ** 3)
    expect(parseMemoryMax("max\n")).toBeNull()
  })
})

test("a full 2 GiB disk's room is its 1 MiB unallocated", () => {
  // `/sys/fs/btrfs/<fsid>/allocation/` on a disk filled until metadata
  // could not grow: data single, metadata and system DUP.
  expect(
    planBtrfsRoom({
      deviceBytes: [2 * 1024 ** 3],
      data: {
        total: 1914961920,
        used: 963874816,
        diskTotal: 1914961920,
      },
      metadata: {
        total: 107347968,
        used: 97550336,
        diskTotal: 214695936,
      },
      system: { total: 8388608, used: 16384, diskTotal: 16777216 },
    }),
  ).toEqual({
    size: 2 * 1024 ** 3,
    unallocated: 1048576,
    data: { total: 1914961920, used: 963874816 },
    metadata: { total: 107347968, used: 97550336 },
  })
})

test("a container's cgroup is looked for where cgroupfs puts a lane and a service, and systemd any", () => {
  expect(cgroupCandidates(ID)).toEqual([
    `docker/${ID}`,
    `pinetrie-services/${ID}`,
    `system.slice/docker-${ID}.scope`,
  ])
})

test("only a full container id names a cgroup", () => {
  expect(isContainerId(ID)).toBe(true)
  expect(isContainerId("6785fca0587a")).toBe(false)
  expect(isContainerId(`../${ID.slice(3)}`)).toBe(false)
})

test("a device's name is its path under /dev, and nothing deeper", () => {
  expect(deviceName("/dev/vdb")).toBe("vdb")
  expect(deviceName("/dev/mapper/vg-lanes")).toBeNull()
  expect(deviceName("overlay")).toBeNull()
})

describe("the kernel's memory counters", () => {
  const VMSTAT =
    "nr_free_pages 123\nworkingset_refault_anon 4021\nworkingset_refault_file 99812\nworkingset_activate_anon 1\n"
  const PRESSURE =
    "some avg10=0.00 avg60=0.00 avg300=0.00 total=6120\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=5100\n"

  test("refaults from /proc/vmstat and stall time from /proc/pressure/memory", () => {
    expect(memoryCounters(VMSTAT, PRESSURE)).toEqual({
      refaultAnon: 4021,
      refaultFile: 99812,
      stallSomeUs: 6120,
      stallFullUs: 5100,
    })
  })

  test("a file not read, or one without refaults, gives none", () => {
    expect(memoryCounters(null, PRESSURE)).toBeNull()
    expect(memoryCounters("nr_free_pages 1\n", PRESSURE)).toBeNull()
    expect(parsePressureTotals("")).toBeNull()
  })

  test("a cgroup's inactive page cache from its memory.stat", () => {
    expect(parseInactiveFile("anon 4096\ninactive_file 528379904\n")).toBe(
      528379904,
    )
  })
})

describe("a container's cgroup under the tree", () => {
  /** A cgroup tree in a directory of its own, each file as given; removed after `use`. */
  async function withTree(
    files: Readonly<Record<string, string>>,
    use: (tree: string) => Promise<void>,
  ) {
    const tree = await mkdtemp(path.join(tmpdir(), "cgroup-"))
    try {
      for (const [file, text] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(tree, file)), { recursive: true })
        await writeFile(path.join(tree, file), text)
      }
      await use(tree)
    } finally {
      await rm(tree, { recursive: true, force: true })
    }
  }
  // Each test's ids its own: a container's cgroup, once found, is kept
  // for as long as it is asked for.
  const lane = "a".repeat(64)
  const service = "b".repeat(64)
  const capped = "c".repeat(64)
  const gone = "d".repeat(64)
  const cgroup = (dir: string, pids: string, weight: string) => ({
    [`${dir}/memory.current`]: "1048576\n",
    [`${dir}/memory.stat`]: MEMORY_STAT,
    [`${dir}/memory.events`]: "max 0\nhigh 0\noom_kill 0\n",
    [`${dir}/pids.max`]: pids,
    [`${dir}/cpu.weight`]: weight,
  })

  test("a service under the services' parent is found and read, as a lane under Docker's own", async () => {
    await withTree(
      {
        ...cgroup(`docker/${lane}`, "16384\n", "100\n"),
        ...cgroup(`${SERVICES_CGROUP}/${service}`, "1024\n", "303\n"),
      },
      async tree => {
        const [l, s] = await readContainers(tree, [lane, service])
        expect(l?.controls).toEqual({ processesMax: 16_384, cpuWeight: 100 })
        expect(s?.controls).toEqual({ processesMax: 1024, cpuWeight: 303 })
        expect(s?.memory?.current).toBe(1_048_576)
      },
    )
  })

  test("the controls read from pids.max and cpu.weight, and max reads null", async () => {
    await withTree(cgroup(`docker/${capped}`, "max\n", "100\n"), async tree => {
      const [l] = await readContainers(tree, [capped])
      expect(l?.controls).toEqual({ processesMax: null, cpuWeight: 100 })
    })
  })

  test("a container whose cgroup is not found reads no memory and no controls", async () => {
    await withTree({}, async tree => {
      expect(await readContainers(tree, [gone])).toEqual([
        {
          id: gone,
          memory: null,
          controls: { processesMax: null, cpuWeight: null },
        },
      ])
    })
  })

  test("the services' floor is their parent's memory.low, and none where it is not there", async () => {
    await withTree(
      { [`${SERVICES_CGROUP}/memory.low`]: "1468006400\n" },
      async tree => {
        expect(await readServicesFloor(tree)).toBe(1_468_006_400)
      },
    )
    await withTree({}, async tree => {
      expect(await readServicesFloor(tree)).toBeNull()
    })
    expect(await readServicesFloor(null)).toBeNull()
  })
})
