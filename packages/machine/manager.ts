// machine/manager — the loop that samples, plans and writes the health
// value, and the disk upkeep's steps, on a keeper of its own: its steps
// never overlap, and only the sink's write reaches the host's documents,
// queued and never awaited. It reads no clock: the host's timers ask for
// each sample, count each tick and ask each backstop upkeep. Only its keeper changes a row's state but for the
// snapshot's own life (`SnapshotTaking`), so a restore never comes between
// a step's plan and its deletion.

import {
  errorText,
  type HeldLane,
  type MachineHealth,
  type MemoryCounters,
  type SnapshotId,
  snapshotId,
  type ThreadId,
} from "@pinetrie/core"
import { createKeeper, KeeperClosed } from "@pinetrie/keeper"
import type { StoreCapabilities } from "./capabilities.ts"
import {
  FIRST_FRESHNESS,
  type FreshnessState,
  isOverdue,
  nextTickFreshness,
  READING_OVERDUE_AFTER_TICKS,
  sampleEndFreshness,
} from "./freshness.ts"
import {
  FIRST_HEALTH_STATE,
  type HealthPlanState,
  MEMORY_CALM,
  type MemoryShort,
  planHealth,
  planOverdueHealth,
  type SampleResult,
  STOPPED,
} from "./health.ts"
import {
  causeEvents,
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
import { type RepairRequest, runRepairSteps } from "./repair-steps.ts"
import {
  FIRST_RUNG_STATE,
  planRung,
  type Rung,
  type RungPlanState,
} from "./rung.ts"
import type {
  MachineReading,
  MachineSample,
  ReadingPlanned,
  UpkeepHeard,
} from "./sample.ts"
import { type SnapshotIndex, snapshotCost } from "./snapshot-index.ts"
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
  /**
   * A sample that started before the reading went overdue ended, `ticks`
   * after it started: nothing it read is planned or measured.
   */
  | { readonly kind: "stale-sample"; readonly ticks: number }
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
  /** The health's sink, made with what the manager is told of a write it refused. */
  readonly makeSink: (onUnwritten: (error: string) => void) => HealthSink
  /** `READING_OVERDUE_AFTER_TICKS` unless given: a suite's ticks may be shorter. */
  readonly readingOverdueAfterTicks?: number
  readonly settings: StoreSettings
  readonly mode: ManageMode
  /** What this backend can do to the store: on Linux nothing grows. */
  readonly capabilities: StoreCapabilities
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
  const { sensor, settings, tell, index, store, records } = deps
  const overdueAfter =
    deps.readingOverdueAfterTicks ?? READING_OVERDUE_AFTER_TICKS
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
  /** A person asked for the failed repair to run again: taken by the next sample's repair step. */
  let retryAsked = false
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
  /** The last sample that read, and what was planned since. */
  let lastRead: ReadingPlanned | null = null
  /** What `latestReading` answers. */
  let reading: MachineReading | null = null
  /** The repair as the last fresh sample read it: what an overdue health says of it. */
  let lastRepair: RepairFacts = NO_REPAIR
  let freshness: FreshnessState = FIRST_FRESHNESS
  /** A write was refused since the last: the next sample writes though nothing changed. */
  let unwritten = false
  /** The upkeep step running, if any: `close` waits for it, never for a sample. */
  let upkeepRunning: Promise<void> | null = null

  const sink = deps.makeSink(error => {
    unwritten = true
    tell({ kind: "unwritten", error })
  })

  /**
   * Queued, never awaited: the sink writes in a step of the host's
   * documents, which may wait on this manager's gate. `memory` takes the
   * value at once; a refusal, told later, makes the next sample write again.
   */
  const writeHealth = (health: MachineHealth, written: HealthPlanState) => {
    memory = written
    unwritten = false
    sink.write(health)
  }

  const isLaneActivityAllowed = (
    lane: ThreadId,
    activity: LaneActivity,
  ): boolean =>
    deps.mode !== "manage" ||
    isOverdue(freshness) ||
    isActivityAllowed(treatments.laneTreatment(lane), activity)

  const hasRoomLow = (h: MachineHealth) =>
    h.causes.some(c => c.kind === "room-low")

  /** Every waiter its lane's treatment now allows, settled. */
  const settleAllowed = () => {
    for (const w of waiters)
      if (isLaneActivityAllowed(w.lane, w.activity)) w.allow()
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
   * What memory's plan needs gathered before it: the rung this sample
   * reads, and, when the lanes' order can decide anything at it, their
   * order. Nothing is changed: a sample judged stale plans nothing.
   */
  const gatherMemory = async (sample: MachineSample) => {
    const planned = planRung(rungState, sample.machine)
    const lanesWaitingToStart = [...waiters]
      .filter(w => w.activity === "container-start")
      .map(w => w.lane)
    const lanesByImportance = isRankingNeeded(treatmentState, planned.rung)
      ? await deps.laneFacts.lanesByImportance([
          ...new Set([...sample.lanesRunning, ...lanesWaitingToStart]),
        ])
      : []
    return { planned, lanesWaitingToStart, lanesByImportance }
  }

  /**
   * Memory's rung and each lane's treatment from one sample, and what the
   * measurements keep of it. Observing, the treatments are planned only for
   * their shadow decisions: every lane is `normal`.
   */
  const planMemory = (
    sample: MachineSample,
    gathered: {
      readonly planned: {
        readonly rung: Rung
        readonly state: RungPlanState
      }
      readonly lanesWaitingToStart: readonly ThreadId[]
      readonly lanesByImportance: readonly ThreadId[]
    },
  ): void => {
    const { planned, lanesWaitingToStart, lanesByImportance } = gathered
    rungState = planned.state
    const { rung } = planned
    const isHolding = deps.mode === "manage"
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
   * A repair started, beside the loop, when a person asked for a failed
   * one again, or this fresh sample calls for one, and the shared state
   * allows it: never awaited in a sample, so the samples go on and hold
   * this host's lanes while it runs. A retry is asked of the reducer,
   * which takes it only from `failed`, and a sample that failed still
   * takes it: a disk full enough to need it may fail the sample too.
   */
  const askRepair = (
    sampled: MachineSample | null,
    facts: RepairFacts,
    seen: string | null,
  ): Promise<void> | undefined => {
    const retry = retryAsked
    retryAsked = false
    const controls = deps.repair
    if (controls === null || deps.mode !== "manage") return
    if (repairInFlight !== null || isRepairRunning(facts)) return
    const asked: RepairRequest["asked"] | null = retry
      ? { kind: "retry-asked" }
      : sampled !== null && isRepairCalledFor(sampled)
        ? {
            kind: "trigger",
            trigger: "room-spent-and-nothing-to-delete",
            plannedSize:
              plannedStoreSize(sampled, settings, deps.capabilities) ??
              sampled.store?.size ??
              0,
          }
        : null
    if (asked === null) return
    if (nextRepairState(repairStateNow(facts), asked).kind !== "detected")
      return
    if (retry)
      record(() =>
        deps.measurements.recordEvents([{ kind: "repair-asked-again" }]),
      )
    repairInFlight = runRepairSteps(controls, { asked, seen }, (from, to) => {
      tell({ kind: "repair", from, to })
      record(() =>
        deps.measurements.recordDecisions([
          { kind: "repair", from: from.kind, to: to.kind, ...lastMemory },
        ]),
      )
    })
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

  /**
   * One sample: gather, then judge, then plan. Every await comes first, so
   * a sample that started before the reading went overdue, or ends after
   * `close`, changes nothing it read.
   */
  const sampleOnce = async (): Promise<void> => {
    const startedAt = freshness.ticks
    // gather
    let result: SampleResult
    try {
      const sensed = await sensor.sample()
      result = {
        kind: "sampled",
        sample: { ...sensed, snapshotsSkipped: skipped, upkeep },
      }
    } catch (error) {
      result = { kind: "failed", error: errorText(error) }
    }
    const gathered =
      result.kind === "sampled" ? await gatherMemory(result.sample) : null
    const { facts, text } = await readRepairFacts()
    // judge
    if (closed) return
    const judged = sampleEndFreshness(freshness, startedAt)
    if (!judged.isFresh) {
      tell({ kind: "stale-sample", ticks: freshness.ticks - startedAt })
      return
    }
    freshness = judged.state
    // plan
    if (result.kind === "sampled") {
      skipped -= result.sample.snapshotsSkipped
      const { store } = result.sample
      if (store !== null)
        room = {
          unallocated: store.unallocated,
          minimum: minimumUnallocated(store.size),
        }
    }
    if (result.kind === "sampled" && gathered !== null)
      planMemory(result.sample, gathered)
    lastRepair = facts
    applyTreatments(facts)
    // Never awaited: the samples go on while it runs.
    void askRepair(
      result.kind === "sampled" ? result.sample : null,
      facts,
      text,
    )
    const before = memory.health
    const planned = planHealth(memory, result, settings, deps.capabilities, {
      memory: { ...memoryShort, held: treatments.held },
      repair: repairCause(facts),
    })
    const events = causeEvents(planned.seen)
    if (events.length > 0) record(() => deps.measurements.recordEvents(events))
    const sampled = result.kind === "sampled" ? result.sample : lastRead?.sample
    if (sampled !== undefined) {
      lastRead = {
        sample: sampled,
        health: planned.health,
        rung: memoryShort.rung,
        held: treatments.held,
        repair: facts,
      }
      reading = { kind: "fresh", ...lastRead }
    } else reading = null
    if (!planned.changed && !unwritten) {
      memory = planned.state
      return
    }
    writeHealth(planned.health, planned.state)
    if (!planned.changed) return
    tell({ kind: "changed", health: planned.health })
    if (hasRoomLow(planned.health) && !hasRoomLow(before)) queueUpkeep()
  }

  /**
   * The reading went overdue: every waiter let go, and the health written
   * as the last planned causes with `unsampled` (`overdue`), memory short
   * holding nothing. Outside the keeper, which a sample that never ends
   * holds; synchronous, so it never falls inside a sample's plan.
   */
  const goOverdue = () => {
    for (const w of waiters) w.allow()
    const planned = planOverdueHealth(memory, {
      memory: { ...memoryShort, isHolding: false, held: [] },
      repair: repairCause(lastRepair),
    })
    reading = { kind: "overdue", health: planned.health, last: lastRead }
    if (!planned.changed && !unwritten) return
    writeHealth(planned.health, planned.state)
    if (planned.changed) tell({ kind: "changed", health: planned.health })
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
      const going = new Set<SnapshotId>(snapshots)
      const bytes = index
        .rows()
        .filter(r => going.has(r.snapshot))
        .reduce((n, r) => n + snapshotCost(r), 0)
      // Marked first, so no fork picks one about to go.
      index.markDeleted(snapshots)
      await store.deleteSnapshots(snapshots)
      record(() =>
        deps.measurements.recordEvents([
          { kind: "snapshots-deleted", count: snapshots.length, bytes },
        ]),
      )
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
    const step = async () => {
      const running = upkeepOnce()
      upkeepRunning = running.catch(() => {})
      try {
        await running
      } finally {
        upkeepRunning = null
      }
    }
    void keeper.later("disk-upkeep", step).catch(error => {
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
      writeHealth(memory.health, memory)
      void sample()
    },
    sample,
    sampleTick() {
      if (closed) return
      const wasOverdue = isOverdue(freshness)
      freshness = nextTickFreshness(freshness, overdueAfter)
      if (!wasOverdue && isOverdue(freshness)) goOverdue()
      void sample()
    },
    latestReading: () => reading,
    isLaneActivityAllowed,
    askRepairAgain() {
      retryAsked = true
      void sample()
    },
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
      if (closed) return Promise.reject(new KeeperClosed())
      if (signal?.aborted) return Promise.reject(signal.reason)
      if (isLaneActivityAllowed(lane, activity)) return Promise.resolve()
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
      // A sample may never end, so only the upkeep's store calls are
      // waited out.
      await upkeepRunning
      // A repair is never left half done by its host's close: its boot
      // holds the disk while its locks are this host's.
      await repairInFlight
      writeHealth(STOPPED, { ...memory, health: STOPPED })
      await sink.writesFlushed()
    },
  }
}
