// host/machine/page — what the Machine page is served (`GET /machine`): the
// manager's latest reading, what happened lately, each lane's snapshots and
// thread, and the actions this host can take, planned from what was
// gathered. It takes no sample: the page shows the last.

import os from "node:os"
import type {
  MachineAction,
  MachineLately,
  MachinePageFacts,
  MachinePageLane,
  ThreadId,
  ThreadName,
} from "@pinetrie/core"
import {
  leaveFreeBytes,
  type MachineReading,
  minimumUnallocated,
  type ReadingPlanned,
  type SnapshotReads,
  type StoreSettings,
  type StoreTarget,
  snapshotsByLane,
  WAITING,
} from "@pinetrie/machine"
import { readNames } from "@pinetrie/reads"
import type { SessionDocHandle } from "@pinetrie/schema"
import { vmMemoryCeiling } from "@pinetrie/vm"
import { type HostMeasurements, RECENT_EVENTS_SHOWN } from "./measurements.ts"

/** What the page's facts are planned from, gathered. */
export interface MachinePageGathered {
  readonly reading: MachineReading | null
  readonly lately: readonly MachineLately[]
  readonly snapshots: ReadonlyMap<
    ThreadId,
    { readonly count: number; readonly bytes: number }
  >
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  readonly settings: Pick<StoreSettings, "max" | "leaveFree">
  /** The lane VM's memory ceiling; null where lanes run on no VM. */
  readonly vmMemoryCeilingBytes: number | null
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

export function planMachinePage(g: MachinePageGathered): MachinePageFacts {
  const reading = shownReading(g.reading)
  const mentioned = new Set(
    g.lately.flatMap(l =>
      l.kind === "treatment"
        ? [l.lane]
        : l.kind === "event" && l.event.kind === "lane-oom-killed"
          ? [l.event.lane]
          : [],
    ),
  )
  const common = {
    vmMemoryCeilingBytes: g.vmMemoryCeilingBytes,
    lately: g.lately,
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
  const lanes = sample.lanesRunning.map((lane): MachinePageLane => {
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
  const pressure = sample.machine.pressure
  return {
    health: reading.health,
    reading: {
      kind: "sampled",
      memory: {
        totalBytes: sample.machine.memoryTotal,
        availableBytes: sample.machine.memoryAvailable,
        source: sample.machine.source,
        pressure:
          pressure === null
            ? unreadable("the kernel keeps no pressure stall information")
            : { kind: "read", ...pressure },
        rung: reading.rung,
      },
      store:
        store === null
          ? unreadable("its btrfs counters could not be read")
          : {
              kind: "read",
              sizeBytes: store.size,
              unallocatedBytes: store.unallocated,
              minimumBytes: minimumUnallocated(store.size),
              maxBytes: g.settings.max,
            },
      filesystem:
        filesystem === null
          ? unreadable("its free space could not be read")
          : {
              kind: "read",
              sizeBytes: filesystem.size,
              freeBytes: filesystem.free,
              leaveFreeBytes: leaveFreeBytes(g.settings, filesystem.size),
            },
      lanes,
      services: sample.services,
    },
    ...common,
  }
}

/** The page's facts now, gathered from what the host holds: no sample is taken, nothing awaited. */
export function machinePageFacts(deps: {
  readonly reading: () => MachineReading | null
  readonly repairs: boolean
  readonly measurements: Pick<HostMeasurements, "recentRows">
  readonly snapshots: SnapshotReads
  readonly session: SessionDocHandle
  readonly settings: Pick<StoreSettings, "max" | "leaveFree">
  readonly target: StoreTarget
}): MachinePageFacts {
  return planMachinePage({
    reading: deps.reading(),
    lately: deps.measurements.recentRows(RECENT_EVENTS_SHOWN),
    snapshots: snapshotsByLane(deps.snapshots.rows()),
    names: readNames(deps.session),
    settings: deps.settings,
    vmMemoryCeilingBytes:
      deps.target === "lane-vm" ? vmMemoryCeiling(os.totalmem()) : null,
    repairs: deps.repairs,
  })
}
