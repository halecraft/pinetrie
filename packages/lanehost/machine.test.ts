import { describe, expect, test } from "vitest"
import {
  cgroupCandidates,
  deviceName,
  isContainerId,
  parseMeminfo,
  parseMemoryEvents,
  parseMemoryMax,
  parseMemoryStat,
  parsePressure,
  planBtrfsRoom,
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

test("a container's cgroup is looked for where cgroupfs and systemd put it", () => {
  expect(cgroupCandidates(ID)).toEqual([
    `docker/${ID}`,
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
