// lanes/merge — a thread's base merged into its lane (ADR-0033, ADR-0060).
//
// The lane merges the line's commit, or a fresh copy of its WIP, into itself,
// in its own repo: jj records conflicts in the merge rather than failing (S36
// item 11), and the agent resolves them there, never in your repo. The merge
// is committed at once, so it is a revision even when it merged cleanly: an
// empty merge would stay the working copy, which every snapshot rewrites.
// The lane's work comes back to you as its offer, never by this merge.

import { type CommitId, type LaneName, TRAILERS } from "@pineta/core"
import { setBookmark } from "./bookmarks.ts"
import { bookmarkName, parseBase } from "./plan.ts"
import { commitsOf } from "./revisions.ts"
import { describeFailure, lines, type Runner } from "./run.ts"

const union = (ids: readonly CommitId[]) => ids.join(" | ")

/**
 * Merge `from` (the line's commit, or a WIP's copy, `planWipCopy`) into the
 * lane at its bookmark, described `message`, and commit the merge. `jj` is
 * the lane's, and must already hold `from`. Returns the lane's revision
 * before the merge (`ours`), and the merge, or null when `from` is already
 * in the lane: there is nothing to merge.
 */
export async function mergeBase(
  jj: Runner,
  lane: LaneName,
  from: CommitId,
  message: string,
): Promise<{ readonly ours: CommitId; readonly merge: CommitId | null }> {
  const [ours] = await commitsOf(jj, `bookmarks(exact:"${bookmarkName(lane)}")`)
  if (ours === undefined) throw new Error(`lane ${lane} has no bookmark`)
  const missing = await commitsOf(jj, `${from} ~ ::${ours}`)
  if (missing.length === 0) return { ours, merge: null }
  const made = await jj(["new", ours, from, "-m", message])
  if (!made.ok) throw new Error(describeFailure("jj new", made))
  const commit = await jj(["commit", "-m", message])
  if (!commit.ok) throw new Error(describeFailure("jj commit", commit))
  const [merge] = await commitsOf(jj, "@-")
  if (merge === undefined) throw new Error("the merge left no parent to read")
  await setBookmark(jj, lane, merge)
  return { ours, merge }
}

/**
 * An empty commit on the lane's bookmark, described `message`: a thread
 * moved to the line when the line has nothing the lane lacks still needs its
 * newest `Pineta-Base` to say so (ADR-0060). Returns it.
 */
export async function markBase(
  jj: Runner,
  lane: LaneName,
  message: string,
): Promise<CommitId> {
  const [ours] = await commitsOf(jj, `bookmarks(exact:"${bookmarkName(lane)}")`)
  if (ours === undefined) throw new Error(`lane ${lane} has no bookmark`)
  const made = await jj(["new", ours, "-m", message])
  if (!made.ok) throw new Error(describeFailure("jj new", made))
  const commit = await jj(["commit", "-m", message])
  if (!commit.ok) throw new Error(describeFailure("jj commit", commit))
  const [mark] = await commitsOf(jj, "@-")
  if (mark === undefined) throw new Error("the mark left no parent to read")
  await setBookmark(jj, lane, mark)
  return mark
}

/**
 * A lane's base as its history says it (ADR-0060): the newest commit in
 * `::rev` whose message carries `Pineta-Base`, read with `jj` (the lane's,
 * or your repo's on the lane's tip). Its value names the bookmark and the
 * commit it pointed at; null for a lane with none, one from before the line.
 */
export async function newestBase(
  jj: Runner,
  rev: string,
): Promise<{
  /** The commit carrying the trailer. */
  readonly at: CommitId
  readonly bookmark: string
  readonly commit: CommitId
} | null> {
  const [at] = await commitsOf(
    jj,
    `latest(heads(::(${rev}) & description(regex:"(?m)^${TRAILERS.base}: ")))`,
  )
  if (at === undefined) return null
  const ran = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    at,
    "-T",
    "description",
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const prefix = `${TRAILERS.base}: `
  const value = lines(ran.stdout)
    .filter(l => l.startsWith(prefix))
    .map(l => l.slice(prefix.length).trim())
    .at(-1)
  const base = value === undefined ? null : parseBase(value)
  return base === null ? null : { at, ...base }
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
