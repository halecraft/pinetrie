// lanes/merge — a thread's base merged into its lane (ADR-0033, ADR-0060).
//
// The lane merges the line's commit, or a fresh copy of its WIP (`planMerge`),
// into itself, in its own repo: jj records conflicts in the merge rather than
// failing (S36 item 11), and the agent resolves them there, never in your
// repo. The merge is committed at once, so it is a revision even when it
// merged cleanly: an empty merge would stay the working copy, which every
// snapshot rewrites. The lane's work comes back to you as its offer, never by
// this merge.

import { type CommitId, type LaneName, TRAILERS } from "@pineta/core"
import { executeOrThrow, type Runners } from "./execute.ts"
import {
  bookmarkName,
  bookmarkRevset,
  type MergePlan,
  parseBase,
} from "./plan.ts"
import {
  changedPaths,
  commitsOf,
  commitToBookmark,
  conflictedFilesAt,
  titlesOf,
} from "./revisions.ts"
import { describeFailure, lines, type Runner } from "./run.ts"

/** The lane's bookmark's commit; throws when it has none. */
async function laneHead(jj: Runner, lane: LaneName): Promise<CommitId> {
  const [ours] = await commitsOf(jj, bookmarkRevset(bookmarkName(lane)))
  if (ours === undefined) throw new Error(`lane ${lane} has no bookmark`)
  return ours
}

/**
 * A new commit on `parents`, described `message`, committed at once, with
 * the lane's bookmark moved to it. Returns it.
 */
async function commitOn(
  jj: Runner,
  lane: LaneName,
  parents: readonly CommitId[],
  message: string,
): Promise<CommitId> {
  const made = await jj(["new", ...parents, "-m", message])
  if (!made.ok) throw new Error(describeFailure("jj new", made))
  return commitToBookmark(jj, lane, message)
}

/**
 * Merge `from` (the line's commit, or a WIP's copy) into the lane at its
 * bookmark, described `message`, and commit the merge. `jj` is the lane's,
 * and must already hold `from`. Returns the lane's revision before the merge
 * (`ours`), and the merge, or null when `from` is already in the lane: there
 * is nothing to merge.
 */
export async function mergeBase(
  jj: Runner,
  lane: LaneName,
  from: CommitId,
  message: string,
): Promise<{ readonly ours: CommitId; readonly merge: CommitId | null }> {
  const ours = await laneHead(jj, lane)
  const missing = await commitsOf(jj, `${from} ~ ::${ours}`)
  if (missing.length === 0) return { ours, merge: null }
  return { ours, merge: await commitOn(jj, lane, [ours, from], message) }
}

/**
 * An empty commit on the lane's bookmark, described `message`: a thread
 * moved to the line when the line has nothing the lane lacks still needs its
 * newest `Pineta-Base` to say so (ADR-0060). Returns it.
 */
