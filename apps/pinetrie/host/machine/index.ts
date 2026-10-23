// host/machine — the machine lanes run on, watched: the manager composed
// from the runtime's reads, the stream of Docker's events it hears the
// services' kills on, and the timer that asks it for a sample. The timer is
// the host's: the manager reads no clock.

import { machineWords } from "@pinetrie/interface"
import {
  createMachineManager,
  type MachineManager,
  type ManageMode,
  type ManagerNews,
  planCapabilities,
  type SnapshotIndex,
  type StoreRecords,
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
/** How often the disk upkeep runs with nothing to trigger it: a backstop, never what decides. */
export const DISK_UPKEEP_EVERY_MS = 15 * 60_000

/** A manager's news as the host's log line. */
export function newsLine(news: ManagerNews, session: SessionDocHandle): string {
  switch (news.kind) {
    case "changed":
      return `[host] the machine: ${machineWords(news.health, lane => readThreadName(session, lane))}`
    case "slow":
      return `[host] the machine: a sample took ${news.ms} ms`
    case "unwritten":
      return `[host] the machine: its health was not written: ${news.error}`
    case "upkeep-failed":
      return `[host] the machine: the lanes' disk upkeep failed: ${news.error}`
  }
}

export interface MachineWatch {
  /** Takes each of the host's stalls, for the next sample. */
  hearStall(stall: Stall): void
  /** A turn's snapshot skipped, its index row unwritten: counted in the next sample. */
  noteSnapshotSkipped(): void
  /** What lane work asks of the disk upkeep: a trigger, an archive's snapshots, a restore's lanes. */
  readonly upkeep: Pick<
    MachineManager,
    "requestUpkeep" | "markArchivedForDeletion" | "keepRestored"
  >
  /** Settles once no sample or upkeep step is queued or running. */
  idle(): Promise<void>
  /** Stops the timers, then the manager, which writes `unsampled`, then the events stream. */
  close(): Promise<void>
}

/** The manager started, its first sample queued and not awaited, and its timer running. */
export async function startMachineWatch(deps: {
  readonly reach: MachineReach
  readonly session: SessionDocHandle
  readonly keeper: Pick<HostKeeper, "run">
  readonly records: Pick<Records, "writeValues">
  readonly settings: StoreSettings
  readonly mode: ManageMode
  /** The store's snapshot index, whole: only the manager is given it so. */
  readonly index: SnapshotIndex
  readonly storeRecords: StoreRecords
  readonly log: (line: string) => void
}): Promise<MachineWatch> {
  const kills = deps.reach.watchServiceKills()
  const sensor = createSensor(deps.reach, kills)
  const manager = createMachineManager({
    sensor,
    sink: createHealthSink(deps),
    settings: deps.settings,
    mode: deps.mode,
    capabilities: planCapabilities(deps.reach.target),
    index: deps.index,
    store: deps.reach.store,
    records: deps.storeRecords,
    tell: news => deps.log(newsLine(news, deps.session)),
  })
  await manager.start()
  const timer = setInterval(() => void manager.sample(), MACHINE_SAMPLE_MS)
  timer.unref()
  // After the lanes are ready, and not awaited: runs resume beside it.
  manager.requestUpkeep()
  const backstop = setInterval(
    () => manager.requestUpkeep(),
    DISK_UPKEEP_EVERY_MS,
  )
  backstop.unref()
  return {
    hearStall: stall => sensor.hearStall(stall),
    noteSnapshotSkipped: () => manager.noteSnapshotSkipped(),
    upkeep: manager,
    idle: () => manager.idle(),
    async close() {
      clearInterval(timer)
      clearInterval(backstop)
      await manager.close()
      kills.close()
    },
  }
}
