// lanes/revisions — a turn's files, committed (ADR-0032).
//
// After a message's tool calls, and at a run's first request, the host
// commits whatever changed in the lane's repo: one revision per turn that
// changed tracked files, described with the message's first line and
// trailers naming the entry and lane (ADR-0033 reads them back). The lane's
// bookmark moves to it.

import {
  type CommitId,
  commitId,
  type EntryId,
  type LaneName,
  type YoursNow,
} from "@pineta/core"
import { setBookmark } from "./bookmarks.ts"
import { describeFailure, lines, type Runner } from "./run.ts"

const ENTRY_TRAILER = "Pineta-Entry"
const LANE_TRAILER = "Pineta-Lane"

/** A revision's description: its title, then the trailers. */
export const revisionMessage = (input: {
  readonly title: string
  readonly entry: EntryId
  readonly lane: LaneName
}): string =>
  `${input.title}\n\n${ENTRY_TRAILER}: ${input.entry}\n${LANE_TRAILER}: ${input.lane}\n`

/** The entry a revision's description names, or null. */
export function entryOfMessage(description: string): string | null {
  const prefix = `${ENTRY_TRAILER}: `
  const line = lines(description).find(l => l.startsWith(prefix))
  return line === undefined ? null : line.slice(prefix.length).trim()
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

/**
 * Snapshot the lane's working copy; if anything tracked changed, commit it as
 * a revision, move the lane's bookmark to it, and return it. Null when
 * nothing changed.
 */
export async function commitTurn(
  jj: Runner,
  input: {
    readonly title: string
    readonly entry: EntryId
    readonly lane: LaneName
  },
): Promise<CommitId | null> {
  const snap = await jj(["util", "snapshot"])
  if (!snap.ok) throw new Error(describeFailure("jj util snapshot", snap))
  const empty = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    "@",
    "-T",
    "empty",
  ])
  if (!empty.ok) throw new Error(describeFailure("jj log", empty))
  if (empty.stdout.trim() === "true") return null
  const commit = await jj(["commit", "-m", revisionMessage(input)])
  if (!commit.ok) throw new Error(describeFailure("jj commit", commit))
  const [id] = await commitsOf(jj, "@-")
  if (id === undefined) throw new Error("jj commit made no parent to read")
  await setBookmark(jj, input.lane, id)
  return id
}

/** Your `@-`: what the base snapshot is made from. */
export const yoursNow = (jj: Runner): Promise<CommitId[]> => commitsOf(jj, "@-")

/**
 * Your `@` as it is now, and its parents: what a copy of it is made from
 * (ADR-0038). `jj` must snapshot your working copy (`hostJj`, not
 * `hostOps`): the copy must hold the edits you have not committed.
 */
export async function yoursAt(jj: Runner): Promise<YoursNow> {
  const snap = await jj(["util", "snapshot"])
  if (!snap.ok) throw new Error(describeFailure("jj util snapshot", snap))
  const [at] = await commitsOf(jj, "@")
  if (at === undefined) throw new Error("your repo has no @")
  return { at, parents: await commitsOf(jj, "@-") }
}
