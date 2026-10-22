// host/machine — the machine lanes run on, watched: the manager composed
// from the runtime's reads, and the timer that asks it for a sample. The
// timer is the host's: the manager reads no clock.

import { machineWords } from "@pinetrie/interface"
import {
  createMachineManager,
  type ManagerNews,
  type StoreSettings,
} from "@pinetrie/machine"
import { readThreadName } from "@pinetrie/reads"
import type { SessionDocHandle } from "@pinetrie/schema"
import type { HostKeeper } from "../basics.ts"
import type { Records } from "../records.ts"
import type { Stall } from "../stalls.ts"
import type { MachineReach } from "../work/runtime.ts"
import { createSensor } from "./sensor.ts"
import { createHealthSink } from "./sink.ts"

/** How often the machine is sampled. */
export const MACHINE_SAMPLE_MS = 5_000

/** A manager's news as the host's log line. */
export function newsLine(news: ManagerNews, session: SessionDocHandle): string {
  switch (news.kind) {
    case "changed":
      return `[host] the machine: ${machineWords(news.health, lane => readThreadName(session, lane))}`
    case "slow":
      return `[host] the machine: a sample took ${news.ms} ms`
    case "unwritten":
      return `[host] the machine: its health was not written: ${news.error}`
  }
}

export interface MachineWatch {
  /** Takes each of the host's stalls, for the next sample. */
  hearStall(stall: Stall): void
  /** Stops the timer, then the manager, which writes `unsampled`. */
  close(): Promise<void>
}

/** The manager started, its first sample queued and not awaited, and its timer running. */
export async function startMachineWatch(deps: {
  readonly reach: MachineReach
  readonly session: SessionDocHandle
  readonly keeper: Pick<HostKeeper, "run">
  readonly records: Pick<Records, "writeValues">
  readonly settings: StoreSettings
  readonly log: (line: string) => void
}): Promise<MachineWatch> {
  const sensor = createSensor(deps.reach)
  const manager = createMachineManager({
    sensor,
    sink: createHealthSink(deps),
    settings: deps.settings,
    tell: news => deps.log(newsLine(news, deps.session)),
  })
  await manager.start()
  const timer = setInterval(() => void manager.sample(), MACHINE_SAMPLE_MS)
  timer.unref()
  return {
    hearStall: stall => sensor.hearStall(stall),
    async close() {
      clearInterval(timer)
      await manager.close()
    },
  }
}
