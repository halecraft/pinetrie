// host/folder/proposed — each folder lane's proposed changes: its newest state
// against accepted work's newest, its files those whose content differs
// (`sourceChanges`), reviewed as the range between the two, described by the
// host's describer. With it, the lane's base record: the state of the
// project's folder its line holds, and what catching up with accepted work's
// newest would change. Both are the page's caches, written from the graph; nothing decides
// from them. Accepting into the project's folder is the next step's: refused.

import {
  ERR,
  type FolderBaseRecord,
  type FolderProposedChangesRecord,
  type PointId,
  type StateRecord,
  type ThreadId,
} from "@pinetrie/core"
import {
  folderNewest,
  folderStateHeld,
  laneNewest,
  stateGraph,
} from "@pinetrie/folder"
import type { Keeper } from "@pinetrie/keeper"
import type { FolderDisks } from "@pinetrie/lanes"
import { readLaneRecords, readProposedByLane } from "@pinetrie/reads"
import {
  answerDiff,
  BASE,
  deleteRecord,
  MAX_DIFF_BYTES,
  PROPOSED_CHANGES,
  planReviewRead,
  type ReviewAnswer,
  setRecord,
} from "@pinetrie/rules"
import { type Basics, failed } from "../basics.ts"
import type { Describe } from "../describe.ts"
import type { Records } from "../records.ts"
import {
  type ProposedChangesActs,
  reviewReadFacts,
} from "../work/destination.ts"
import { type StateReader, sourceChanges } from "./changes.ts"

/** The most of proposed changes' diff a description reads. */
const DESCRIBE_DIFF_BYTES = 200_000

/**
 * A lane's proposed changes and base records from what the graph says now; null
 * for a lane that has not begun, or a project before its first read.
 */
export function planFolderRecords(input: {
  readonly lane: ThreadId
  readonly states: readonly StateRecord[]
  /** The proposed changes' files: the source paths differing between accepted work's newest and the lane's newest. */
  readonly files: readonly string[]
  /** What catching up would bring: the source paths differing between the lane's start and accepted work's newest. */
  readonly brings: readonly string[]
  /** Whether the lane changed anything since its start. */
  readonly worked: boolean
  readonly conflicts: readonly string[]
  readonly before: FolderProposedChangesRecord | undefined
  readonly now: number
}): {
  readonly proposed: FolderProposedChangesRecord
  readonly base: FolderBaseRecord
} | null {
  const g = stateGraph(input.states)
  const newest = folderNewest(g)
  const tip = laneNewest(g, input.lane)
  const start = tip === null ? null : folderStateHeld(g, tip)
  if (newest === null || tip === null || start === null) return null
  const { before } = input
  return {
    proposed: {
      kind: "folder",
      lane: input.lane,
      start: newest,
      tip,
      files: input.files,
      conflicts: input.conflicts,
      // A description holds while it describes the same two states.
      description:
        before?.start === newest && before.tip === tip
          ? before.description
          : null,
      at: input.now,
    },
    base: {
      kind: "folder",
      lane: input.lane,
      start,
      catchUp:
        start === newest ? null : { tip, to: newest, files: input.brings },
      work: input.worked ? "some" : "none",
    },
  }
}

export interface FolderProposedChanges extends ProposedChangesActs {
  /** Every folder lane's proposed changes and base built again: accepted work moved. */
  rebuildAll(): Promise<void>
  /** `lane`'s proposed changes built again, or withdrawn. */
  rebuild(lane: ThreadId): Promise<void>
  withdraw(lane: ThreadId): Promise<void>
}

