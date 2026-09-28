// lanes/merge — landing your work in a lane, and taking it back
// (ADR-0032, ADR-0033).
//
// The lane merges your `@-` into itself, in its own repo, after fetching it
// by id: jj records conflicts in the merge rather than failing (S36 item 11),
// and the agent resolves them there, never in your working copy. The merge
// is committed at once, so it is a revision even when it merged cleanly: an
// empty merge would stay the working copy, which every snapshot rewrites. You
// take the result with `jj rebase -r @ -d <result>`, once your repo has
// fetched it.

import type { CommitId, LaneName } from "@pineta/core"
import { setBookmark } from "./bookmarks.ts"
import { bookmarkName } from "./plan.ts"
import { commitsOf } from "./revisions.ts"
import { describeFailure, lines, type Runner } from "./run.ts"

const union = (ids: readonly CommitId[]) => ids.join(" | ")

/**
 * Merge `yours` into the lane at its bookmark, and commit the merge. `jj` is
 * the lane's, and must already hold `yours`. Returns the lane's revision
 * before the merge (`ours`), and the merge, or null when your work is already
 * in the lane: there is nothing to merge.
 */
export async function mergeYours(
  jj: Runner,
  lane: LaneName,
  yours: readonly CommitId[],
): Promise<{ readonly ours: CommitId; readonly merge: CommitId | null }> {
  const [ours] = await commitsOf(jj, `bookmarks(exact:"${bookmarkName(lane)}")`)
  if (ours === undefined) throw new Error(`lane ${lane} has no bookmark`)
  const missing = await commitsOf(jj, `(${union(yours)}) ~ ::${ours}`)
  if (missing.length === 0) return { ours, merge: null }
  const made = await jj(["new", ours, ...yours, "-m", "land: your work"])
  if (!made.ok) throw new Error(describeFailure("jj new", made))
  const commit = await jj(["commit", "-m", "land: your work"])
  if (!commit.ok) throw new Error(describeFailure("jj commit", commit))
  const [merge] = await commitsOf(jj, "@-")
  if (merge === undefined) throw new Error("the merge left no parent to read")
  await setBookmark(jj, lane, merge)
  return { ours, merge }
}

/** The files with conflicts in the lane's working copy. */
export async function conflictsIn(jj: Runner): Promise<string[]> {
  const snap = await jj(["util", "snapshot"])
  if (!snap.ok) throw new Error(describeFailure("jj util snapshot", snap))
  const ran = await jj([
    "file",
    "list",
    "--ignore-working-copy",
    "-r",
    "@",
    "-T",
    'if(conflict, path ++ "\\n")',
  ])
  if (!ran.ok) throw new Error(describeFailure("jj file list", ran))
  return lines(ran.stdout)
}

/**
 * A conflicted file's content in the lane's working copy, with jj's markers.
 * The host cannot read a lane's disk, so jj prints it. A bare path is read
 * from the process's directory, not `-R`'s: `root:` names it from the repo's
 * root.
 */
export async function conflictContent(
  jj: Runner,
  file: string,
): Promise<string> {
  const ran = await jj([
    "file",
    "show",
    "--ignore-working-copy",
    "-r",
    "@",
    `root:${JSON.stringify(file)}`,
  ])
  return ran.ok ? ran.stdout : ""
}

const SEPARATOR = "\n@@pineta-revision@@\n"

/**
 * The descriptions of the revisions on one side of a merge that touched
 * `file`, oldest first: from where the two sides forked to `side`.
 */
export async function sideHistory(
  jj: Runner,
  sides: { readonly ours: CommitId; readonly theirs: readonly CommitId[] },
  side: readonly CommitId[],
  file: string,
): Promise<string[]> {
  const fork = `fork_point(${sides.ours} | ${union(sides.theirs)})`
  const ran = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "--reversed",
    "-r",
    `${fork}..(${union(side)})`,
    "-T",
    `description ++ ${JSON.stringify(SEPARATOR)}`,
    `root:${JSON.stringify(file)}`,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  return ran.stdout
    .split(SEPARATOR)
    .map(d => d.trim())
    .filter(d => d !== "")
}

/**
 * Put your `@` on the landing's result: your uncommitted changes stay in `@`.
 * `jj` is your repo's, which must already hold `result`.
 */
export async function takeInto(jj: Runner, result: CommitId): Promise<void> {
  const ran = await jj(["rebase", "-r", "@", "-d", result])
  if (!ran.ok) throw new Error(describeFailure("jj rebase", ran))
}
