// host/machine/sensor — the machine's `MachineSensor`, composed here and
// nowhere else: the runtime's raw reads, the store's filesystem's free
// space, the services' kills heard from Docker, and the host's own stalls,
// mapped into the sample's values.

import { readFile, statfs } from "node:fs/promises"
import path from "node:path"
import {
  type CgroupMemory,
  MACHINE_SERVICES,
  type MachineService,
  type ServiceReading,
} from "@pinetrie/core"
import {
  type RunningLane,
  type RunningService,
  type ServiceKillWatch,
  wantedControls,
} from "@pinetrie/docker"
import {
  type MachineRead,
  memoryCounters,
  parseInactiveFile,
  parseLimitHits,
  parseMemoryMax,
  parsePressure,
} from "@pinetrie/lanehost"
import {
  type LaneSample,
  type MachineSensor,
  planContainment,
  type SensedSample,
} from "@pinetrie/machine"
import type { Stall } from "../stalls.ts"
import type { MachineReach } from "../work/runtime.ts"

/** A host's own cgroup, where it reads it as the machine: `memory.*` as found, null for one not read. */
export interface OwnCgroupFiles {
  readonly max: string | null
  readonly current: string | null
  readonly stat: string | null
  readonly pressure: string | null
  readonly events: string | null
}

/** Where a host in a lane finds its own cgroup: its cgroup namespace's root. */
const OWN_CGROUP = "/sys/fs/cgroup"

/**
 * The machine's memory as a host in a lane has it: its own cgroup's limit,
 * and as available that limit less what its use is not inactive page cache,
 * since cache fills a cgroup to its limit with no pressure. Without a limit
 * (`max`), the whole machine's; its pressure, counters and limit hits its
 * cgroup's, and no reclaim: the machine's is other threads' too.
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
    reclaim: null,
    limitHits: own.events === null ? null : parseLimitHits(own.events),
  }
}

/**
 * Each service's memory from its container's cgroup, or why it was not
 * read. A host that reads its own cgroup runs in a lane, and its observer
 * is the host outside's.
 */
export function serviceReadings(
  services: readonly RunningService[],
  memoryById: ReadonlyMap<string, CgroupMemory | null>,
  inLane: boolean,
): readonly ServiceReading[] {
  return MACHINE_SERVICES.map((service): ServiceReading => {
    if (service === "observer" && inLane)
      return {
        service,
        memory: {
          kind: "unreadable",
          why: "the host outside this lane runs it",
        },
      }
    const running = services.find(s => s.service === service)
    if (running === undefined)
      return {
        service,
        memory: { kind: "unreadable", why: "it is not running" },
      }
    const memory = memoryById.get(running.id) ?? null
    return memory === null
      ? {
          service,
          memory: { kind: "unreadable", why: "its cgroup could not be read" },
        }
      : {
          service,
          memory: {
            kind: "read",
            currentBytes: memory.current,
            limitBytes: memory.limit,
            limitHits: memory.limitHits,
          },
        }
  })
}

/** What this host asks of its containers' cgroups beyond each kind's limits: gathered once, at its start. */
export interface ContainmentAsked {
  /** The services' floor this host boots the lane VM with; null where it keeps none. */
  readonly servicesFloor: number | null
  /** Docker's cgroup driver; null where it did not say. */
  readonly cgroupDriver: string | null
}

/**
 * What took effect of each running container's controls, from what its
 * kind asks (`wantedControls`) and what its cgroup read back this sample.
 */
export function sampleContainment(input: {
  readonly running: readonly RunningLane[]
  readonly services: readonly RunningService[]
  readonly read: Pick<MachineRead, "containers" | "servicesFloor">
  readonly asked: ContainmentAsked
}): SensedSample["containment"] {
  const readBack = new Map(input.read.containers.map(c => [c.id, c.controls]))
  const kinds = [
    ...input.running.map(r => ({ id: r.id, kind: "lane" as const })),
    ...input.services.map(s => ({ id: s.id, kind: s.service })),
  ]
  return planContainment({
    wanted: {
      containers: kinds.map(c => ({
        ...wantedControls(c.kind),
        readBack: readBack.get(c.id) ?? { processesMax: null, cpuWeight: null },
      })),
      servicesFloor: input.asked.servicesFloor,
    },
    servicesFloorReadBack: input.read.servicesFloor,
    cgroupDriver: input.asked.cgroupDriver,
  })
}

/**
 * One sample from what was read: each running lane's cgroup by its id, a
 * lane whose cgroup was not found left out of `lanes` but in `lanesRunning`,
 * each service's (`serviceReadings`), what took effect of their controls
 * (`sampleContainment`), the filesystem as found, and the machine's memory
 * the whole machine's, with its reclaim, or, given `own`, the host's own
 * cgroup's, with none.
 */
export function planSample(input: {
  readonly running: readonly RunningLane[]
  readonly services: readonly RunningService[]
  readonly read: MachineRead
  readonly asked: ContainmentAsked
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
            reclaim: read.reclaim,
            limitHits: null,
            source: "whole-machine",
          }
        : { ...ownCgroupMachine(input.own, read.memory), source: "own-cgroup" },
    lanes,
    lanesRunning: running.map(r => r.lane),
    store: read.store,
    filesystem: input.filesystem,
    services: serviceReadings(input.services, memoryById, input.own !== null),
    containment: sampleContainment(input),
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

/** The host's own cgroup's files, each null when it cannot be read. */
async function readOwnCgroup(): Promise<OwnCgroupFiles> {
  const read = (f: string) =>
    readFile(path.join(OWN_CGROUP, f), "utf8").catch(() => null)
  const [max, current, stat, pressure, events] = await Promise.all(
    [
      "memory.max",
      "memory.current",
      "memory.stat",
      "memory.pressure",
      "memory.events",
    ].map(read),
  )
  return {
    max: max ?? null,
    current: current ?? null,
    stat: stat ?? null,
    pressure: pressure ?? null,
    events: events ?? null,
  }
}

/**
 * The sensor over `reach` and `kills`; `hearStall` takes each of the host's
 * stalls. Kills are taken after the reads, so a sample whose read fails
 * leaves them for the next.
 */
export function createSensor(
  reach: Pick<
    MachineReach,
    | "runningLanes"
    | "runningServices"
    | "machineSample"
    | "storeVolume"
    | "memorySource"
    | "containmentAsked"
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
      const [running, services] = await Promise.all([
        reach.runningLanes(),
        reach.runningServices(),
      ])
      const [read, filesystem, own] = await Promise.all([
        reach.machineSample([...running, ...services].map(r => r.id)),
        readFilesystem(reach.storeVolume),
        reach.memorySource === "own-cgroup" ? readOwnCgroup() : null,
      ])
      const serviceKills = await kills.take()
      const hostStalledMs = longest
      longest = 0
      return planSample({
        running,
        services,
        read,
        asked: reach.containmentAsked,
        own,
        filesystem,
        serviceKills,
        hostStalledMs,
      })
    },
  }
}
