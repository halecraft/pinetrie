// host/folder/line — the project's folder read into its line: the Mac scans (`scan.ts`),
// the read is planned from the last read's stamps (`planRead`), and the disks
// role copies only what changed into a new state (`read-in`), checking each
// path's stamp. One read at a time, on the project's queue. The stamps are
// written only once the state they made is recorded, so a read that failed
// is planned again from the last one that held. The first read finishes or
// puts back an accept a stopped host left; a read after the watcher saw the
// folder quiet checks the asides accepts kept first.

import { readFile, rename, writeFile } from "node:fs/promises"
import {
  type FolderStamp,
  lineStateId,
  type PointId,
  type ReadPath,
  type StateRecord,
} from "@pinetrie/core"
import { folderNewest, planRead, planState, stateGraph } from "@pinetrie/folder"
import type { FolderDisks, LaneQueue } from "@pinetrie/lanes"
import { decodeFolderStamps, encodeFolderStamps } from "@pinetrie/rules"
import { scanFolder } from "./scan.ts"

/** How many reads in a row may find a path moved before the read gives up. */
const READ_TRIES = 5

/** What a read does, decided from what it gathered. */
type LineRead =
  /** The project's folder holds what accepted work's newest state holds. */
  | { readonly kind: "current"; readonly newest: PointId }
  | {
      readonly kind: "read"
      readonly call: Parameters<FolderDisks["readIn"]>[0]
      readonly record: StateRecord
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
  const graph = stateGraph(input.states)
  const newest = folderNewest(graph)
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
  const planned = planState(graph, record)
  if (planned.kind !== "record")
    throw new Error(`a read's state is refused: ${JSON.stringify(planned)}`)
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
    record: planned.record,
    stamps: scan,
  }
}

export interface FolderLine {
  /** The project's folder read, after any read before it: its newest state then. */
  read(): Promise<PointId>
  /**
   * `read`, for a step on the project's queue already, which a queued read
   * would wait behind forever. Leaves kept asides alone: it is not quiet.
   */
  readNow(): Promise<PointId>
  /** The stamps of the last read that held, which match accepted work's newest; null for none. */
  stamps(): Promise<ReadonlyMap<string, FolderStamp> | null>
  writeStamps(stamps: ReadonlyMap<string, FolderStamp>): Promise<void>
  /** The watcher saw the folder quiet: the next read checks the asides accepts kept. */
  markQuiet(): void
}

export function createFolderLine(deps: {
  /** The project's folder, on the host. */
  readonly root: string
  /** pine·trie's own patterns now (`laneIgnores`, with the shared directories). */
  readonly own: () => string
  readonly disks: Pick<FolderDisks, "readIn">
  /** The project's queue, which a virtual base's merge runs on too. */
  readonly queue: LaneQueue
  /** The session's file of the last read's stamps (`SessionFiles.folderStamps`). */
  readonly stampsFile: string
  readonly states: () => readonly StateRecord[]
  readonly writeState: (record: StateRecord) => Promise<void>
  readonly newId: () => string
  readonly now: () => number
  /** A read made a state: accepted work moved. */
  readonly moved: (newest: PointId) => void
  /** What the line's first read does before it: a stopped accept finished or put back. */
  readonly recover: () => Promise<void>
  /** What a quiet read does before its scan: the asides accepts kept, checked. */
  readonly asides: () => Promise<void>
}): FolderLine {
  const { queue } = deps
  let recovered = false
  // The first read, at startup, is quiet as far as any aside is concerned:
  // the host was not running to write through one.
  let asidesDue = true

  const lastStamps = () =>
    readFile(deps.stampsFile, "utf8").then(decodeFolderStamps, () => null)

  async function writeStamps(stamps: ReadonlyMap<string, FolderStamp>) {
    const tmp = `${deps.stampsFile}.tmp`
    await writeFile(tmp, encodeFolderStamps(stamps))
    await rename(tmp, deps.stampsFile)
  }

  async function readNow(quiet: boolean): Promise<PointId> {
    if (!recovered) {
      await deps.recover()
      recovered = true
    }
    // An accept's own read is never quiet: the asides wait for the watcher,
    // and its read leaves them due.
    if (quiet && asidesDue) {
      asidesDue = false
      await deps.asides()
    }
    let moved: readonly string[] = []
    for (let tries = 0; tries < READ_TRIES; tries++) {
      // gather
      const last = await lastStamps()
      const scan = await scanFolder({ root: deps.root, own: deps.own() })
      // plan
      const planned = planLineRead({
        states: deps.states(),
        last,
        scan,
        state: lineStateId(deps.newId()),
        at: deps.now(),
      })
      if (planned.kind === "current") return planned.newest
      // execute
      const answer = await deps.disks.readIn(planned.call)
      if (answer.kind === "moved") {
        moved = answer.paths
        continue
      }
      await deps.writeState(planned.record)
      await writeStamps(planned.stamps)
      deps.moved(planned.record.id)
      return planned.record.id
    }
    throw new Error(
      `the project's folder kept changing while it was read: ${moved.slice(0, 5).join(", ")}`,
    )
  }

  return {
    read: () => queue.enqueue(() => readNow(true)),
    readNow: () => readNow(false),
    stamps: lastStamps,
    writeStamps,
    markQuiet() {
      asidesDue = true
    },
  }
}