async function markBase(
  jj: Runner,
  lane: LaneName,
  message: string,
): Promise<CommitId> {
  return commitOn(jj, lane, [await laneHead(jj, lane)], message)
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

/**
 * Of a merge's `conflicted` files, those its two sides hold alike: not among
 * the files that `differ` between them. Pure.
 */
export const heldAlike = (
  conflicted: readonly string[],
  differ: readonly string[],
): readonly string[] => {
  const differing = new Set(differ)
  return conflicted.filter(f => !differing.has(f))
}

/** `files` restored from `from` into `into`, rewriting it; the bookmark on it follows. */
async function restoreInto(
  jj: Runner,
  from: CommitId,
  into: CommitId,
  files: readonly string[],
): Promise<void> {
  const ran = await jj([
    "restore",
    "--from",
    from,
    "--into",
    into,
    ...files.map(f => `root-file:${JSON.stringify(f)}`),
  ])
  if (!ran.ok) throw new Error(describeFailure("jj restore", ran))
}

/** The files with conflicts in the lane's working copy. */
export async function conflictsIn(jj: Runner): Promise<string[]> {
  const snap = await jj(["util", "snapshot"])
  if (!snap.ok) throw new Error(describeFailure("jj util snapshot", snap))
  return conflictedFilesAt(jj, "@")
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

/** A revision on one side of a merge, and the files it touched of those asked about. */
export interface TouchedRevision {
  readonly description: string
  readonly paths: readonly string[]
}

/**
 * The revisions in `range` that touched any of `files`, oldest first, each
 * with the ones of `files` it touched: one `jj log`, a JSON object per line,
 * as `REVISION_READ` (`revisions.ts`). Its paths are from the repo's root (S83).
 */
export async function revisionsIn(
  jj: Runner,
  range: string,
  files: readonly string[],
): Promise<TouchedRevision[]> {
  if (files.length === 0) return []
  const fileset = files.map(f => `root:${JSON.stringify(f)}`).join(" | ")
  const ran = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "--reversed",
    "-r",
    range,
    "-T",
    `"{\\"description\\":" ++ json(description) ++ ",\\"paths\\":[" ++ self.diff(${JSON.stringify(fileset)}).files().map(|f| json(f.path())).join(",") ++ "]}\\n"`,
    fileset,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  return lines(ran.stdout).map(line => JSON.parse(line) as TouchedRevision)
}

/** What an update found in the lane after its merge (`mergeUpdate`). */
export type Merged =
  /**
   * Nothing to merge. `mark` is the commit naming the line, when the plan
   * asked for one, made on `ours`.
   */
  | {
      readonly kind: "nothing"
      readonly ours: CommitId
      readonly mark: CommitId | null
    }
  | {
      readonly kind: "clean"
      /** The commit merged: the line's, or the WIP's copy. */
      readonly from: CommitId
      /** The lane's revision before the merge. */
      readonly ours: CommitId
      readonly merge: CommitId
      /** The files the merge changed under the lane. */
      readonly files: readonly string[]
      /** The titles of the commits that came in (`MergePlan.came`). */
      readonly commits: readonly string[]
    }
  | {
      readonly kind: "conflicted"
      readonly from: CommitId
      /** Each conflicted file, with jj's markers. */
      readonly contents: readonly {
        readonly path: string
        readonly content: string
      }[]
      /** The revisions on each side that touched any conflicted file, oldest first. */
      readonly ours: readonly TouchedRevision[]
      readonly theirs: readonly TouchedRevision[]
    }

/**
 * An update in a lane, after its edits are committed (ADR-0060): `plan`'s
 * steps, the merge, a mark when the plan asks and nothing merged, then what
 * the merge left. The caller runs it on the lane's queue.
 */
export async function mergeUpdate(
  jj: Runner,
  runners: Runners,
  lane: LaneName,
  plan: MergePlan,
): Promise<Merged> {
  await executeOrThrow(plan.steps, runners)
  const [from] =
    plan.source === "copy" ? await commitsOf(jj, "@-") : [plan.source]
  if (from === undefined) throw new Error("the WIP's copy is missing")
  const { ours, merge: made } = await mergeBase(jj, lane, from, plan.message)
  if (made === null)
    return {
      kind: "nothing",
      ours,
      mark: plan.mark ? await markBase(jj, lane, plan.message) : null,
    }
  let merge = made
  let conflicted = await conflictsIn(jj)
  // A file both sides hold alike is merged whatever the base says: jj keeps
  // a conflict when the base is itself conflicted, as when a branch and the
  // thread it was cloned from resolved the same conflict alike (S99).
  const alike = heldAlike(conflicted, await changedPaths(jj, ours, from))
  if (alike.length > 0) {
    await restoreInto(jj, from, merge, alike)
    merge = await laneHead(jj, lane)
    conflicted = await conflictsIn(jj)
  }
  if (conflicted.length === 0)
    return {
      kind: "clean",
      from,
      ours,
      merge,
      files: await changedPaths(jj, ours, merge),
      commits: await titlesOf(jj, `${plan.came.from ?? ours}..${plan.came.to}`),
    }
  const contents: { path: string; content: string }[] = []
  for (const path of conflicted)
    contents.push({ path, content: await conflictContent(jj, path) })
  return {
    kind: "conflicted",
    from,
    contents,
    ours: await revisionsIn(jj, `${from}..${ours}`, conflicted),
    theirs: await revisionsIn(jj, `${ours}..${from}`, conflicted),
  }
}
