// lanes/bookmarks — `pinetrie/<lane>`, in a lane's own repo.
//
// The bookmark moves with every revision (`commitTurn`, `mergeBase`). In your
// repo a lane's history is not a bookmark of yours but a remote bookmark,
// `tip@pinetrie-<lane>` (`@pinetrie/jj`'s `laneTipIn` and `laneRefSteps`),
// which jj keeps out of your default log and immutable.

import { type CommitId, commitId, type ThreadId } from "@pinetrie/core"
import { describeFailure, lines, type Runner } from "@pinetrie/lanes"
import { bookmarkName, bookmarkRevset } from "./names.ts"

/** The commit a lane's bookmark points at, or null. */
export async function bookmarkOf(
  jj: Runner,
  lane: ThreadId,
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
  lane: ThreadId,
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
