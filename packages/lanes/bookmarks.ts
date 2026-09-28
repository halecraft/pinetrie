// lanes/bookmarks — `pineta/<lane>`, in a lane's repo and in yours.
//
// In a lane's repo, the bookmark moves with every revision (`commitTurn`,
// `mergeYours`). In your repo it arrives by bundle fetch after each turn, and
// `bookmarks(glob:"pineta/*")` is in your `immutable_heads()`, so a lane's
// work there cannot be rewritten by accident.

import { type CommitId, commitId, type LaneName } from "@pineta/core"
import { bookmarkName } from "./plan.ts"
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
    `present(bookmarks(exact:"${bookmarkName(lane)}"))`,
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
