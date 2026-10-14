// lanes/merge — a thread's base merged into its lane.
//
// The lane merges accepted work's commit, or a fresh copy of its WIP (`planMerge`),
// into itself, in its own repo: jj records conflicts in the merge rather than
// failing, and the agent resolves them there, never in your
// repo. An accepted-offer commit on accepted work is a copy of a lane's work, so
// each one the lane holds a source of is first joined to it (`planJoins`):
// merged as history says, the lane's own work would come in twice.
// The merge is committed at once, so it is a revision even when it merged
// cleanly: an empty merge would stay the working copy, which every
// snapshot rewrites. The lane's work comes back to you as its offer, never by
// this merge.

import {
  type BaseTrailer,
  baseOf,
  type CommitId,
  sourcesOf,
  type ThreadId,
  trailerRevset,
} from "@pinetrie/core"
import {
  describeFailure,
  executeOrThrow,
  type LaneRunners,
  lines,
  type Merged,
  type Runner,
  type TouchedRevision,
} from "@pinetrie/lanes"
import { bookmarkName, bookmarkRevset } from "./names.ts"
import {
  type AcceptedOfferCommitAbove,
  type Join,
  type MergePlan,
  planJoins,
} from "./plan.ts"
import {
  ACCEPTED_OFFER_COMMIT_ROW,
  changedPaths,
  commitsOf,
  commitToBookmark,
  conflictedFilesAt,
  parseAcceptedOfferCommits,
  titlesOf,
} from "./revisions.ts"

/** The lane's bookmark's commit; throws when it has none. */
async function laneHead(jj: Runner, lane: ThreadId): Promise<CommitId> {
  const [ours] = await commitsOf(jj, bookmarkRevset(bookmarkName(lane)))
  if (ours === undefined) throw new Error(`lane ${lane} has no bookmark`)
  return ours
}

/** The lane's working copy moved to a new commit on `parents`, described `message`. Returns it. */
async function newOn(
  jj: Runner,
  parents: readonly CommitId[],
  message: string,
): Promise<CommitId> {
  const made = await jj(["new", ...parents, "-m", message])
  if (!made.ok) throw new Error(describeFailure("jj new", made))
  const [at] = await commitsOf(jj, "@")
  if (at === undefined) throw new Error("jj new left no working copy")
  return at
}

/**
 * A new commit on `parents`, described `message`, committed at once, with
 * the lane's bookmark moved to it. Returns it.
 */
async function commitOn(
  jj: Runner,
  lane: ThreadId,
  parents: readonly CommitId[],
  message: string,
): Promise<CommitId> {
  await newOn(jj, parents, message)
  return commitToBookmark(jj, lane, message)
}

/**
 * What `planJoins` decides from: the accepted-offer commits in `from`'s history the lane at
 * `ours` lacks, oldest first, each with the sources its message names; and
 * which of those sources the lane holds. A source is read with `present()`:
 * one may never have reached the lane.
 */
async function acceptedOfferCommitsAbove(
  jj: Runner,
  ours: CommitId,
  from: CommitId,
): Promise<{
  readonly accepted: readonly AcceptedOfferCommitAbove[]
  readonly held: ReadonlySet<CommitId>
}> {
  const ran = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "--reversed",
    "-r",
    `(::${from} ~ ::${ours}) & ${trailerRevset(["source"])}`,
    "-T",
    ACCEPTED_OFFER_COMMIT_ROW,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const accepted = parseAcceptedOfferCommits(ran.stdout).map(t => ({
    acceptedOfferCommit: t.commit,
    sources: sourcesOf(t.description),
  }))
  const named = [...new Set(accepted.flatMap(t => t.sources))]
  if (named.length === 0) return { accepted, held: new Set() }
  const held = await commitsOf(
    jj,
    `(${named.map(s => `present(${s})`).join(" | ")}) & ::${ours}`,
  )
  return { accepted, held: new Set(held) }
}

/**
 * Each join made in the lane, in order, each on the last one kept: a merge of
 * the accepted-offer commit with the sources the lane holds. A join that
 * conflicts (an acceptance of an offer you edited where the lane wrote) is
 * abandoned, and that accepted-offer commit is merged as before. jj says a
 * join conflicts only once it is made, so this is decided here, after it.
 * Returns the last join kept, and the accepted-offer commits joined.
 */
async function joinAcceptedOfferCommits(
  jj: Runner,
  joins: readonly Join[],
): Promise<{
  readonly last: CommitId | null
  readonly joined: readonly CommitId[]
}> {
  let last: CommitId | null = null
  const joined: CommitId[] = []
  for (const join of joins) {
    const at = await newOn(
      jj,
      [
        ...join.sources,
        join.acceptedOfferCommit,
        ...(last === null ? [] : [last]),
      ],
      join.message,
    )
    if ((await commitsOf(jj, `${at} & conflicts()`)).length > 0) {
      const dropped = await jj(["abandon", at])
      if (!dropped.ok) throw new Error(describeFailure("jj abandon", dropped))
      continue
    }
    last = at
    joined.push(join.acceptedOfferCommit)
  }
  return { last, joined }
}

