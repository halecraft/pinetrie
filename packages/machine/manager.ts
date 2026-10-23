// machine/manager — the loop that samples, plans and writes the health
// value, and the disk upkeep's steps, on a keeper of its own: its steps
// never overlap, and only the sink's write reaches the host's documents.
// It reads no clock: the host's timers ask for each sample and each
// backstop upkeep. Only its keeper changes a row's state but for the
// snapshot's own life (`SnapshotTaking`), so a restore never comes between
// a step's plan and its deletion.

import {
  errorText,
  type HeldLane,
  type MachineHealth,
  type MemoryCounters,
  snapshotId,
  type ThreadId,
} from "@pinetrie/core"
import { createKeeper, KeeperClosed } from "@pinetrie/keeper"
import type { Capabilities } from "./capabilities.ts"
import {
  FIRST_HEALTH_STATE,
  type HealthPlanState,
  MEMORY_CALM,
  type MemoryShort,
  planHealth,
  type SampleResult,
  STOPPED,
} from "./health.ts"
import {
  counterRise,
  type DecisionMeasured,
  type LaneMeasured,
  lanesChanged,
  lanesMeasured,
  treatmentChanges,
} from "./measurements.ts"
import type {
  HealthSink,
  HostLaneFacts,
  MachineManager,
  MachineMeasurements,
  MachineSensor,
  RepairControls,
} from "./ports.ts"
import {
  isRepairCalledFor,
  isRepairRunning,
  NO_REPAIR,
  nextRepairState,
  type RepairFacts,
  type RepairRead,
  type RepairState,
  repairCause,
  repairFacts,
  repairStateNow,
} from "./repair.ts"
import { runRepairSteps } from "./repair-steps.ts"
import { FIRST_RUNG_STATE, planRung, type RungPlanState } from "./rung.ts"
import type { MachineSample, UpkeepHeard } from "./sample.ts"
import type { SnapshotIndex } from "./snapshot-index.ts"
import type { StoreControls, StoreRecords } from "./store.ts"
import { minimumUnallocated, type StoreSettings } from "./store-settings.ts"
import { plannedStoreSize } from "./store-size.ts"
import {
  ALL_NORMAL,
  FIRST_TREATMENT_STATE,
  heldForRepair,
  isActivityAllowed,
  isRankingNeeded,
  type LaneActivity,
  planTreatments,
  type TreatmentPlanState,
  type Treatments,
} from "./treatments.ts"
import { planUpkeepStep } from "./upkeep.ts"

/** Samples between the measurements' trims: an hour at the host's 5 s. */
export const TRIM_MEASUREMENTS_EVERY_SAMPLES = 720

/** A `waitUntilAllowed` not yet settled. */
interface Waiter {
  readonly lane: ThreadId
  readonly activity: LaneActivity
  readonly allow: () => void
  readonly refuse: (reason: unknown) => void
}

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
  /** The measurements could not be written; the next sample writes its own. */
  | { readonly kind: "unmeasured"; readonly error: string }
  /** The lane VM's repair moved, this host's own. */
  | {
      readonly kind: "repair"
      readonly from: RepairState
      readonly to: RepairState
    }
  /** A repair asked for did not run: another holds the lock, or it could not be taken. */
  | { readonly kind: "repair-not-run"; readonly why: string }

