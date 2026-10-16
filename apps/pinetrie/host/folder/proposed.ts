// host/folder/proposed — each folder lane's proposed changes: the shown
// merge, its newest state merged onto accepted work's newest
// (`shownMergeId`), made on the project's queue whenever either moves; its
// files those whose content differs from accepted work's newest
// (`sourceChanges`), reviewed as the range between the two, described by the
// host's describer. With it, the lane's base record: the state of the
// project's folder its line holds, and what a catch-up would change in the
// lane. Both are the page's caches, written from the graph and the shown
// merge; nothing decides from them. An accept writes the shown merge into
// the project's folder (`accept.ts`).

import {
  ERR,
  type FolderBaseRecord,
  type FolderProposedChangesRecord,
  type PointId,
  type StateRecord,
  snapshotId,
  type ThreadId,
} from "@pinetrie/core"
import {
  folderNewest,
  folderStateHeld,
  isAncestor,
  laneNewest,
  planBase,
  shownMergeId,
  stateGraph,
} from "@pinetrie/folder"
import type { Keeper } from "@pinetrie/keeper"
import type {
  FolderDisks,
  LaneOwner,
  LaneQueue,
  LaneRuntime,
} from "@pinetrie/lanes"
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
import { failed, type LeaseBasics } from "../basics.ts"
import type { Describe } from "../describe.ts"
import type { Records } from "../records.ts"
import {
  type ProposedChangesActs,
  reviewReadFacts,
} from "../work/destination.ts"
import type { FolderAccept } from "./accept.ts"
import { type StateReader, sourceChanges } from "./changes.ts"
import { dropUnrecordedBase, mergeToState } from "./merge.ts"
import { baseMissing } from "./virtual-base.ts"

/** The most of proposed changes' diff a description reads. */
const DESCRIBE_DIFF_BYTES = 200_000

/**
 * A lane's proposed changes and base records from what the graph says now; null
 * for a lane that has not begun, or a project before its first read.
 */
