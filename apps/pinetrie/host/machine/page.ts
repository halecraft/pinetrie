// host/machine/page — the machine's facts the Health page is served (`GET
// /machine`): the manager's latest reading against the bounds pine·trie
// acts at, its last hour, what happened in the last day, each lane's
// snapshots and thread, and the actions this host can take, planned from
// what was gathered. It takes no sample: the page shows the last.

import os from "node:os"
import type {
  MachineAction,
  MachineFacts,
  MachineHistory,
  MachineKind,
  MachineLane,
  MachineLately,
  MemorySource,
  ThreadId,
  ThreadName,
} from "@pinetrie/core"
import {
  filesystemBound,
  type MachineReading,
  memoryBounds,
  PRESSURE_BOUNDS,
  type ReadingPlanned,
  type SnapshotReads,
  type StoreSettings,
  type StoreTarget,
  snapshotsByLane,
  storeBounds,
  WAITING,
} from "@pinetrie/machine"
import { readNames } from "@pinetrie/reads"
import type { SessionDocHandle } from "@pinetrie/schema"
import { vmMemoryCeiling } from "@pinetrie/vm"
import { type HostMeasurements, RECENT_EVENTS_SHOWN } from "./measurements.ts"

const DAY_MS = 24 * 60 * 60 * 1000

/** What the machine's facts are planned from, gathered. */
export interface MachineGathered {
  readonly reading: MachineReading | null
  readonly history: MachineHistory
  readonly lately: readonly MachineLately[]
  readonly latelyCapped: boolean
  readonly snapshots: ReadonlyMap<
    ThreadId,
    { readonly count: number; readonly bytes: number }
  >
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  readonly settings: Pick<StoreSettings, "max" | "leaveFree">
  readonly target: StoreTarget
  readonly memorySource: MemorySource
  /** The lane VM's memory ceiling; null where lanes run on no VM. */
  readonly vmMemoryCeilingBytes: number | null
  /** The services' floor this host asks for; null where it keeps none. */
  readonly servicesFloorBytes: number | null
  readonly isOomdManagingLanes: boolean
  /** Whether this host holds the lane VM's repair's controls. */
  readonly repairs: boolean
}

const unreadable = (why: string) => ({ kind: "unreadable", why }) as const

/**
 * The actions this host can take: archive always; repair again only where
 * it holds the repair's controls and the last repair failed.
 */
export function machineActions(
  reading: ReadingPlanned | null,
  repairs: boolean,
): readonly MachineAction[] {
  const state = reading?.repair.state
  return [
    { kind: "archive" },
    ...(repairs &&
    state !== undefined &&
    state !== "interrupted" &&
    state.kind === "failed"
      ? [{ kind: "repair-again", why: state.why } as const]
      : []),
  ]
}

/**
 * What the page shows of `reading`: an overdue one's last numbers, under
 * its health, holding nothing.
 */
const shownReading = (reading: MachineReading | null): ReadingPlanned | null =>
  reading === null || reading.kind === "fresh"
    ? reading
    : reading.last === null
      ? null
      : { ...reading.last, health: reading.health, held: [] }

/** The lanes one of Lately names, which the page needs the names of. */
function latelyLanes(l: MachineLately): readonly ThreadId[] {
  if (l.kind === "treatment") return [l.lane]
  if (l.kind !== "event") return []
  const { event } = l
  if (event.kind === "lane-oom-killed") return [event.lane]
  if (event.kind === "cgroup-at-limit" && event.subject.kind === "lane")
    return [event.subject.lane]
  return []
}

/** What the machine is, from where its lanes run and whose memory is read. */
export const machineKind = (
  target: StoreTarget,
  source: MemorySource,
): MachineKind =>
  source === "own-cgroup"
    ? "own-cgroup"
    : target === "lane-vm"
      ? "lane-vm"
      : "linux-host"

/** The served hour, each minute holding only the lanes running now. */
const runningHistory = (
  history: MachineHistory,
  running: ReadonlySet<ThreadId>,
): MachineHistory => ({
  minutes: history.minutes.map(m =>
    m === null
      ? null
      : {
          ...m,
          laneBytes: Object.fromEntries(
            Object.entries(m.laneBytes).filter(([lane]) =>
              running.has(lane as ThreadId),
            ),
          ),
        },
  ),
})

