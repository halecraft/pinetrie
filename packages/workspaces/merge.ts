// workspaces/merge — landing your work in a lane, and taking it back
// (ADR-0032, ADR-0033).
//
// The lane merges your `@-` into itself, in its own workspace: jj records
// conflicts in the merge rather than failing (S36 item 11), and the agent
// resolves them there, never in your working copy. The merge is committed at
// once, so it is a revision even when it merged cleanly: an empty merge would
// stay the working copy, which every snapshot rewrites. You take the result
// with `jj rebase -r @ -d <result>`.

import { readFile } from "node:fs/promises"
import path from "node:path"
import type { CommitId, LaneName } from "@pineta/core"
import { commitsOf } from "./revisions.ts"
import { describeFailure, jj, lines } from "./run.ts"
import { bookmarkName } from "./where.ts"
import { setBookmark } from "./workspace.ts"

const union = (ids: readonly CommitId[]) => ids.join(" | ")

/**
 * Merge `yours` into the lane at its bookmark, in `workspace`, and commit the
 * merge. Returns the lane's revision before the merge (`ours`), and the merge,
 * or null when your work is already in the lane: there is nothing to merge.
 */
export async function mergeYours(
  root: string,
  workspace: string,
  lane: LaneName,
  yours: readonly CommitId[],
): Promise<{ readonly ours: CommitId; readonly merge: CommitId | null }> {
  const [ours] = await commitsOf(
    root,
    `bookmarks(exact:"${bookmarkName(lane)}")`,
  )
  if (ours === undefined) throw new Error(`lane ${lane} has no bookmark`)
  const missing = await commitsOf(root, `(${union(yours)}) ~ ::${ours}`)
  if (missing.length === 0) return { ours, merge: null }
  const made = await jj(workspace, [
    "new",
    ours,
    ...yours,
    "-m",
    "land: your work",
  ])
  if (!made.ok) throw new Error(describeFailure("jj new", made))
  const commit = await jj(workspace, ["commit", "-m", "land: your work"])
  if (!commit.ok) throw new Error(describeFailure("jj commit", commit))
  const [merge] = await commitsOf(workspace, "@-")
  if (merge === undefined) throw new Error("the merge left no parent to read")
  await setBookmark(root, lane, merge)
  return { ours, merge }
}

/** The files with conflicts in the workspace's working copy. */
export async function conflictsIn(workspace: string): Promise<string[]> {
  const snap = await jj(workspace, ["util", "snapshot"])
  if (!snap.ok) throw new Error(describeFailure("jj util snapshot", snap))
  const ran = await jj(workspace, [
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

/** A conflicted file's content in the workspace, with jj's markers. */
export const conflictContent = (
  workspace: string,
  file: string,
): Promise<string> =>
  readFile(path.join(workspace, file), "utf8").catch(() => "")

const SEPARATOR = "\n@@pineta-revision@@\n"

/**
 * The descriptions of the revisions on one side of a merge that touched
 * `file`, oldest first: from where the two sides forked to `side`.
 */
export async function sideHistory(
  workspace: string,
  sides: { readonly ours: CommitId; readonly theirs: readonly CommitId[] },
  side: readonly CommitId[],
  file: string,
): Promise<string[]> {
  const fork = `fork_point(${sides.ours} | ${union(sides.theirs)})`
  const ran = await jj(workspace, [
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "--reversed",
    "-r",
    `${fork}..(${union(side)})`,
    "-T",
    `description ++ ${JSON.stringify(SEPARATOR)}`,
    // A bare path is read from the process's directory, not `-R`'s: `root:`
    // names it from the workspace's root.
    `root:${JSON.stringify(file)}`,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  return ran.stdout
    .split(SEPARATOR)
    .map(d => d.trim())
    .filter(d => d !== "")
}

/** Put your `@` on the landing's result: your uncommitted changes stay in `@`. */
export async function takeInto(root: string, result: CommitId): Promise<void> {
  const ran = await jj(root, ["rebase", "-r", "@", "-d", result])
  if (!ran.ok) throw new Error(describeFailure("jj rebase", ran))
}
