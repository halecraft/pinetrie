// What accepted work's record and every lane's refresh read, read once per
// operation: an operation id names the repo exactly, so the owner keeps one
// set until the head moves.

import {
  type AcceptedFacts,
  type CommitId,
  messageSources,
  type RepoConfig,
  type ThreadId,
  untracedLanes,
} from "@pinetrie/core"
import { describeFailure, lines, type Runner } from "@pinetrie/lanes"
import { acceptedFacts } from "./accepted.ts"
import { revsetName } from "./lane/names.ts"
import {
  ACCEPTED_THREAD_COMMIT_ROW,
  parseAcceptedThreadCommits,
} from "./lane/revisions.ts"
import { ACCEPTED_THREAD_COMMITS } from "./plan.ts"

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

/** What accepted work's record and every lane's refresh read, as one operation left your repo. */
export interface SharedFacts {
  readonly op: string
  /** What `acceptedFacts` reads: accepted work, its config, the WIPs, your work's state. */
  readonly accepted: AcceptedFacts
  /** Every accepted thread commit on accepted work that names sources. */
  readonly acceptedThreadCommits: readonly AcceptedThreadCommit[]
  /** Every accepted thread commit on accepted work that names none (`untracedLanes`). */
  readonly untraced: readonly Untraced[]
  /** Files `@` changes: proposed changes' `yourEdits` is its files that are here. */
  readonly editing: ReadonlySet<string>
}

/** Read the shared facts with jj pinned to `op`, and git. */
export async function readShared(
  op: string,
  jj: Runner,
  git: Runner,
  repoConfig: RepoConfig,
): Promise<SharedFacts> {
  const ran = await jj([
    "log",
    "--no-graph",
    "-r",
    `::present(${revsetName(repoConfig.acceptedBookmark)}) & ${ACCEPTED_THREAD_COMMITS}`,
    "-T",
    ACCEPTED_THREAD_COMMIT_ROW,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const accepted = parseAcceptedThreadCommits(ran.stdout).map(
    ({ commit, description }) => ({
      commit,
      sources: messageSources(description),
      lanes: untracedLanes(description),
    }),
  )
  const edited = await jj(["diff", "-r", "@", "--name-only"])
  if (!edited.ok) throw new Error(describeFailure("jj diff", edited))
  return {
    op,
    accepted: await acceptedFacts(jj, git, repoConfig),
    acceptedThreadCommits: accepted
      .filter(t => t.sources.length > 0)
      .map(({ commit, sources }) => ({ commit, sources })),
    untraced: accepted
      .filter(t => t.lanes.length > 0)
      .map(({ commit, lanes }) => ({ commit, lanes })),
    editing: new Set(lines(edited.stdout)),
  }
}
