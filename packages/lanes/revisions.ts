// lanes/revisions — a turn's files, committed (ADR-0032).
//
// After a message's tool calls, and at a run's first request, the host
// commits whatever changed in the lane's repo: one revision per turn that
// changed tracked files, described with the message's first line and
// trailers naming the entry and lane (ADR-0033 reads them back). A commit the
// agent made itself in the turn is the turn's revision instead, without
// trailers (S56). The lane's bookmark moves to it.

import {
  type CommitId,
  commitId,
  type EntryId,
  entryId,
  type LaneName,
  TRAILERS,
  WORKSPACE_ROOT,
} from "@pineta/core"
import { setBookmark } from "./bookmarks.ts"
import { planTurnCommit } from "./plan.ts"
import { describeFailure, lines, type Runner } from "./run.ts"

/** A revision's description: its title, then the trailers. */
export const revisionMessage = (input: {
  readonly title: string
  readonly entry: EntryId
  readonly lane: LaneName
}): string =>
  `${input.title}\n\n${TRAILERS.entry}: ${input.entry}\n${TRAILERS.lane}: ${input.lane}\n`

/** The entry a revision's description names, or null. */
export function entryOfMessage(description: string): EntryId | null {
  const prefix = `${TRAILERS.entry}: `
  const line = lines(description).find(l => l.startsWith(prefix))
  return line === undefined ? null : entryId(line.slice(prefix.length).trim())
}

/** The commit ids a revset names, in jj's order. */
export async function commitsOf(
  jj: Runner,
  revset: string,
): Promise<CommitId[]> {
  const ran = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    revset,
    "-T",
    'commit_id ++ "\\n"',
  ])
  if (!ran.ok) throw new Error(describeFailure(`jj log -r ${revset}`, ran))
  return lines(ran.stdout).map(commitId)
}

/** Whether `ancestor` is `commit` or one of its ancestors. */
const isAncestor = async (
  jj: Runner,
  ancestor: CommitId,
  commit: CommitId,
): Promise<boolean> =>
  (await commitsOf(jj, `${ancestor} & ::${commit}`)).length > 0

/**
 * Snapshot the lane's working copy and record the turn's revision: what
 * changed in `@`, committed, or a commit the agent made itself
 * (`planTurnCommit`). Move the lane's bookmark to it and return it; null when
 * the turn has none. `bookmark` is the lane's bookmark as the caller read it.
 */
export async function commitTurn(
  jj: Runner,
  input: {
    readonly title: string
    readonly entry: EntryId
    readonly lane: LaneName
    readonly bookmark: CommitId | null
  },
): Promise<CommitId | null> {
  const snap = await jj(["util", "snapshot"])
  if (!snap.ok) throw new Error(describeFailure("jj util snapshot", snap))
  const at = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    "@",
    "-T",
    'empty ++ "\\n" ++ parents.map(|c| c.commit_id()).join("\\n") ++ "\\n"',
  ])
  if (!at.ok) throw new Error(describeFailure("jj log", at))
  const [empty, ...parentIds] = lines(at.stdout)
  const atEmpty = empty === "true"
  const parents = parentIds.map(commitId)
  const { bookmark } = input
  // Asked only when the plan could adopt: before most requests the turn
  // changed nothing, and `@-` is the bookmark.
  const [parent] = parents
  const parentDescends =
    atEmpty &&
    parents.length === 1 &&
    parent !== undefined &&
    bookmark !== null &&
    parent !== bookmark
      ? await isAncestor(jj, bookmark, parent)
      : false
  const plan = planTurnCommit({ atEmpty, parents, bookmark, parentDescends })
  if (plan.kind === "none") return null
  if (plan.kind === "adopt") {
    await setBookmark(jj, input.lane, plan.commit)
    return plan.commit
  }
  return commitToBookmark(jj, input.lane, revisionMessage(input))
}

/**
 * Commit the lane's working copy, described `message`, and move the lane's
 * bookmark to the commit. Returns it.
 */
export async function commitToBookmark(
  jj: Runner,
  lane: LaneName,
  message: string,
): Promise<CommitId> {
  const commit = await jj(["commit", "-m", message])
  if (!commit.ok) throw new Error(describeFailure("jj commit", commit))
  const [id] = await commitsOf(jj, "@-")
  if (id === undefined) throw new Error("jj commit made no parent to read")
  await setBookmark(jj, lane, id)
  return id
}

/** The first line of each description in `revset`, in jj's order; empty ones dropped. */
export async function titlesOf(jj: Runner, revset: string): Promise<string[]> {
  const ran = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    revset,
    "-T",
    'description.first_line() ++ "\\n"',
  ])
  if (!ran.ok) throw new Error(describeFailure(`jj log -r ${revset}`, ran))
  return lines(ran.stdout)
}

/**
 * The paths changed from `from` to `to` in the lane's repo, from its root;
 * from `to`'s parent when there is no `from` (ADR-0056): read with git, since jj's `--name-only` prints them from the
 * process's directory, and with `-z`, since git quotes a path with
 * non-ASCII characters otherwise (S70). `lane` runs in the lane, as
 * `LaneHandle.runners.lane` does.
 */
export async function changedPaths(
  lane: Runner,
  from: CommitId | null,
  to: CommitId,
): Promise<readonly string[]> {
  const ran = await lane([
    "git",
    "-C",
    WORKSPACE_ROOT,
    "diff",
    "--name-only",
    "-z",
    from ?? `${to}^`,
    to,
  ])
  if (!ran.ok) throw new Error(describeFailure("git diff --name-only", ran))
  return ran.stdout.split("\0").filter(p => p !== "")
}
