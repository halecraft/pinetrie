// host/machine/sensor — the machine's `MachineSensor`, composed here and
// nowhere else: the runtime's raw reads, the store's filesystem's free
// space, the services' kills heard from Docker, and the host's own stalls,
// mapped into the sample's values.

import { statfs } from "node:fs/promises"
import type { MachineService } from "@pinetrie/core"
import type { RunningLane, ServiceKillWatch } from "@pinetrie/docker"
import type { MachineRead } from "@pinetrie/lanehost"
import type { LaneSample, MachineSensor, SensedSample } from "@pinetrie/machine"
import type { Stall } from "../stalls.ts"
import type { MachineReach } from "../work/runtime.ts"

/**
 * One sample from what was read: each running lane's cgroup by its id, a
 * lane whose cgroup was not found left out, and the filesystem as found.
 */
export function planSample(input: {
  readonly running: readonly RunningLane[]
  readonly read: MachineRead
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
    machine: {
      memoryTotal: read.memory.total,
      memoryAvailable: read.memory.available,
      pressure: read.pressure,
    },
    lanes,
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
export function createSensor(
  reach: MachineReach,
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
      const [read, filesystem] = await Promise.all([
        reach.machineSample(running.map(r => r.id)),
        readFilesystem(reach.storeVolume),
      ])
      const serviceKills = await kills.take()
      const hostStalledMs = longest
      longest = 0
      return planSample({
        running,
        read,
        filesystem,
        serviceKills,
        hostStalledMs,
      })
    },
  }
}
