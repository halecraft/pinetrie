// What every lane's refresh reads, read once per operation: an operation id
// names the repo exactly, so the owner keeps one set until the head moves.
// Accepted work's record reads more (`acceptedFacts`), and the owner keeps it
// apart, read only when that record is written: a refresh never pays for it.

import {
  type CommitId,
  commitId,
  messageSources,
  type RepoConfig,
  type ThreadId,
  untracedLanes,
} from "@pinetrie/core"
import { describeFailure, lines, type Runner } from "@pinetrie/lanes"
import { revsetName } from "./lane/names.ts"
import { threadCommitsOnAcceptedWork } from "./plan.ts"

/** A commit on accepted work carrying accepted proposed changes' `Pinetrie-Source` trailers. */
export interface AcceptedThreadCommit {
  readonly commit: CommitId
  /** The lane commits it names, from every paragraph: a squash of two accepted proposed changes keep both. */
  readonly sources: readonly CommitId[]
}

/** An accepted thread commit on accepted work that names lanes but no sources: accepted before proposed changes carried their ledger. */
export interface Untraced {
  readonly commit: CommitId
  readonly lanes: readonly ThreadId[]
}

/** What every lane's refresh reads, as one operation left your repo. */
export interface SharedFacts {
  readonly op: string
  /** Accepted work's commit; null before it is set up. */
  readonly acceptedCommit: CommitId | null
  /** Every accepted thread commit on accepted work that names sources. */
  readonly acceptedThreadCommits: readonly AcceptedThreadCommit[]
  /** Every accepted thread commit on accepted work that names none (`untracedLanes`). */
  readonly untraced: readonly Untraced[]
  /**
   * The revset `acceptedThreadCommits` and `untraced` were read by. A read at
   * the same operation names them by it, so the two cannot name different
   * sets, and no read writes them out one by one.
   */
  readonly acceptedThreadCommitsRevset: string
  /** Files `@` changes: proposed changes' `workingCopyEdits` is its files that are here. */
  readonly editing: ReadonlySet<string>
}

/**
 * The one read of the shared facts: accepted work's commit, the accepted
 * thread commits `threadCommits` names, and `@`, each row flagged by which it
 * is (one commit may be more than one), `@`'s files read from its diff, as
 * `jj diff --name-only` lists them.
 */
function sharedRead(
  repoConfig: RepoConfig,
  threadCommits: string,
): readonly string[] {
  const accepted = `present(${revsetName(repoConfig.acceptedBookmark)})`
  const flag = (letter: string, revset: string) =>
    `if(self.contained_in(${JSON.stringify(revset)}), "${letter}")`
  return [
    "log",
    "--no-graph",
    "-r",
    `${accepted} | (${threadCommits}) | @`,
    "-T",
    [
      'commit_id ++ "\\t"',
      flag("A", accepted),
      flag("K", threadCommits),
      flag("W", "@"),
      '"\\t"',
      'if(self.contained_in("@"), "[" ++ self.diff().files().map(|f| json(f.path())).join(",") ++ "]", "[]") ++ "\\t"',
      'json(description) ++ "\\n"',
    ].join(" ++ "),
  ]
}

/** `sharedRead`'s output → the facts at `op`, with the revset it read the thread commits by. */
export function parseShared(
  op: string,
  stdout: string,
  acceptedThreadCommitsRevset: string,
): SharedFacts {
  let acceptedCommit: CommitId | null = null
  let editing: ReadonlySet<string> = new Set()
  const threadCommits: {
    commit: CommitId
    sources: readonly CommitId[]
    lanes: readonly ThreadId[]
  }[] = []
  for (const row of lines(stdout)) {
    const [commit = "", flags = "", files = "[]", description = '""'] =
      row.split("\t")
    const id = commitId(commit)
    if (flags.includes("A")) acceptedCommit = id
    if (flags.includes("W")) editing = new Set(JSON.parse(files) as string[])
    if (flags.includes("K")) {
      const message = JSON.parse(description) as string
      threadCommits.push({
        commit: id,
        sources: messageSources(message),
        lanes: untracedLanes(message),
      })
    }
  }
  return {
    op,
    acceptedCommit,
    acceptedThreadCommits: threadCommits
      .filter(t => t.sources.length > 0)
      .map(({ commit, sources }) => ({ commit, sources })),
    untraced: threadCommits
      .filter(t => t.lanes.length > 0)
      .map(({ commit, lanes }) => ({ commit, lanes })),
    acceptedThreadCommitsRevset,
    editing,
  }
}

/** Read the shared facts with jj pinned to `op`: one `jj log`. */
export async function readShared(
  op: string,
  jj: Runner,
  repoConfig: RepoConfig,
): Promise<SharedFacts> {
  const threadCommits = threadCommitsOnAcceptedWork(repoConfig)
  const ran = await jj(sharedRead(repoConfig, threadCommits))
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  return parseShared(op, ran.stdout, threadCommits)
}