export function planMachineFacts(g: MachineGathered): MachineFacts {
  const reading = shownReading(g.reading)
  const mentioned = new Set(g.lately.flatMap(latelyLanes))
  const common = {
    machineKind: machineKind(g.target, g.memorySource),
    vmMemoryCeilingBytes: g.vmMemoryCeilingBytes,
    servicesFloorBytes: g.servicesFloorBytes,
    isOomdManagingLanes: g.isOomdManagingLanes,
    lately: g.lately,
    latelyCapped: g.latelyCapped,
    names: [...mentioned].flatMap(lane => {
      const name = g.names.get(lane)
      return name === undefined ? [] : [{ lane, name }]
    }),
    actions: machineActions(reading, g.repairs),
  }
  if (reading === null)
    return {
      health: g.reading?.health ?? WAITING,
      reading: { kind: "unsampled" },
      ...common,
    }
  const { sample } = reading
  const memoryByLane = new Map(sample.lanes.map(l => [l.lane, l]))
  const treatmentByLane = new Map(
    reading.held.map(h => [h.lane, h.treatment.kind]),
  )
  const lanes = sample.lanesRunning.map((lane): MachineLane => {
    const memory = memoryByLane.get(lane)
    return {
      lane,
      name: g.names.get(lane) ?? null,
      treatment: treatmentByLane.get(lane) ?? "normal",
      memory:
        memory === undefined
          ? unreadable("its cgroup could not be read")
          : {
              kind: "read",
              currentBytes: memory.current,
              limitBytes: memory.limit,
              anonBytes: memory.anon,
              fileBytes: memory.file,
            },
      snapshots: g.snapshots.get(lane) ?? { count: 0, bytes: 0 },
    }
  })
  const { store, filesystem } = sample
  const { scope } = reading
  return {
    health: reading.health,
    reading: {
      kind: "sampled",
      memory: {
        totalBytes: sample.machine.memoryTotal,
        availableBytes: sample.machine.memoryAvailable,
        rung: reading.rung,
        bounds: memoryBounds(sample.machine.memoryTotal),
        pressure:
          scope.kind === "unmeasured"
            ? unreadable("the kernel keeps no pressure stall information")
            : {
                kind: "read",
                ...scope.pressure,
                scope: scope.kind,
                bounds: PRESSURE_BOUNDS,
              },
      },
      store:
        store === null
          ? unreadable("its btrfs counters could not be read")
          : {
              kind: "read",
              sizeBytes: store.size,
              unallocatedBytes: store.unallocated,
              maxBytes: g.settings.max,
              bounds: storeBounds(store.size),
            },
      filesystem:
        filesystem === null
          ? unreadable("its free space could not be read")
          : {
              kind: "read",
              sizeBytes: filesystem.size,
              freeBytes: filesystem.free,
              bounds: [filesystemBound(g.settings, filesystem.size)],
            },
      lanes,
      services: sample.services,
      containment: sample.containment,
      history: runningHistory(g.history, new Set(sample.lanesRunning)),
    },
    ...common,
  }
}

/** The machine's facts now, gathered from what the host holds: no sample is taken, nothing awaited. */
export function machineFacts(deps: {
  readonly reading: () => MachineReading | null
  readonly repairs: boolean
  readonly measurements: Pick<HostMeasurements, "recentRows" | "lastHour">
  readonly snapshots: SnapshotReads
  readonly session: SessionDocHandle
  readonly settings: Pick<StoreSettings, "max" | "leaveFree">
  readonly target: StoreTarget
  readonly memorySource: MemorySource
  readonly servicesFloorBytes: number | null
  readonly isOomdManagingLanes: boolean
  readonly now: () => number
}): MachineFacts {
  const lately = deps.measurements.recentRows({
    since: deps.now() - DAY_MS,
    cap: RECENT_EVENTS_SHOWN,
  })
  return planMachineFacts({
    reading: deps.reading(),
    history: deps.measurements.lastHour(),
    lately: lately.rows,
    latelyCapped: lately.isCapped,
    snapshots: snapshotsByLane(deps.snapshots.rows()),
    names: readNames(deps.session),
    settings: deps.settings,
    target: deps.target,
    memorySource: deps.memorySource,
    vmMemoryCeilingBytes:
      deps.target === "lane-vm" ? vmMemoryCeiling(os.totalmem()) : null,
    servicesFloorBytes: deps.servicesFloorBytes,
    isOomdManagingLanes: deps.isOomdManagingLanes,
    repairs: deps.repairs,
  })
}
