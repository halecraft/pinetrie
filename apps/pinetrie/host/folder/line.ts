// host/folder/line — the project's folder read into its line: the Mac scans (`scan.ts`),
// the read is planned from the last read's stamps (`planRead`), and the disks
// role copies only what changed into a new state (`read-in`), checking each
// path's stamp. One read at a time, on the project's queue. The stamps are
// written only once the state they made is recorded, so a read that failed
// is planned again from the last one that held. The first read finishes or
// puts back an accept a stopped host left; a read after the watcher saw the
// folder quiet checks the asides accepts kept first.

import { readFile } from "node:fs/promises"
import {
  type FolderStamp,
  lineStateId,
  type PointId,
  type StateRecord,
} from "@pinetrie/core"
import { type FolderRecords, planLineRead } from "@pinetrie/folder"
import type { FolderDisks, LaneQueue } from "@pinetrie/lanes"
import { decodeFolderStamps, encodeFolderStamps } from "@pinetrie/rules"
import { replaceFile } from "../replace-file.ts"
import { scanFolder } from "./scan.ts"

/** How many reads in a row may find a path moved before the read gives up. */
const READ_TRIES = 5

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
  /** A read's records written (`recordWrites`). */
  readonly write: (records: FolderRecords) => Promise<void>
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
    await replaceFile(deps.stampsFile, encodeFolderStamps(stamps))
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
      await deps.write(planned.records)
      await writeStamps(planned.stamps)
      deps.moved(planned.call.state)
      return planned.call.state
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