/**
 * Merge `from` (accepted work's commit, a WIP's copy, or the parent's newest) into
 * the lane at its bookmark, described `message`, and commit the merge. `jj`
 * is the lane's, and must already hold `from`. Each accepted-offer commit in `from`'s history
 * that names a source the lane holds is first joined to it (`planJoins`),
 * and the merge is one commit on the lane, the last join if any,
 * and `from`.
 * Returns the lane's revision before the merge (`ours`), the merge, or null
 * when `from` is already in the lane (nothing to merge), and the
 * accepted-offer commits joined.
 */
export async function mergeBase(
  jj: Runner,
  lane: ThreadId,
  from: CommitId,
  message: string,
): Promise<{
  readonly ours: CommitId
  readonly merge: CommitId | null
  readonly joined: readonly CommitId[]
}> {
  // gather
  const ours = await laneHead(jj, lane)
  const missing = await commitsOf(jj, `${from} ~ ::${ours}`)
  if (missing.length === 0) return { ours, merge: null, joined: [] }
  const { accepted, held } = await acceptedOfferCommitsAbove(jj, ours, from)
  // plan
  const joins = planJoins(accepted, held)
  // execute
  const { last, joined } = await joinAcceptedOfferCommits(jj, joins)
  const parents = [ours, ...(last === null ? [] : [last]), from]
  return { ours, merge: await commitOn(jj, lane, parents, message), joined }
}

/**
 * An empty commit on the lane's bookmark, described `message`: a thread
 * moved to accepted work when accepted work has nothing the lane lacks still needs its
 * newest `Pinetrie-Base` to say so. Returns it.
 */
async function markBase(
  jj: Runner,
  lane: ThreadId,
  message: string,
): Promise<CommitId> {
  return commitOn(jj, lane, [await laneHead(jj, lane)], message)
}

/**
 * A lane's base as its history says it: the newest commit in
 * `::rev` whose message carries a base trailer, read with `jj` (the lane's,
 * or your repo's on the lane's tip). Its value names accepted work, or a WIP
 * by its bookmark (`baseOf`, by `wipPrefix`), and the commit it pointed at;
 * null for a lane with none, one from before accepted work.
 */
export async function newestBase(
  jj: Runner,
  rev: string,
  wipPrefix: string,
): Promise<
  | ({
      /** The commit carrying the trailer. */ readonly at: CommitId
    } & BaseTrailer)
  | null
> {
  const [at] = await commitsOf(
    jj,
    `latest(heads(::(${rev}) & ${trailerRevset(["base"])}))`,
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
  const base = baseOf(ran.stdout, wipPrefix)
  return base === null ? null : { at, ...base }
}

/**
 * Of a merge's `conflicted` files, those its two sides hold alike: not among
 * the files that `differ` between them.
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

/**
 * The revisions in `range` that touched any of `files`, oldest first, each
 * with the ones of `files` it touched: one `jj log`, a JSON object per line,
 * as `REVISION_READ` (`revisions.ts`). Its paths are from the repo's root.
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

/**
 * `range` without the accepted-offer commits an update joined: each is the
 * lane's own work, as a copy, so it did not come in. Only those commits go: accepted work's
 * commits under them did come in, which `(<ours> | <join>)..<to>` would also
 * drop.
 */
const withoutAcceptedOfferCommits = (
  range: string,
  joined: readonly CommitId[],
): string =>
  joined.length === 0 ? range : `(${range}) ~ (${joined.join(" | ")})`

/**
 * An update in a lane, after its edits are committed: `plan`'s
 * steps, the accepted-offer commits it holds joined and the merge (`mergeBase`), a mark when
 * the plan asks and nothing merged, then what the merge left. The caller
 * runs it on the lane's queue.
 */
export async function mergeUpdate(
  jj: Runner,
  runners: LaneRunners,
  lane: ThreadId,
  plan: MergePlan,
): Promise<Merged> {
  await executeOrThrow(plan.steps, runners)
  const [from] =
    plan.source === "copy" ? await commitsOf(jj, "@-") : [plan.source]
  if (from === undefined) throw new Error("the WIP's copy is missing")
  const {
    ours,
    merge: made,
    joined,
  } = await mergeBase(jj, lane, from, plan.message)
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
  // thread it was cloned from resolved the same conflict alike.
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
      commits: await titlesOf(
        jj,
        withoutAcceptedOfferCommits(
          `${plan.came.from ?? ours}..${plan.came.to}`,
          joined,
        ),
      ),
    }
  const contents: { path: string; content: string }[] = []
  for (const path of conflicted)
    contents.push({ path, content: await conflictContent(jj, path) })
  return {
    kind: "conflicted",
    from,
    contents,
    ours: await revisionsIn(jj, `${from}..${ours}`, conflicted),
    theirs: await revisionsIn(
      jj,
      withoutAcceptedOfferCommits(`${ours}..${from}`, joined),
      conflicted,
    ),
  }
}
