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
  type CopyFacts,
  commitId,
  type EntryId,
  type LaneName,
  revisionMessage,
} from "@pinetrie/core"
import { bookmarkOf, setBookmark } from "./bookmarks.ts"
import {
  LANE_CONFIG_DIR,
  OLD_LANE_CONFIG_DIR,
  type OldNamesOnDisk,
  planTurnCommit,
} from "./plan.ts"
import { describeFailure, laneJj, lines, type Runner } from "./run.ts"

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
 * An integrated-offer commit on the line as `INTEGRATED_OFFER_COMMIT_ROW`
 * prints it: its commit, and its message whole. Your repo reads the
 * integrated-offer commits on the line with it (`@pinetrie/repo`), and a lane
 * those it lacks before it catches up (`integratedOfferCommitsAbove`).
 */
export interface IntegratedOfferCommitRow {
  readonly commit: CommitId
  readonly description: string
}

/** One integrated-offer commit a line: its commit, a tab, and its message as a JSON string. */
export const INTEGRATED_OFFER_COMMIT_ROW =
  'commit_id ++ "\\t" ++ json(description) ++ "\\n"'

/** `INTEGRATED_OFFER_COMMIT_ROW`'s output, read back. */
export function parseIntegratedOfferCommits(
  stdout: string,
): IntegratedOfferCommitRow[] {
  return lines(stdout).map(row => {
    const tab = row.indexOf("\t")
    return {
      commit: commitId(row.slice(0, tab)),
      description: JSON.parse(row.slice(tab + 1)) as string,
    }
  })
}

/** Whether `ancestor` is `commit` or one of its ancestors. */
const isAncestor = async (
  jj: Runner,
  ancestor: CommitId,
  commit: CommitId,
): Promise<boolean> =>
  (await commitsOf(jj, `${ancestor} & ::${commit}`)).length > 0

/** A turn's revision (`commitTurn`), and whether it, or the bookmark when it has none, is conflicted. */
export interface TurnCommitted {
  readonly commit: CommitId | null
  readonly conflicted: boolean
}

/**
 * Snapshot the lane's working copy and record the turn's revision: what
 * changed in `@`, committed, or a commit the agent made itself
 * (`planTurnCommit`). Move the lane's bookmark to it and return it; null when
 * the turn has none. `bookmark` is the lane's bookmark as the caller read it.
 * The one `jj log` also says whether the turn's commit, or the bookmark when
 * there is none, is conflicted (ADR-0072).
 */
export async function commitTurn(
  jj: Runner,
  input: {
    readonly title: string
    readonly entry: EntryId
    readonly lane: LaneName
    readonly bookmark: CommitId | null
  },
): Promise<TurnCommitted> {
  const snap = await jj(["util", "snapshot"])
  if (!snap.ok) throw new Error(describeFailure("jj util snapshot", snap))
  const at = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    "@",
    "-T",
    'empty ++ " " ++ conflict ++ "\\n" ++ parents.map(|c| c.commit_id() ++ " " ++ c.conflict()).join("\\n") ++ "\\n"',
  ])
  if (!at.ok) throw new Error(describeFailure("jj log", at))
  const [head = "", ...parentRows] = lines(at.stdout)
  const [empty, atConflict] = head.split(" ")
  const atEmpty = empty === "true"
  const parentFlags = new Map(
    parentRows.map(row => {
      const [id = "", flag] = row.split(" ")
      return [commitId(id), flag === "true"] as const
    }),
  )
  const parents = [...parentFlags.keys()]
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
  if (plan.kind === "none")
    return {
      commit: null,
      conflicted: bookmark !== null && parentFlags.get(bookmark) === true,
    }
  if (plan.kind === "adopt") {
    await setBookmark(jj, input.lane, plan.commit)
    return {
      commit: plan.commit,
      conflicted: parentFlags.get(plan.commit) === true,
    }
  }
  return {
    commit: await commitToBookmark(jj, input.lane, revisionMessage(input)),
    conflicted: atConflict === "true",
  }
}