export function startFolderProposedChanges(deps: {
  readonly basics: Basics
  readonly records: Pick<Records, "writeValues">
  readonly keeper: Keeper
  readonly reader: StateReader & {
    readonly disks: Pick<FolderDisks, "fileDiff" | "diffStats">
  }
  readonly states: () => readonly StateRecord[]
  readonly conflicts: (lane: ThreadId) => readonly string[]
  readonly describer: Describe
  readonly running: (lane: ThreadId) => boolean
  readonly baseChanged: (lane: ThreadId) => void
}): FolderProposedChanges {
  const { basics, reader } = deps

  const folderRecord = (
    lane: ThreadId,
  ): FolderProposedChangesRecord | undefined => {
    const record = readProposedByLane(basics.session).get(lane)
    return record?.kind === "folder" ? record : undefined
  }

  async function rebuild(lane: ThreadId): Promise<void> {
    // gather
    const states = deps.states()
    const g = stateGraph(states)
    const newest = folderNewest(g)
    const tip = laneNewest(g, lane)
    const start = tip === null ? null : folderStateHeld(g, tip)
    const changes = (a: PointId | null, b: PointId | null) =>
      a === null || b === null || a === b
        ? Promise.resolve([])
        : sourceChanges(reader, a, b)
    const [files, brings, worked] = await Promise.all([
      changes(newest, tip),
      changes(start, newest),
      changes(start, tip),
    ])
    // plan
    const planned = planFolderRecords({
      lane,
      states,
      files,
      brings,
      worked: worked.length > 0,
      conflicts: deps.conflicts(lane),
      before: folderRecord(lane),
      now: basics.now(),
    })
    // execute
    if (planned === null) return withdraw(lane)
    await deps.records.writeValues([
      setRecord(PROPOSED_CHANGES, planned.proposed),
      setRecord(BASE, planned.base),
    ])
    deps.baseChanged(lane)
  }

  async function withdraw(lane: ThreadId): Promise<void> {
    await deps.records.writeValues([
      deleteRecord(PROPOSED_CHANGES, lane),
      deleteRecord(BASE, lane),
    ])
    deps.baseChanged(lane)
  }

  /** `lane`'s proposed changes described, unless it is, or `force`; written only while it holds the same states. */
  const describe = (lane: ThreadId, force: boolean) =>
    deps.describer({
      lane,
      keeper: deps.keeper,
      gather: async () => {
        const proposed = folderRecord(lane)
        if (
          proposed === undefined ||
          proposed.files.length === 0 ||
          (proposed.description !== null && !force)
        )
          return null
        let diff = ""
        for (const path of proposed.files) {
          if (diff.length > DESCRIBE_DIFF_BYTES) break
          diff += await reader.disks.fileDiff(
            proposed.start,
            proposed.tip,
            path,
            DESCRIBE_DIFF_BYTES,
          )
        }
        return { gathered: proposed, diff, recent: [] }
      },
      settle: async (asked, text) => {
        const now = folderRecord(lane)
        if (now?.start !== asked.start || now.tip !== asked.tip) return
        await deps.records.writeValues([
          setRecord(PROPOSED_CHANGES, { ...now, description: text.trim() }),
        ])
      },
    })

  const lanes = () =>
    [...readLaneRecords(basics.session).values()]
      .filter(r => r.history === "folder")
      .map(r => r.lane)

  return {
    rebuild,
    withdraw,
    async rebuildAll() {
      for (const lane of lanes()) await rebuild(lane)
    },
    runEnded(lane) {
      void deps.keeper.track(
        rebuild(lane)
          .then(() => describe(lane, false))
          .catch(failed(basics, "building its proposed changes", lane)),
      )
    },
    async act(lane, action, by) {
      switch (action) {
        case "accept":
          return { kind: "refused", code: ERR.FOLDER_ACCEPT_LATER }
        case "squash":
          return { kind: "refused", code: ERR.NOT_A_STACK }
        case "describe":
          if (folderRecord(lane) === undefined)
            return { kind: "refused", code: ERR.NO_PROPOSED_CHANGES }
          void describe(lane, true)
          return { kind: "done", fact: { kind: "described", lane, by } }
        case "refresh":
          await rebuild(lane)
          if (!deps.running(lane)) void describe(lane, false)
          return { kind: "done", fact: { kind: "refreshed", lane, by } }
      }
    },
    async read(ask): Promise<ReviewAnswer> {
      const read = planReviewRead(reviewReadFacts(basics), ask)
      if (read.kind === "refused") return read
      if (read.span.kind !== "range")
        return {
          kind: "refused",
          status: 404,
          reason: "a folder project's proposed changes have no revisions",
        }
      const { from, to } = read.span
      if (read.kind === "diff")
        return answerDiff(
          await reader.disks.fileDiff(from, to, read.path, MAX_DIFF_BYTES),
        )
      const files = await sourceChanges(reader, from, to)
      const [stats, before, after] = await Promise.all([
        reader.disks.diffStats(from, to, files),
        reader.disks.pathFacts(from, files),
        reader.disks.pathFacts(to, files),
      ])
      const proposed = [...readProposedByLane(basics.session).values()].find(
        o => o.kind === "folder" && o.start === from && o.tip === to,
      )
      return {
        kind: "review",
        review: {
          description:
            proposed?.kind === "folder" ? (proposed.description ?? "") : "",
          files: stats.map((s, i) => ({
            path: s.path,
            shown: s.path,
            change:
              before[i]?.kind === "absent"
                ? "added"
                : after[i]?.kind === "absent"
                  ? "removed"
                  : "modified",
            added: s.added,
            removed: s.removed,
          })),
          widenings: [],
        },
      }
    },
  }
}