export function createMachineManager<Held, LauncherHeld>(deps: {
  readonly sensor: MachineSensor
  readonly sink: HealthSink
  readonly settings: StoreSettings
  readonly mode: ManageMode
  /** What this backend can do to the store: on Linux nothing grows. */
  readonly capabilities: Capabilities
  readonly index: SnapshotIndex
  readonly store: StoreControls
  readonly records: StoreRecords
  readonly laneFacts: HostLaneFacts
  readonly measurements: MachineMeasurements
  /** The lane VM's shared repair state, read each sample; null where nothing is repaired. */
  readonly readRepair: (() => Promise<RepairRead>) | null
  /** Made only where the disk can be repaired and this host manages: null, no path stops a VM. */
  readonly repair: RepairControls<Held, LauncherHeld> | null
  readonly tell: (news: ManagerNews) => void
}): MachineManager {
  const { sensor, sink, settings, tell, index, store, records } = deps
  const keeper = createKeeper<"sample" | "disk-upkeep">({
    onSlow: step => tell({ kind: "slow", ms: Math.round(step.ran) }),
  })
  let memory: HealthPlanState = FIRST_HEALTH_STATE
  let rungState: RungPlanState = FIRST_RUNG_STATE
  let treatmentState: TreatmentPlanState = FIRST_TREATMENT_STATE
  /** The last plan's: what every `waitUntilAllowed` reads. */
  let treatments: Treatments = ALL_NORMAL
  /** Memory's rung and holds as last planned, kept through a failed sample. */
  let memoryShort: MemoryShort = MEMORY_CALM
  /** Memory's own treatments, as last planned: what applies when no repair runs. */
  let memoryTreatments: Treatments = ALL_NORMAL
  /** The lanes the last sample read running, held while a repair runs though a sample fails. */
  let lanesSeen: readonly ThreadId[] = []
  /** The lanes held as last applied, memory's or a repair's: what the measurements' changes are from. */
  let heldBefore: readonly HeldLane[] = []
  /**
   * This host's own repair, from the sample that asked to its end: a
   * sample before it has written `detected` must not ask again.
   */
  let repairInFlight: Promise<void> | null = null
  /** Memory as the last sample read it: what a decision's row is measured at. */
  let lastMemory: {
    readonly fullAvg10: number | null
    readonly memoryAvailable: number
  } = {
    fullAvg10: null,
    memoryAvailable: 0,
  }
  const waiters = new Set<Waiter>()
  let closed = false
  /** The last counters a sample read, and each lane as last kept: what the measurements store differences from. */
  let counters: MemoryCounters | null = null
  let lanesKept = new Map<ThreadId, LaneMeasured>()
  /** Samples since the measurements were last trimmed. */
  let untrimmed = 0
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
  const writeHealth = async (
    health: MachineHealth,
    written: HealthPlanState,
  ) => {
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

  /** Every waiter its lane's treatment now allows, settled. */
  const settleAllowed = () => {
    for (const w of waiters)
      if (isActivityAllowed(treatments.laneTreatment(w.lane), w.activity))
        w.allow()
  }

  /** A measurements write; one that fails is told, and the sample goes on. */
  const record = (write: () => void) => {
    try {
      write()
    } catch (error) {
      tell({ kind: "unmeasured", error: errorText(error) })
    }
  }

  /**
   * Memory's rung and each lane's treatment from one sample, and what the
   * measurements keep of it. Observing, the treatments are planned only for
   * their shadow decisions: every lane is `normal`.
   */
  const planMemory = async (sample: MachineSample): Promise<void> => {
    const planned = planRung(rungState, sample.machine)
    rungState = planned.state
    const { rung } = planned
    const isHolding = deps.mode === "manage"
    // gather
    const lanesWaitingToStart = [...waiters]
      .filter(w => w.activity === "container-start")
      .map(w => w.lane)
    const lanesByImportance = isRankingNeeded(treatmentState, rung)
      ? await deps.laneFacts.lanesByImportance([
          ...new Set([...sample.lanesRunning, ...lanesWaitingToStart]),
        ])
      : []
    const memoryByLane = new Map(sample.lanes.map(l => [l.lane, l]))
    // plan
    const next = planTreatments(treatmentState, {
      rung,
      lanesRunning: sample.lanesRunning.map(lane => ({
        lane,
        memory: memoryByLane.get(lane) ?? null,
        programInFlight: deps.laneFacts.programInFlight(lane),
      })),
      lanesWaitingToStart,
      lanesByImportance,
    })
    const held = isHolding ? next.treatments.held : []
    const at = {
      fullAvg10: sample.machine.pressure?.fullAvg10 ?? null,
      memoryAvailable: sample.machine.memoryAvailable,
    }
    const lanesNow = lanesMeasured(sample.lanes, deps.laneFacts.programInFlight)
    const measured = {
      sample: {
        rung,
        someAvg10: sample.machine.pressure?.someAvg10 ?? null,
        fullAvg10: at.fullAvg10,
        memoryTotal: sample.machine.memoryTotal,
        memoryAvailable: sample.machine.memoryAvailable,
        source: sample.machine.source,
        since: counterRise(counters, sample.machine.counters),
        lanesRunning: sample.lanesRunning.length,
        mode: deps.mode,
      },
      lanes: lanesChanged(lanesKept, lanesNow),
      decisions: [
        ...next.shadowDecisions.map(
          (decision): DecisionMeasured => ({
            kind: "shadow",
            decision,
            ...at,
          }),
        ),
      ],
      trim: untrimmed + 1 >= TRIM_MEASUREMENTS_EVERY_SAMPLES,
    }
    // execute
    treatmentState = next.state
    memoryTreatments = isHolding ? next.treatments : ALL_NORMAL
    memoryShort = { rung, isHolding, held }
    lanesSeen = sample.lanesRunning
    lastMemory = at
    counters = sample.machine.counters
    lanesKept = new Map(lanesNow.map(l => [l.lane, l]))
    untrimmed = measured.trim ? 0 : untrimmed + 1
    record(() => {
      deps.measurements.recordSample(measured.sample)
      deps.measurements.recordLaneSamples(measured.lanes)
      deps.measurements.recordDecisions(measured.decisions)
      if (measured.trim) deps.measurements.trim()
    })
  }

  /** The shared repair state, as every host reads it, and its text; on a failed read, none. */
  const readRepairFacts = async (): Promise<{
    readonly facts: RepairFacts
    readonly text: string | null
  }> => {
    if (deps.readRepair === null) return { facts: NO_REPAIR, text: null }
    try {
      const read = await deps.readRepair()
      return { facts: repairFacts(read), text: read.text }
    } catch {
      return { facts: NO_REPAIR, text: null }
    }
  }

  /**
   * The treatments every waiter reads: while any host repairs, every lane
   * waits, though this sample failed (its VM stopped); else memory's. The
   * lanes held changing are measured.
   */
  const applyTreatments = (facts: RepairFacts) => {
    const repairing = deps.mode === "manage" && isRepairRunning(facts)
    const waitingToStart = [...waiters].map(w => w.lane)
    treatments = repairing
      ? heldForRepair([...new Set([...lanesSeen, ...waitingToStart])])
      : memoryTreatments
    settleAllowed()
    const changes = treatmentChanges(heldBefore, treatments.held)
    heldBefore = treatments.held
    if (changes.length === 0) return
    record(() =>
      deps.measurements.recordDecisions(
        changes.map(c => ({ kind: "treatment", ...c, ...lastMemory })),
      ),
    )
  }

  /**
   * A repair started, beside the loop, when this fresh sample calls for
   * one and the shared state allows it: never awaited in a sample, so the
   * samples go on and hold this host's lanes while it runs.
   */
  const askRepair = (
    sampled: MachineSample,
    facts: RepairFacts,
    seen: string | null,
  ): Promise<void> | undefined => {
    const controls = deps.repair
    if (controls === null || deps.mode !== "manage") return
    if (repairInFlight !== null || isRepairRunning(facts)) return
    if (!isRepairCalledFor(sampled)) return
    const plannedSize =
      plannedStoreSize(sampled, settings, deps.capabilities) ??
      sampled.store?.size ??
      0
    const state = repairStateNow(facts)
    const trigger = "room-spent-and-nothing-to-delete"
    const asked = nextRepairState(state, {
      kind: "trigger",
      trigger,
      plannedSize,
    })
    if (asked.kind !== "detected") return
    repairInFlight = runRepairSteps(
      controls,
      { trigger, plannedSize, seen },
      (from, to) => {
        tell({ kind: "repair", from, to })
        record(() =>
          deps.measurements.recordDecisions([
            { kind: "repair", from: from.kind, to: to.kind, ...lastMemory },
          ]),
        )
      },
    )
      .then(run => {
        if (run.kind === "held-by-another")
          tell({ kind: "repair-not-run", why: "another holds the repair lock" })
        if (run.kind === "lock-failed")
          tell({ kind: "repair-not-run", why: run.detail })
      })
      .catch(error => tell({ kind: "repair-not-run", why: errorText(error) }))
      .finally(() => {
        repairInFlight = null
        // What the repair left is read afresh: the upkeep's last word
        // was of the disk before it.
        upkeep = { freeing: false, exhausted: false }
        void sample()
      })
    return repairInFlight
  }

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
    if (result.kind === "sampled") await planMemory(result.sample)
    const { facts, text } = await readRepairFacts()
    applyTreatments(facts)
    // Never awaited: the samples go on while it runs.
    if (result.kind === "sampled") void askRepair(result.sample, facts, text)
    const before = memory.health
    const planned = planHealth(memory, result, settings, deps.capabilities, {
      memory: { ...memoryShort, held: treatments.held },
      repair: repairCause(facts),
    })
    if (!planned.changed) {
      memory = planned.state
      return
    }
    await writeHealth(planned.health, planned.state)
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

  function sample(): Promise<void> {
    return keeper.later("sample", sampleOnce).catch(() => {})
  }

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
    waitUntilAllowed(lane, activity, signal) {
      if (deps.mode !== "manage") return Promise.resolve()
      if (closed) return Promise.reject(new KeeperClosed())
      if (signal?.aborted) return Promise.reject(signal.reason)
      if (isActivityAllowed(treatments.laneTreatment(lane), activity))
        return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const onAbort = () => waiter.refuse(signal?.reason)
        const waiter: Waiter = {
          lane,
          activity,
          allow: () => {
            waiters.delete(waiter)
            signal?.removeEventListener("abort", onAbort)
            resolve()
          },
          refuse: reason => {
            waiters.delete(waiter)
            signal?.removeEventListener("abort", onAbort)
            reject(reason)
          },
        }
        waiters.add(waiter)
        signal?.addEventListener("abort", onAbort, { once: true })
      })
    },
    idle: () => keeper.idle(),
    async close() {
      closed = true
      for (const w of waiters) w.refuse(new KeeperClosed())
      keeper.close("drop")
      await keeper.idle()
      // A repair is never left half done by its host's close: its boot
      // holds the disk while its locks are this host's.
      await repairInFlight
      await writeHealth(STOPPED, { ...memory, health: STOPPED })
    },
  }
}