/**
 * Where the lane's working copy sits against its bookmark (ADR-0080), after
 * a snapshot: `@`'s parents, the bookmark, and whether the one parent
 * descends from it, asked only when it is not the bookmark itself.
 */
export async function copyFacts(
  jj: Runner,
  lane: LaneName,
): Promise<CopyFacts> {
  const at = await jj([
    "log",
    "--no-graph",
    "-r",
    "@",
    "-T",
    'parents.map(|c| c.commit_id()).join("\\n") ++ "\\n"',
  ])
  if (!at.ok) throw new Error(describeFailure("jj log", at))
  const parents = lines(at.stdout).map(commitId)
  const bookmark = await bookmarkOf(jj, lane)
  const [parent] = parents
  const descends =
    parents.length === 1 &&
    parent !== undefined &&
    bookmark !== null &&
    parent !== bookmark
      ? await isAncestor(jj, bookmark, parent)
      : false
  return { parents, bookmark, descends }
}

/**
 * pre-rename: what `planOldNamesOnDisk` plans from, read through the lane's
 * runner: which config folders exist, and every bookmark. Neither read
 * snapshots the working copy.
 */
export async function oldNamesOnDisk(lane: Runner): Promise<OldNamesOnDisk> {
  const dirs = await lane([
    "sh",
    "-c",
    `test -d ${OLD_LANE_CONFIG_DIR} && echo old; test -d ${LANE_CONFIG_DIR} && echo current; true`,
  ])
  if (!dirs.ok) throw new Error(describeFailure("test -d", dirs))
  const found = lines(dirs.stdout)
  const listed = await laneJj(lane)([
    "--ignore-working-copy",
    "bookmark",
    "list",
    "-T",
    'name ++ "\n"',
  ])
  if (!listed.ok) throw new Error(describeFailure("jj bookmark list", listed))
  return {
    configDir: {
      old: found.includes("old"),
      current: found.includes("current"),
    },
    bookmarks: [...new Set(lines(listed.stdout))],
  }
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
 * A diff entry's path, from the repo's root, as one JSON string a line:
 * `--name-only` prints paths from the process's directory, and `json()`
 * quotes a path with any character in it (S70).
 */
export const PATH_LINE = 'json(path) ++ "\\n"'

/**
 * The paths changed from `from` to `to`, from the repo's root; those `to`
 * changed when there is no `from` (ADR-0056). Read with jj, not git: git
 * reads a conflicted commit as every side's whole tree under
 * `.jjconflict-*` (S99).
 */
export async function changedPaths(
  jj: Runner,
  from: CommitId | null,
  to: CommitId,
): Promise<readonly string[]> {
  const range = from === null ? ["-r", to] : ["--from", from, "--to", to]
  const ran = await jj(["diff", ...range, "-T", PATH_LINE])
  if (!ran.ok) throw new Error(describeFailure("jj diff", ran))
  return lines(ran.stdout).map(line => String(JSON.parse(line)))
}

/** The files with conflicts in `rev`. */
export async function conflictedFilesAt(
  jj: Runner,
  rev: string,
): Promise<string[]> {
  const ran = await jj([
    "file",
    "list",
    "-r",
    rev,
    "-T",
    'if(conflict, path ++ "\\n")',
  ])
  if (!ran.ok) throw new Error(describeFailure("jj file list", ran))
  return lines(ran.stdout)
}

/**
 * A revision's description and per-file stats, printed as the JSON of
 * `RevisionReview` (`@pinetrie/core`): `json()` quotes every string (S57). A
 * change to it bumps `OFFER_WIRE` (`@pinetrie/rules`).
 */
export const REVISION_READ =
  '"{\\"description\\":" ++ json(description) ++ ",\\"files\\":[" ++ ' +
  'self.diff().stat().files().map(|f| "{\\"path\\":" ++ json(f.path()) ++ ' +
  '",\\"shown\\":" ++ json(f.display_diff_path()) ++ ",\\"change\\":" ++ json(f.status()) ++ ' +
  '",\\"added\\":" ++ f.lines_added() ++ ",\\"removed\\":" ++ f.lines_removed() ++ "}").join(",") ++ ' +
  '"]}"'
