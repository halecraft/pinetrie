// host/migrations/0023-lane-forks — each lane of its own given its fork's
// record: begun when a turn of its was recorded, or a folder lane's start
// state was; else owed, so its next start forks it. `pinetrie.files-lost`
// is read here, before the startup's sweep deletes it, and becomes each
// begun record's `lost`. Delete once Duane's store has run it.

import {
  isThreadId,
  type LaneRecord,
  type SnapshotId,
  snapshotId,
  stateLane,
  type ThreadId,
  type ValueWrite,
} from "@pinetrie/core"
import {
  decodeRecords,
  LANE,
  LANE_FORK,
  REVISION,
  type RecordSpec,
  STATE,
  setRecord,
} from "@pinetrie/rules"
import {
  applyRecordWrites,
  type RecordsDocHandle,
  readNamespace,
} from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"
import { recordDocs } from "./rewrite.ts"

const FILES_LOST_NAMESPACE = "pinetrie.files-lost"

/**
 * The fork records every lane of its own lacks: begun when a revision record
 * names it or it has a start state, its `lost` from `pinetrie.files-lost`;
 * else owed. None stored its WIP, so each starts from accepted work.
 */
export function planLaneForks(input: {
  readonly lanes: ReadonlyMap<ThreadId, LaneRecord>
  /** The lanes with a fork record already. */
  readonly forks: ReadonlySet<ThreadId>
  /** The lanes a revision record names. */
  readonly recorded: ReadonlySet<ThreadId>
  /** The folder lanes with a start state. */
  readonly started: ReadonlySet<ThreadId>
  /** `pinetrie.files-lost`'s snapshots, by lane. */
  readonly lost: ReadonlyMap<ThreadId, SnapshotId>
}): ValueWrite<"session">[] {
  return [...input.lanes.values()].flatMap(r => {
    if (r.history === null || input.forks.has(r.lane)) return []
    const begun = input.recorded.has(r.lane) || input.started.has(r.lane)
    return [
      setRecord(
        LANE_FORK,
        begun
          ? {
              lane: r.lane,
              base: null,
              state: "begun",
              lost: input.lost.get(r.lane) ?? null,
            }
          : { lane: r.lane, base: null, state: "owed" },
      ),
    ]
  })
}

/** One namespace's records in `doc`, decoded by `spec`. */
const decoded = <R, K extends string>(
  doc: RecordsDocHandle,
  spec: RecordSpec<R, K>,
): ReadonlyMap<K, R> =>
  decodeRecords(
    spec,
    Object.entries(readNamespace(doc, spec.namespace)).map(([key, value]) => ({
      key,
      value,
    })),
  )

/** `pinetrie.files-lost`, read raw: no spec declares it now. */
function filesLost(doc: RecordsDocHandle): ReadonlyMap<ThreadId, SnapshotId> {
  const out = new Map<ThreadId, SnapshotId>()
  for (const [key, value] of Object.entries(
    readNamespace(doc, FILES_LOST_NAMESPACE),
  )) {
    const snapshot =
      typeof value === "object" && value !== null && "snapshot" in value
        ? value.snapshot
        : undefined
    if (isThreadId(key) && typeof snapshot === "string" && snapshot !== "")
      out.set(key, snapshotId(snapshot))
  }
  return out
}

export const LANE_FORKS: RecordMigration = {
  name: "0023-lane-forks",
  async run(input) {
    // gather
    const [session] = await recordDocs(input, "session")
    if (session === undefined) return null
    const recorded = new Set<ThreadId>()
    for (const { doc } of await recordDocs(input, "root"))
      for (const r of decoded(doc, REVISION).values()) recorded.add(r.lane)
    const started = new Set<ThreadId>()
    for (const s of decoded(session.doc, STATE).values())
      if (s.made.kind === "start") {
        const lane = stateLane(s)
        if (lane !== null) started.add(lane)
      }
    // plan
    const writes = planLaneForks({
      lanes: decoded(session.doc, LANE),
      forks: new Set(decoded(session.doc, LANE_FORK).keys()),
      recorded,
      started,
      lost: filesLost(session.doc),
    })
    if (writes.length === 0) return null
    // execute
    return async () => applyRecordWrites(session.doc, writes)
  },
}
