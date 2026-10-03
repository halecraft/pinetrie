// lanes/bookmarks — `pineta/<lane>`, in a lane's own repo.
//
// The bookmark moves with every revision (`commitTurn`, `mergeBase`). In your
// repo a lane's history is not a bookmark of yours but a remote bookmark,
// `tip@pineta-<lane>` (`@pineta/repo`'s `laneTipIn` and `laneRefSteps`),
// which jj keeps out of your default log and immutable (ADR-0038, S48 item
// 11).

import { type CommitId, commitId, type LaneName } from "@pineta/core"
import { bookmarkName, bookmarkRevset } from "./plan.ts"
import { describeFailure, lines, type Runner } from "./run.ts"

/** The commit a lane's bookmark points at, or null. */
export async function bookmarkOf(
  jj: Runner,
  lane: LaneName,
): Promise<CommitId | null> {
  const ran = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    `present(${bookmarkRevset(bookmarkName(lane))})`,
    "-T",
    'commit_id ++ "\\n"',
  ])
  const id = ran.ok ? lines(ran.stdout)[0] : undefined
  return id === undefined ? null : commitId(id)
}

/** Point a lane's bookmark at `commit`, creating it if need be. */
export async function setBookmark(
  jj: Runner,
  lane: LaneName,
  commit: CommitId,
): Promise<void> {
  const ran = await jj([
    "bookmark",
    "set",
    "--allow-backwards",
    bookmarkName(lane),
    "-r",
    commit,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj bookmark set", ran))
}

/** Delete a lane's bookmark, if it has one; its commits stay. */
export async function deleteBookmark(
  jj: Runner,
  lane: LaneName,
): Promise<void> {
  if ((await bookmarkOf(jj, lane)) === null) return
  const ran = await jj(["bookmark", "delete", bookmarkName(lane)])
  if (!ran.ok) throw new Error(describeFailure("jj bookmark delete", ran))
}
