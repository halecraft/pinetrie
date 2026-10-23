// host/machine/sensor — the machine's `MachineSensor`, composed here and
// nowhere else: the runtime's raw reads, the store's filesystem's free
// space, the services' kills heard from Docker, and the host's own stalls,
// mapped into the sample's values.

import { readFile, statfs } from "node:fs/promises"
import path from "node:path"
import type { MachineService } from "@pinetrie/core"
import type { RunningLane, ServiceKillWatch } from "@pinetrie/docker"
import {
  type MachineRead,
  memoryCounters,
  parseInactiveFile,
  parseMemoryMax,
  parsePressure,
} from "@pinetrie/lanehost"
import type { LaneSample, MachineSensor, SensedSample } from "@pinetrie/machine"
import type { Stall } from "../stalls.ts"
import type { MachineReach } from "../work/runtime.ts"

/** A host's own cgroup, where it reads it as the machine: `memory.*` as found, null for one not read. */
export interface OwnCgroupFiles {
  readonly max: string | null
  readonly current: string | null
  readonly stat: string | null
  readonly pressure: string | null
}

/** Where a host in a lane finds its own cgroup: its cgroup namespace's root. */
const OWN_CGROUP = "/sys/fs/cgroup"

/**
 * The machine's memory as a host in a lane has it: its own cgroup's limit,
 * and as available that limit less what its use is not inactive page cache,
 * since cache fills a cgroup to its limit with no pressure. Without a limit
 * (`max`), the whole machine's; its pressure and counters its cgroup's.
 */
export function ownCgroupMachine(
  own: OwnCgroupFiles,
  whole: MachineRead["memory"],
): Omit<SensedSample["machine"], "source"> {
  const limit = own.max === null ? null : parseMemoryMax(own.max)
  const current = own.current === null ? null : Number(own.current.trim())
  const inactive = own.stat === null ? 0 : parseInactiveFile(own.stat)
  const memory =
    limit === null || current === null || Number.isNaN(current)
      ? whole
      : {
          total: limit,
          available: Math.max(0, Math.min(limit, limit - current + inactive)),
        }
  return {
    memoryTotal: memory.total,
    memoryAvailable: memory.available,
    pressure: own.pressure === null ? null : parsePressure(own.pressure),
    counters: memoryCounters(own.stat, own.pressure),
  }
}

/**
 * One sample from what was read: each running lane's cgroup by its id, a
 * lane whose cgroup was not found left out of `lanes` but in `lanesRunning`,
 * the filesystem as found, and the machine's memory the whole machine's or,
 * given `own`, the host's own cgroup's.
 */
export function planSample(input: {
  readonly running: readonly RunningLane[]
  readonly read: MachineRead
  readonly own: OwnCgroupFiles | null
  readonly filesystem: SensedSample["filesystem"]
  readonly serviceKills: readonly MachineService[]
  readonly hostStalledMs: number
}): SensedSample {
  const { running, read } = input
  const memoryById = new Map(read.containers.map(c => [c.id, c.memory]))
  const lanes = running.flatMap((r): LaneSample[] => {
    const memory = memoryById.get(r.id)
    return memory == null ? [] : [{ lane: r.lane, ...memory }]
  })
  return {
    machine:
      input.own === null
        ? {
            memoryTotal: read.memory.total,
            memoryAvailable: read.memory.available,
            pressure: read.pressure,
            counters: read.counters,
            source: "whole-machine",
          }
        : { ...ownCgroupMachine(input.own, read.memory), source: "own-cgroup" },
    lanes,
    lanesRunning: running.map(r => r.lane),
    store: read.store,
    filesystem: input.filesystem,
    serviceKills: input.serviceKills,
    hostStalledMs: input.hostStalledMs,
  }
}

/** The filesystem holding `dir`: its size and what an unprivileged writer may still use. */
async function readFilesystem(
  dir: string,
): Promise<SensedSample["filesystem"]> {
  const fs = await statfs(dir).catch(() => null)
  return fs === null
    ? null
    : { size: fs.blocks * fs.bsize, free: fs.bavail * fs.bsize }
}

/**
 * The sensor over `reach` and `kills`; `hearStall` takes each of the host's
 * stalls. Kills are taken after the reads, so a sample whose read fails
 * leaves them for the next.
 */
/** The host's own cgroup's files, each null when it cannot be read. */
async function readOwnCgroup(): Promise<OwnCgroupFiles> {
  const read = (f: string) =>
    readFile(path.join(OWN_CGROUP, f), "utf8").catch(() => null)
  const [max, current, stat, pressure] = await Promise.all(
    ["memory.max", "memory.current", "memory.stat", "memory.pressure"].map(
      read,
    ),
  )
  return {
    max: max ?? null,
    current: current ?? null,
    stat: stat ?? null,
    pressure: pressure ?? null,
  }
}

export function createSensor(
  reach: Pick<
    MachineReach,
    "runningLanes" | "machineSample" | "storeVolume" | "memorySource"
  >,
  kills: Pick<ServiceKillWatch, "take">,
): MachineSensor & {
  hearStall(stall: Stall): void
} {
  /** The longest stall since the last sample, in ms. */
  let longest = 0
  return {
    hearStall(stall) {
      longest = Math.max(longest, stall.ms)
    },
    async sample() {
      const running = await reach.runningLanes()
      const [read, filesystem, own] = await Promise.all([
        reach.machineSample(running.map(r => r.id)),
        readFilesystem(reach.storeVolume),
        reach.memorySource === "own-cgroup" ? readOwnCgroup() : null,
      ])
      const serviceKills = await kills.take()
      const hostStalledMs = longest
      longest = 0
      return planSample({
        running,
        read,
        own,
        filesystem,
        serviceKills,
        hostStalledMs,
      })
    },
  }
}
