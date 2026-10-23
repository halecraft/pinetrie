// machine/manager — the loop that samples, plans and writes the health
// value, and the disk upkeep's steps, on a keeper of its own: its steps
// never overlap, and only the sink's write reaches the host's documents.
// It reads no clock: the host's timers ask for each sample and each
// backstop upkeep. Only its keeper changes a row's state but for the
// snapshot's own life (`SnapshotTaking`), so a restore never comes between
// a step's plan and its deletion.

import { errorText, type MachineHealth, snapshotId } from "@pinetrie/core"
import { createKeeper, KeeperClosed } from "@pinetrie/keeper"
import type { Capabilities } from "./capabilities.ts"
import {
  FIRST_MEMORY,
  type HealthMemory,
  planHealth,
  type SampleResult,
  STOPPED,
} from "./health.ts"
import type { HealthSink, MachineManager, MachineSensor } from "./ports.ts"
import type { UpkeepHeard } from "./sample.ts"
import type { SnapshotIndex } from "./snapshot-index.ts"
import type { StoreControls, StoreRecords } from "./store.ts"
import { minimumUnallocated, type StoreSettings } from "./store-settings.ts"
import { planUpkeepStep } from "./upkeep.ts"

/**
 * Whether this host keeps the machine itself, or only reads and reports it,
 * for a machine something else manages: `lanes.manage`.
 */
export const MANAGE_MODES = ["manage", "observe"] as const
export type ManageMode = (typeof MANAGE_MODES)[number]

/** What the manager has to say, for the host to word and log. */
export type ManagerNews =
  | { readonly kind: "changed"; readonly health: MachineHealth }
  /** A sample or an upkeep step, written or not, ran `ms` past the keeper's limit. */
  | { readonly kind: "slow"; readonly ms: number }
  /** The sink refused a write; the next sample tries again. */
  | { readonly kind: "unwritten"; readonly error: string }
  /** An upkeep step failed; the next trigger tries again. */
  | { readonly kind: "upkeep-failed"; readonly error: string }

export function createMachineManager(deps: {
  readonly sensor: MachineSensor
  readonly sink: HealthSink
  readonly settings: StoreSettings
  readonly mode: ManageMode
  /** What this backend can do to the store: on Linux nothing grows. */
  readonly capabilities: Capabilities
  readonly index: SnapshotIndex
  readonly store: StoreControls
  readonly records: StoreRecords
  readonly tell: (news: ManagerNews) => void
}): MachineManager {
  const { sensor, sink, settings, tell, index, store, records } = deps
  const keeper = createKeeper<"sample" | "disk-upkeep">({
    onSlow: step => tell({ kind: "slow", ms: Math.round(step.ran) }),
  })
  let memory: HealthMemory = FIRST_MEMORY
  /** Skipped snapshots heard since the last sample's read. */
  let skipped = 0
  /** The store's room and its floor, as the last sample read them. */
  let room: { readonly unallocated: number; readonly minimum: number } | null =
    null
  /** What the last upkeep step found, for the health value. */
  let upkeep: UpkeepHeard = { freeing: false, exhausted: false }
  /** Whether a dead host's reservations were settled, before this host's first plan. */
  let settled = false
  /** The roots the index's fill has read since this host started. */
  const read = new Set<string>()

  /** One write; on a refusal the memory forgets it, so the next sample writes again. */
  const writeHealth = async (health: MachineHealth, written: HealthMemory) => {
    try {
      await sink.write(health)
      memory = written
    } catch (error) {
      memory = { ...written, health: memory.health }
      tell({ kind: "unwritten", error: errorText(error) })
    }
  }

  const hasRoomLow = (h: MachineHealth) =>
    h.causes.some(c => c.kind === "room-low")

  const sampleOnce = async (): Promise<void> => {
    let result: SampleResult
    try {
      const sensed = await sensor.sample()
      result = {
        kind: "sampled",
        sample: { ...sensed, snapshotsSkipped: skipped, upkeep },
      }
      skipped = 0
      if (sensed.store !== null)
        room = {
          unallocated: sensed.store.unallocated,
          minimum: minimumUnallocated(sensed.store.size),
        }
    } catch (error) {
      result = { kind: "failed", error: errorText(error) }
    }
    const before = memory.health
    const planned = planHealth(memory, result, settings, deps.capabilities)
    if (!planned.changed) {
      memory = planned.memory
      return
    }
    await writeHealth(planned.health, planned.memory)
    tell({ kind: "changed", health: planned.health })
    if (hasRoomLow(planned.health) && !hasRoomLow(before)) queueUpkeep()
  }

  const upkeepOnce = async (): Promise<void> => {
    // gather
    const listing = await store.listing()
    if (!settled) {
      index.settleReserved(new Set(listing.snapshots.map(snapshotId)))
      settled = true
    }
    const complete = index.isComplete()
    const unread = complete
      ? []
      : (await records.roots()).filter(r => !read.has(r))
    const [live, running] = complete
      ? await Promise.all([records.liveLanes(), records.runningLanes()])
      : [new Set<never>(), new Set<string>()]
    // plan
    const step = planUpkeepStep({
      listing,
      rows: index.rows(),
      complete,
      unread,
      live,
      running,
      budget: settings.snapshotMetadata,
      room,
    })
    // execute
    if (step.kind === "fill") {
      for (const root of step.roots) {
        index.indexRecorded(await records.snapshotsOf(root))
        read.add(root)
      }
      if (step.complete) index.markComplete()
      queueUpkeep()
      return
    }
    index.markDeleted(step.vanished)
    // Planned from the rows as they are: nothing between the plan and here
    // awaits, and every other change of a row's state is a step on this
    // keeper. Only a branch's mark can land during the delete, which the
    // fork's own check of its source meets.
    const { snapshots } = step
    if (snapshots.length > 0) {
      // Marked first, so no fork picks one about to go.
      index.markDeleted(snapshots)
      await store.deleteSnapshots(snapshots)
    }
    for (const lane of step.lanes) await store.deleteLane(lane)
    for (const p of step.innerProjects)
      await store.removeInnerProject(p.lane, p.key)
    const low = room !== null && room.unallocated < room.minimum
    upkeep = {
      freeing: low && snapshots.length > 0,
      exhausted: low && snapshots.length === 0 && !step.more,
    }
    if (step.more) queueUpkeep()
  }

  /** An upkeep step queued, merged with one already queued. Observing, none runs. */
  function queueUpkeep() {
    if (deps.mode !== "manage") return
    void keeper.later("disk-upkeep", upkeepOnce).catch(error => {
      // A step a stopping host dropped is no failure.
      if (!(error instanceof KeeperClosed))
        tell({ kind: "upkeep-failed", error: errorText(error) })
    })
  }

  const sample = (): Promise<void> =>
    keeper.later("sample", sampleOnce).catch(() => {})

  return {
    async start() {
      await keeper.run(() => writeHealth(memory.health, memory))
      void sample()
    },
    sample,
    noteSnapshotSkipped() {
      skipped++
    },
    requestUpkeep: queueUpkeep,
    async markArchivedForDeletion(snapshots) {
      await keeper.run(async () => index.markToDelete(snapshots))
      queueUpkeep()
    },
    async keepRestored(lanes) {
      await keeper.run(async () => index.keepAgain(lanes))
      queueUpkeep()
    },
    idle: () => keeper.idle(),
    async close() {
      keeper.close("drop")
      await keeper.idle()
      await writeHealth(STOPPED, { ...memory, health: STOPPED })
    },
  }
}
