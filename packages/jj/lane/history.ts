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
  type RepoConfig,
  type ThreadId,
} from "@pinetrie/core"
import {
  type Edits,
  executeOrThrow,
  forkSetup,
  type LaneHistory,
  type LaneRunners,
  type TurnCommitted,
} from "@pinetrie/lanes"
import { laneBase } from "./base.ts"
import { bookmarkOf } from "./bookmarks.ts"
import { type LaneMove, planFetch } from "./fetch-plan.ts"
import { conflictsIn, mergeUpdate } from "./merge.ts"
import { bookmarkName, bookmarkRevset } from "./names.ts"
import { planForkSetup, planMerge, planOldNamesOnDisk } from "./plan.ts"
import {
  changedPaths,
  commitTurn,
  conflictedFilesAt,
  copyFacts,
  oldNamesOnDisk,
} from "./revisions.ts"
import { laneJj } from "./run.ts"

/**
 * `lane`'s history, over its runners. `fetch` schedules the lane's fetch
 * into your repo, excluding those of `have` your repo holds.
 */
export function historyOf(input: {
  readonly lane: ThreadId
  readonly runners: LaneRunners
  /** Your repo's names: a lane's base is found by them. */
  readonly repoConfig: RepoConfig
  readonly fetch: (have: readonly (CommitId | null)[]) => void
}): LaneHistory {
  const { lane, runners, repoConfig } = input
  const jj = laneJj(runners.lane)

  const followOf = (move: LaneMove) => {
    const have = planFetch(move)
    return have === null ? null : () => input.fetch(have)
  }

  async function committed(
    edits: Edits,
  ): Promise<{ made: TurnCommitted; before: CommitId | null }> {
    const before = await bookmarkOf(jj, lane)
    const made = await commitTurn(jj, { ...edits, lane, bookmark: before })
    return { made, before }
  }

  return {
    forkSteps: start => forkSetup(planForkSetup(lane, start)),

    commit: async edits => (await committed(edits)).made,

    async recordTurn(edits) {
      const { made, before } = await committed(edits)
      // An adopted turn may be several of the agent's commits: its paths run
      // from the bookmark before it.
      const paths =
        made.commit === null ? [] : await changedPaths(jj, before, made.commit)
      // The files conflicted in the commit its record names: its own, else
      // the bookmark's, which a branch from it clones.
      const named = made.commit ?? before
      const conflicts =
        made.conflicted && named !== null
          ? await conflictedFilesAt(jj, named)
          : []
      return {
        committed: made.commit,
        newest: before,
        paths,
        conflicts,
        follow: followOf({ kind: "turn", made, before }),
      }
    },

    base: () => laneBase(jj, bookmarkRevset(bookmarkName(lane)), repoConfig),

    // A merge lands at the lane's bookmark: a working copy off its line (a
    // split's stack) would be left beside it.
    readyToMerge: async () => planCopyReady(await copyFacts(jj, lane)),

    async merge(_ready, from, edits) {
      if (edits !== null) await committed(edits)
      const merged = await mergeUpdate(jj, runners, lane, planMerge(from))
      return { ...merged, follow: followOf({ kind: "merge", merged }) }
    },

    conflicts: () => conflictsIn(jj),

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