export function planFolderRecords(input: {
  readonly lane: ThreadId
  readonly states: readonly StateRecord[]
  /** The proposed changes' files: the source paths differing between accepted work's newest and the shown merge. */
  readonly files: readonly string[]
  /** What catching up would change in the lane: the source paths differing between its newest and the shown merge. */
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

interface FolderProposedChanges extends ProposedChangesActs {
  /** Every folder lane's proposed changes and base built again: accepted work moved. */
  rebuildAll(): Promise<void>
  /** `lane`'s proposed changes built again, or withdrawn, on the project's queue. */
  rebuild(lane: ThreadId): Promise<void>
  /** `rebuild`, for a step on the project's queue already, which a queued one would wait behind forever. */
  rebuildNow(lane: ThreadId): Promise<void>
  withdraw(lane: ThreadId): Promise<void>
}

/** What the folder's proposed changes read and merge on. */
type ShownReader = StateReader & {
  readonly runtime: Pick<LaneRuntime, "diff" | "disk" | "snapshotExists">
  readonly disks: Pick<
    FolderDisks,
    | "fileDiff"
    | "diffStats"
    | "pathFacts"
    | "sameContent"
    | "applyMerge"
    | "filesUnder"
    | "read"
  >
}

/**
 * The state a folder proposed changes record shows: its shown merge, or
 * its tip when it holds no work, which has none.
 */
export const shownOf = (r: FolderProposedChangesRecord): PointId =>
  r.files.length === 0 ? r.tip : shownMergeId(r.start, r.tip)

/**
 * `tip` merged onto `newest` as their shown merge, unless it is made
 * already and `known` holds its conflicts: in a scratch disk of its own,
 * snapshotted and deleted after, on the project's queue. Null when their
 * base's snapshot is gone.
 */
export async function makeShownMerge(
  reader: ShownReader,
  states: () => readonly StateRecord[],
  newest: PointId,
  tip: PointId,
  known: readonly string[] | null,
): Promise<{ readonly paths: readonly string[] } | null> {
  const shown = shownMergeId(newest, tip)
  const made = await reader.runtime.snapshotExists(snapshotId(shown))
  if (made && known !== null) return { paths: known }
  const plan = planBase(stateGraph(states()), newest, tip)
  if (plan === null || (await baseMissing(reader, plan)) !== null) return null
  const scratch = `${shown}-scratch` as LaneOwner
  if (made)
    await reader.runtime.disk({
      kind: "deleteSnapshots",
      ids: [snapshotId(shown)],
    })
  await reader.runtime.disk({ kind: "delete", lane: scratch })
  await reader.runtime.disk({
    kind: "restore",
    lane: scratch,
    from: snapshotId(newest),
  })
  try {
    const { paths } = await mergeToState(reader, {
      disk: scratch,
      ours: newest,
      theirs: tip,
      plan,
      markers: true,
      snapshot: () =>
        reader.runtime.disk({
          kind: "snapshot",
          lane: scratch,
          snapshot: snapshotId(shown),
        }),
    })
    return { paths }
  } finally {
    await reader.runtime.disk({ kind: "delete", lane: scratch })
    await dropUnrecordedBase(reader.runtime, plan, s =>
      stateGraph(states()).states.has(s),
    )
  }
}

export function startFolderProposedChanges(deps: {
  readonly basics: LeaseBasics
  readonly records: Pick<Records, "writeValues">
  readonly keeper: Keeper
  readonly reader: ShownReader
  /** The project's one queue: a shown merge is made on it, as a read and a virtual base are. */
  readonly queue: LaneQueue
  readonly states: () => readonly StateRecord[]
  readonly conflicts: (lane: ThreadId) => readonly string[]
  readonly describer: Describe
  readonly running: (lane: ThreadId) => boolean
  readonly baseChanged: (lane: ThreadId) => void
  /** An accept into the project's folder (`accept.ts`). */
  readonly accept: FolderAccept["accept"]
}): FolderProposedChanges {
  const { basics, reader } = deps

  const folderRecord = (
    lane: ThreadId,
  ): FolderProposedChangesRecord | undefined => {
    const record = readProposedByLane(basics.session).get(lane)
    return record?.kind === "folder" ? record : undefined
  }

  /** `lane`'s proposed changes and base built again, on the project's queue already. */
  async function rebuildNow(lane: ThreadId): Promise<void> {
    // gather
    const states = deps.states()
    const g = stateGraph(states)
    const newest = folderNewest(g)
    const tip = laneNewest(g, lane)
    const start = tip === null ? null : folderStateHeld(g, tip)
    if (newest === null || tip === null || start === null) return withdraw(lane)
    const before = folderRecord(lane)
    const changes = (a: PointId, b: PointId) =>
      a === b ? Promise.resolve([]) : sourceChanges(reader, a, b)
    const worked = await changes(start, tip)
    // A tip accepted work holds already has nothing to show.
    const holds = isAncestor(g, tip, newest)
    const merged = holds
      ? { paths: [] }
      : await makeShownMerge(
          reader,
          deps.states,
          newest,
          tip,
          before?.start === newest && before.tip === tip
            ? before.conflicts.filter(p => !deps.conflicts(lane).includes(p))
            : null,
        )
    if (merged === null) {
      basics.log(
        `[host] ${lane}: its proposed changes are not built: the state it shares with the project's folder is no longer kept`,
      )
      return
    }
    const shown = holds ? newest : shownMergeId(newest, tip)
    const [files, brings] = await Promise.all([
      changes(newest, shown),
      changes(tip, shown),
    ])
    // plan
    const planned = planFolderRecords({
      lane,
      states,
      files,
      brings,
      worked: worked.length > 0,
      conflicts: [...new Set([...merged.paths, ...deps.conflicts(lane)])],
      before,
      now: basics.now(),
    })
    // execute
    if (planned === null) return withdraw(lane)
    await deps.records.writeValues([
      setRecord(PROPOSED_CHANGES, planned.proposed),
      setRecord(BASE, planned.base),
    ])
    // The shown merge it replaces goes, unless an accept made it a state.
    const was =
      before === undefined || before.files.length === 0
        ? null
        : shownMergeId(before.start, before.tip)
    if (
      was !== null &&
      was !== shownOf(planned.proposed) &&
      !stateGraph(deps.states()).states.has(was)
    )
      await reader.runtime.disk({
        kind: "deleteSnapshots",
        ids: [snapshotId(was)],
      })
    deps.baseChanged(lane)
  }

  const rebuild = (lane: ThreadId) => deps.queue.enqueue(() => rebuildNow(lane))

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
            shownOf(proposed),
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
    rebuildNow,
    withdraw,
    async rebuildAll() {
      for (const lane of lanes())
        await rebuild(lane).catch(
          failed(basics, "building its proposed changes", lane),
        )
    },
    runEnded(lane) {
      void deps.keeper.track(
        rebuild(lane)
          .then(() => describe(lane, false))
          .catch(failed(basics, "building its proposed changes", lane)),
      )
    },
    async act(lane, action, by, _to, seen) {
      switch (action) {
        case "accept":
          return deps.accept(lane, seen ?? null, by)
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
      const read = planReviewRead(await reviewReadFacts(basics), ask)
      if (read.kind === "refused") return read
      if (read.span.kind !== "range")
        return {
          kind: "refused",
          status: 404,
          reason: "a folder project's proposed changes have no revisions",
        }
      const { from, to: asked } = read.span
      const proposed = [...readProposedByLane(basics.session).values()].find(
        o => o.kind === "folder" && o.start === from && o.tip === asked,
      )
      // Proposed changes are reviewed as their shown merge; a lane's turns as they are.
      const to = proposed?.kind === "folder" ? shownOf(proposed) : asked
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
