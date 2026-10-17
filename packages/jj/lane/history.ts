// jj/lane/history — a lane's history in its own jj repo: `LaneHistory`, over
// the lane's runners. Each method gathers with jj, decides with a pure
// planner, then executes. The caller holds the lane's queue: lane work
// reaches it only through `withHistory`.
//
// A move your repo needs to hear of hands back the fetch it needs as `follow`,
// planned here (`planFetch`), for the caller to fire after the step it
// queues next.

import {
  type CommitId,
  planCopyReady,
  pointFromCommit,
  type RepoConfig,
} from "@pinetrie/core"
import {
  type Edits,
  executeOrThrow,
  forkSetup,
  type LaneHistory,
  type LaneRunners,
  recordedStart,
  type TurnCommittedOf,
} from "@pinetrie/lanes"
import { laneBase } from "./base.ts"
import { readLaneBookmark } from "./bookmarks.ts"
import { type LaneMove, planFetch } from "./fetch-plan.ts"
import { conflictsIn, mergeUpdate } from "./merge.ts"
import { bookmarkName, bookmarkRevset } from "./names.ts"
import { planForkSetup, planMerge, planOldNamesOnDisk } from "./plan.ts"
import {
  baseFromCommits,
  type JjLane,
  mergedFromCommits,
  turnFromCommits,
} from "./points.ts"
import {
  changedPaths,
  commitTurn,
  copyFacts,
  oldNamesOnDisk,
  readConflictedFiles,
} from "./revisions.ts"
import { laneJj } from "./run.ts"

/**
 * `lane`'s history, over its runners: proven jj once, by its caller
 * (`proveJjLane`), so every point it reads is a commit. `fetch` schedules
 * the lane's fetch into your repo, excluding those of `have` your repo holds.
 */
export function jjLaneHistory(input: {
  readonly lane: JjLane
  readonly runners: LaneRunners
  /** Your repo's names: a lane's base is found by them. */
  readonly repoConfig: RepoConfig
  readonly fetch: (have: readonly (CommitId | null)[]) => void
}): LaneHistory {
  const { runners, repoConfig } = input
  const { lane } = input.lane
  const jj = laneJj(runners.lane)

  const followOf = (move: LaneMove) => {
    const have = planFetch(move)
    return have === null ? null : () => input.fetch(have)
  }

  async function committed(
    edits: Edits,
  ): Promise<{ made: TurnCommittedOf<CommitId>; before: CommitId | null }> {
    const before = await readLaneBookmark(jj, lane)
    const made = await commitTurn(jj, { ...edits, lane, bookmark: before })
    return { made, before }
  }

  return {
    forkSteps: start => forkSetup(null, planForkSetup(input.lane, start)),

    // The fork setup's commit, on the lane's disk, records where it began.
    startRecords: async () => recordedStart([]),

    keptSnapshot: async () => null,

    commit: async edits => turnFromCommits((await committed(edits)).made),

    async recordTurn(edits) {
      const { made, before } = await committed(edits)
      // An adopted turn may be several of the agent's commits: its paths run
      // from the bookmark before it.
      const paths =
        made.point === null ? [] : await changedPaths(jj, before, made.point)
      // The files conflicted in the commit its record names: its own, else
      // the bookmark's, which a branch from it clones.
      const named = made.point ?? before
      const conflicts =
        made.conflicted && named !== null
          ? await readConflictedFiles(jj, named)
          : []
      return {
        committed: made.point === null ? null : pointFromCommit(made.point),
        newest: before === null ? null : pointFromCommit(before),
        paths,
        conflicts,
        follow: followOf({ kind: "turn", made, before }),
      }
    },

    async base() {
      const base = await laneBase(
        jj,
        bookmarkRevset(bookmarkName(lane)),
        repoConfig,
      )
      return base === null ? null : baseFromCommits(base)
    },

    // A merge lands at the lane's bookmark: a working copy off its line (a
    // split's stack) would be left beside it.
    readyToMerge: async () => planCopyReady(await copyFacts(jj, lane)),

    async merge(_ready, from, edits) {
      if (edits !== null) await committed(edits)
      const merged = await mergeUpdate(
        jj,
        runners,
        lane,
        planMerge(input.lane, from),
      )
      return {
        ...mergedFromCommits(merged),
        follow: followOf({ kind: "merge", merged }),
      }
    },

    conflicts: () => conflictsIn(jj),

    // jj's conflicts are markers in the file: resolved by editing it.
    resolve: async () => ({ kind: "refused", why: "markers" }),

    // pre-rename: a snapshot of a lane made before the rename holds the old
    // names. A volume needs no such step: the one-off migration renamed
    // those.
    async afterRestore() {
      await executeOrThrow(
        planOldNamesOnDisk(await oldNamesOnDisk(runners.lane), lane),
        runners,
      )
    },
  }
}
