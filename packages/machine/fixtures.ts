// machine/fixtures — test support: the snapshot index in memory, and a
// store and records to plan over. Production code never imports it; the
// host's index is SQLite's (`apps/pinetrie/host/snapshot-index.ts`).

import type {
  Deletable,
  EventMeasured,
  IndexedSnapshot,
  SnapshotId,
  ThreadId,
} from "@pinetrie/core"
import type {
  DecisionMeasured,
  LaneMeasured,
  SampleMeasured,
} from "./measurements.ts"
import type { HostLaneFacts, MachineMeasurements } from "./ports.ts"
import type {
  Reservation,
  RowState,
  SnapshotIndex,
  SnapshotRow,
} from "./snapshot-index.ts"
import type {
  RecordedSnapshot,
  StoreControls,
  StoreListed,
  StoreRecords,
} from "./store.ts"

/** The index as the host keeps it, in a map: each write as SQLite's does it. */
export function memoryIndex(seed: readonly SnapshotRow[] = []): SnapshotIndex {
  const rows = new Map<SnapshotId, SnapshotRow>(seed.map(r => [r.snapshot, r]))
  let complete = false
  const next = () => Math.max(0, ...[...rows.values()].map(r => r.used)) + 1
  const set = (
    id: SnapshotId,
    state: RowState,
    when: (r: SnapshotRow) => boolean,
  ) => {
    const r = rows.get(id)
    if (r !== undefined && when(r)) rows.set(id, { ...r, state })
  }
  return {
    rows: () => [...rows.values()],
    reserve(row) {
      const was = rows.get(row.snapshot)
      rows.set(row.snapshot, {
        ...row,
        used: next(),
        branched: was?.branched ?? false,
        state: "reserved",
      })
      return row.snapshot as Reservation
    },
    markTaken(r) {
      set(r, "kept", x => x.state === "reserved")
      return r as SnapshotId as IndexedSnapshot
    },
    markNotTaken: r => set(r, "deleted", x => x.state === "reserved"),
    markUsed(id, branched) {
      const r = rows.get(id)
      if (r !== undefined)
        rows.set(id, { ...r, used: next(), branched: r.branched || branched })
    },
    settleReserved(listed) {
      for (const r of rows.values())
        if (r.state === "reserved")
          set(
            r.snapshot,
            listed.has(r.snapshot) ? "kept" : "deleted",
            () => true,
          )
    },
    keepAgain(lanes) {
      for (const r of rows.values())
        if (lanes.includes(r.lane) && r.state === "to-delete")
          set(r.snapshot, "kept", () => true)
    },
    markToDelete(ids) {
      for (const id of ids) set(id, "to-delete", r => r.state === "kept")
    },
    markDeleted(ids: readonly Deletable<"entry">[]) {
      for (const id of ids) set(id, "deleted", r => r.state !== "reserved")
    },
    indexRecorded(recorded) {
      for (const r of recorded)
        if (!rows.has(r.snapshot))
          rows.set(r.snapshot, {
            ...r,
            used: next(),
            branched: false,
            state: "kept",
          })
    },
    isComplete: () => complete,
    markComplete() {
      complete = true
    },
  }
}

/** A store listed as `listing`, recording what it was told to do; deleting takes a name off it. */
export function fakeStore(listing: StoreListed) {
  let snapshots = [...listing.snapshots]
  const did: string[] = []
  const store: StoreControls = {
    listing: async () => ({ ...listing, snapshots }),
    async deleteSnapshots(ids) {
      did.push(...ids.map(id => `snapshot ${id}`))
      const gone = new Set<string>(ids)
      snapshots = snapshots.filter(s => !gone.has(s))
    },
    async deleteLane(lane) {
      did.push(`lane ${lane}`)
    },
    async removeInnerProject(lane, key) {
      did.push(`inner ${lane} ${key}`)
    },
  }
  return { store, did }
}

export const EMPTY_LISTING: StoreListed = {
  snapshots: [],
  lanes: [],
  nested: [],
}

/** Records of `roots`, and lanes live and running. */
export function fakeRecords(
  input: {
    readonly roots?: ReadonlyMap<string, readonly RecordedSnapshot[]>
    readonly live?: readonly ThreadId[]
    readonly running?: readonly string[]
  } = {},
): StoreRecords {
  const roots = input.roots ?? new Map()
  return {
    roots: async () => [...roots.keys()],
    snapshotsOf: async root => roots.get(root) ?? [],
    liveLanes: async () => new Set(input.live ?? []),
    runningLanes: async () => new Set(input.running ?? []),
  }
}

/** What the host knows of its lanes: `ranked` most important first, and each lane's program in flight. */
export function fakeLaneFacts(
  input: {
    readonly ranked?: readonly ThreadId[]
    readonly inFlight?: ReadonlyMap<ThreadId, string>
  } = {},
): HostLaneFacts {
  return {
    lanesByImportance: async lanes => {
      const ranked = input.ranked ?? []
      const at = (l: ThreadId) =>
        ranked.includes(l) ? ranked.indexOf(l) : ranked.length
      return [...lanes].sort((a, b) => at(a) - at(b))
    },
    programInFlight: lane => input.inFlight?.get(lane) ?? null,
  }
}

/** Measurements kept in arrays, each write in order, and how many trims were asked for. */
export function keptMeasurements(): MachineMeasurements & {
  readonly samples: SampleMeasured[]
  readonly lanes: LaneMeasured[]
  readonly decisions: DecisionMeasured[]
  readonly events: EventMeasured[]
  readonly trims: { count: number }
} {
  const samples: SampleMeasured[] = []
  const lanes: LaneMeasured[] = []
  const decisions: DecisionMeasured[] = []
  const events: EventMeasured[] = []
  const trims = { count: 0 }
  return {
    samples,
    lanes,
    decisions,
    events,
    trims,
    recordSample: row => void samples.push(row),
    recordLaneSamples: rows => void lanes.push(...rows),
    recordDecisions: rows => void decisions.push(...rows),
    recordEvents: rows => void events.push(...rows),
    trim: () => {
      trims.count++
    },
  }
}
