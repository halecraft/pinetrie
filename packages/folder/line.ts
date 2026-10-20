// folder/line — a read of the project's folder into its line, planned from
// the last read's stamps (`planRead`): what the disks role copies, and the
// state it makes. The host scans and reads; this decides.

import type {
  FolderStamp,
  PointId,
  ReadPath,
  StateRecord,
} from "@pinetrie/core"
import { laneStates } from "./graph.ts"
import { planRead } from "./read.ts"
import { type FolderRecords, planStateRecords } from "./records.ts"

/**
 * What the disks role reads in: the project's folder's `paths` into
 * `state`, a new state of its line made from `from` (null: empty),
 * `deleted` removed (`FolderDisks.readIn`).
 */
export interface ReadInCall {
  readonly from: PointId | null
  readonly state: PointId
  readonly paths: readonly ReadPath[]
  readonly deleted: readonly string[]
}

/** What a read does, decided from what it gathered. */
export type LineRead =
  /** The project's folder holds what accepted work's newest state holds. */
  | { readonly kind: "current"; readonly newest: PointId }
  | {
      readonly kind: "read"
      readonly call: ReadInCall
      /** The read's state, `call.state`, checked against the graph. */
      readonly records: FolderRecords
      readonly stamps: ReadonlyMap<string, FolderStamp>
    }

/**
 * The read to make. With no stamps kept (none, or none since a read was
 * lost), a read copies every path into an empty disk, so nothing deleted
 * since lingers; else only what changed, on accepted work's newest state. The
 * first read makes a state even of an empty folder: a lane needs one to
 * start from.
 */
export function planLineRead(input: {
  readonly states: readonly StateRecord[]
  readonly last: ReadonlyMap<string, FolderStamp> | null
  readonly scan: ReadonlyMap<string, FolderStamp>
  /** The new state's id, if one is made. */
  readonly state: PointId
  readonly at: number
}): LineRead {
  const { scan, state } = input
  const { newest } = laneStates(input.states, null)
  const last = newest === null ? null : input.last
  const plan = planRead(last ?? new Map(), scan)
  if (newest !== null && last !== null && plan === null)
    return { kind: "current", newest }
  const stamped = (paths: readonly string[]): ReadPath[] =>
    paths.flatMap(p => {
      const s = scan.get(p)
      return s === undefined
        ? []
        : [{ path: p, stamp: { size: s.size, ctimeNs: s.ctimeNs } }]
    })
  const record: StateRecord = {
    id: state,
    parents: newest === null ? [] : [newest],
    made: { kind: "read" },
    at: input.at,
    by: null,
  }
  return {
    kind: "read",
    call: {
      from: last === null ? null : newest,
      state,
      paths: stamped(
        last === null ? [...scan.keys()].sort() : (plan?.changed ?? []),
      ),
      deleted: last === null ? [] : (plan?.deleted ?? []),
    },
    records: planStateRecords(input.states, record),
    stamps: scan,
  }
}
