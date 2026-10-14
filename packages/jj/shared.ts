// What accepted work's record and every lane's refresh read, read once per
// operation: an operation id names the repo exactly, so the owner keeps one
// set until the head moves.

import {
  type AcceptedFacts,
  type CommitId,
  type RepoConfig,
  sourcesOf,
  type ThreadId,
  untracedLanes,
} from "@pinetrie/core"
import { describeFailure, lines, type Runner } from "@pinetrie/lanes"
import { acceptedFacts } from "./accepted.ts"
import { revsetName } from "./lane/names.ts"
import {
  ACCEPTED_OFFER_COMMIT_ROW,
  parseAcceptedOfferCommits,
} from "./lane/revisions.ts"
import { ACCEPTED_OFFER_COMMITS } from "./plan.ts"

/** A commit on accepted work carrying accepted offers' `Pinetrie-Source` trailers. */
export interface AcceptedOfferCommit {
  readonly commit: CommitId
  /** The lane commits it names, from every paragraph: a squash of two accepted offers keeps both. */
  readonly sources: readonly CommitId[]
}

/** An accepted-offer commit on accepted work that names lanes but no sources: accepted before offers carried their ledger. */
export interface Untraced {
  readonly commit: CommitId
  readonly lanes: readonly ThreadId[]
}

/** What accepted work's record and every lane's refresh read, as one operation left your repo. */
export interface SharedFacts {
  readonly op: string
  /** What `acceptedFacts` reads: accepted work, its config, the WIPs, your work's state. */
  readonly accepted: AcceptedFacts
  /** Every accepted-offer commit on accepted work that names sources. */
  readonly acceptedOfferCommits: readonly AcceptedOfferCommit[]
  /** Every accepted-offer commit on accepted work that names none (`untracedLanes`). */
  readonly untraced: readonly Untraced[]
  /** Files `@` changes: an offer's `yourEdits` is its files that are here. */
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
    `::present(${revsetName(repoConfig.acceptedBookmark)}) & ${ACCEPTED_OFFER_COMMITS}`,
    "-T",
    ACCEPTED_OFFER_COMMIT_ROW,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const accepted = parseAcceptedOfferCommits(ran.stdout).map(
    ({ commit, description }) => ({
      commit,
      sources: sourcesOf(description),
      lanes: untracedLanes(description),
    }),
  )
  const edited = await jj(["diff", "-r", "@", "--name-only"])
  if (!edited.ok) throw new Error(describeFailure("jj diff", edited))
  return {
    op,
    accepted: await acceptedFacts(jj, git, repoConfig),
    acceptedOfferCommits: accepted
      .filter(t => t.sources.length > 0)
      .map(({ commit, sources }) => ({ commit, sources })),
    untraced: accepted
      .filter(t => t.lanes.length > 0)
      .map(({ commit, lanes }) => ({ commit, lanes })),
    editing: new Set(lines(edited.stdout)),
  }
}
