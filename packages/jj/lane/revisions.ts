// lanes/revisions — a turn's files, committed.
//
// After a message's tool calls, and at a run's first request, the host
// commits whatever changed in the lane's repo: one revision per turn that
// changed tracked files, described with the message's first line and
// trailers naming the entry and lane. A commit the agent made itself in the
// turn is the turn's revision instead, without trailers. The lane's bookmark moves to it.

import {
  type CommitId,
  type CopyFacts,
  commitId,
  type EntryId,
  revisionMessage,
  type ThreadId,
} from "@pinetrie/core"
import {
  describeFailure,
  LANE_CONFIG_DIR,
  lines,
  OLD_LANE_CONFIG_DIR,
  type Runner,
  type TurnCommittedOf,
} from "@pinetrie/lanes"
import { readLaneBookmark, setBookmark } from "./bookmarks.ts"
import {
  bookmarkName,
  bookmarkRevset,
  type RevsetQuery,
  revsetAliased,
  stackBookmark,
} from "./names.ts"
import { type OldNamesOnDisk, planTurnCommit } from "./plan.ts"
import { laneJj } from "./run.ts"
/** The commit ids a revset, or a revset with its aliases, names, in jj's order. */
export async function readCommits(
  jj: Runner,
  query: string | RevsetQuery,
): Promise<CommitId[]> {
  const { revset, aliases } =
    typeof query === "string" ? { revset: query, aliases: {} } : query
  const ran = await jj(
    revsetAliased(
      [
        "log",
        "--ignore-working-copy",
        "--no-graph",
        "-r",
        revset,
        "-T",
        'commit_id ++ "\\n"',
      ],
      aliases,
    ),
  )
  if (!ran.ok) throw new Error(describeFailure(`jj log -r ${revset}`, ran))
  return lines(ran.stdout).map(commitId)
}

/**
 * An accepted thread commit on accepted work as `ACCEPTED_THREAD_COMMIT_ROW`
 * prints it: its commit, and its message whole. Your repo reads the
 * accepted thread commits on accepted work with it (`@pinetrie/jj`), and a lane
 * those it lacks before it catches up (`acceptedThreadCommitsAbove`).
 */
export interface AcceptedThreadCommitRow {
  readonly commit: CommitId
  readonly description: string
}

/** One accepted thread commit a line: its commit, a tab, and its message as a JSON string. */
export const ACCEPTED_THREAD_COMMIT_ROW =
  'commit_id ++ "\\t" ++ json(description) ++ "\\n"'

/** `ACCEPTED_THREAD_COMMIT_ROW`'s output, read back. */
export function parseAcceptedThreadCommits(
  stdout: string,
): AcceptedThreadCommitRow[] {
  return lines(stdout).map(row => {
    const tab = row.indexOf("\t")
    return {
      commit: commitId(row.slice(0, tab)),
      description: JSON.parse(row.slice(tab + 1)) as string,
    }
  })
}

/** Whether `ancestor` is `commit` or one of its ancestors, in the repo `jj` runs in. */
export const isAncestor = async (
  jj: Runner,
  ancestor: CommitId,
  commit: CommitId,
): Promise<boolean> =>
  (await readCommits(jj, `${ancestor} & ::${commit}`)).length > 0

/**
 * Snapshot the lane's working copy and record the turn's revision: what
 * changed in `@`, committed, or a commit the agent made itself
 * (`planTurnCommit`). Move the lane's bookmark to it and return it; null when
 * the turn has none. `bookmark` is the lane's bookmark as the caller read it.
 * The one `jj log` also says whether the turn's commit, or the bookmark when
 * there is none, is conflicted.
 */
export async function commitTurn(
  jj: Runner,
  input: {
    readonly title: string
    readonly entry: EntryId
    readonly lane: ThreadId
    readonly bookmark: CommitId | null
  },
): Promise<TurnCommittedOf<CommitId>> {
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
      point: null,
      conflicted: bookmark !== null && parentFlags.get(bookmark) === true,
    }
  if (plan.kind === "adopt") {
    await setBookmark(jj, input.lane, plan.commit)
    return {
      point: plan.commit,
      conflicted: parentFlags.get(plan.commit) === true,
    }
  }
  return {
    point: await commitToBookmark(jj, input.lane, revisionMessage(input)),
    conflicted: atConflict === "true",
  }
}

/**
 * Where the lane's working copy sits against its bookmark, after
 * a snapshot: `@`'s parents, the bookmark, and whether the one parent
 * descends from it, asked only when it is not the bookmark itself.
 */
export async function copyFacts(
  jj: Runner,
  lane: ThreadId,
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
  const bookmark = await readLaneBookmark(jj, lane)
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
  lane: ThreadId,
  message: string,
): Promise<CommitId> {
  const commit = await jj(["commit", "-m", message])
  if (!commit.ok) throw new Error(describeFailure("jj commit", commit))
  const [id] = await readCommits(jj, "@-")
  if (id === undefined) throw new Error("jj commit made no parent to read")
  await setBookmark(jj, lane, id)
  return id
}

/** The first line of each description in `revset`, in jj's order; empty ones dropped. */
export async function readTitles(
  jj: Runner,
  revset: string,
): Promise<string[]> {
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
 * quotes a path with any character in it.
 */
export const PATH_LINE = 'json(path) ++ "\\n"'

/**
 * The paths changed from `from` to `to`, from the repo's root; those `to`
 * changed when there is no `from`. Read with jj, not git: git reads a
 * conflicted commit as every side's whole tree under `.jjconflict-*`.
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
export async function readConflictedFiles(
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
 * A revision's description and per-file stats, printed as JSON:
 * `json()` quotes every string. Each file's `delta` is its `bytes_delta()`,
 * from which a review's reader has a binary's size (`JjStatSize`). A change
 * to it bumps `REVIEW_WIRE` (`@pinetrie/rules`).
 */
export const REVISION_READ =
  '"{\\"description\\":" ++ json(description) ++ ",\\"files\\":[" ++ ' +
  'self.diff().stat().files().map(|f| "{\\"path\\":" ++ json(f.path()) ++ ' +
  '",\\"shown\\":" ++ json(f.display_diff_path()) ++ ",\\"change\\":" ++ json(f.status()) ++ ' +
  '",\\"added\\":" ++ f.lines_added() ++ ",\\"removed\\":" ++ f.lines_removed() ++ ' +
  '",\\"delta\\":" ++ f.bytes_delta() ++ "}").join(",") ++ ' +
  '"]}"'

/** `path`'s text at `rev` of the repo `jj` reads; null when it has no such file. */
export async function fileText(
  jj: Runner,
  rev: string,
  path: string,
): Promise<string | null> {
  const shown = await jj([
    "file",
    "show",
    "--ignore-working-copy",
    "-r",
    rev,
    `root:${JSON.stringify(path)}`,
  ])
  return shown.ok ? shown.stdout : null
}

/**
 * The bookmark a fetch bundles, when the lane's repo has it: the lane's own
 * (`bookmarkName`), or with `stack` its split's stack (`stackBookmark`).
 * Null when it has none: nothing to fetch.
 */
export async function readFetchBookmark(
  jj: Runner,
  lane: ThreadId,
  stack: boolean,
): Promise<string | null> {
  const name = stack ? stackBookmark(lane) : bookmarkName(lane)
  const [commit] = await readCommits(jj, `present(${bookmarkRevset(name)})`)
  return commit === undefined ? null : name
}
