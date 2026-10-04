// repo/shared — what the line's record and every lane's refresh read, read
// once per operation (ADR-0065): the line's facts, the integrated-offer
// commits on the line with their sources or the lanes they name none for,
// and the files `@` changes. An operation id names the repo
// exactly, so the owner keeps one set until the head moves.

import {
  type CommitId,
  type LaneName,
  type LineFacts,
  sourcesOf,
  untracedLanes,
} from "@pineta/core"
import {
  describeFailure,
  INTEGRATED_OFFER_COMMIT_ROW,
  type LineConfig,
  lines,
  parseIntegratedOfferCommits,
  type Runner,
  revsetName,
} from "@pineta/lanes"
import { lineFacts } from "./line.ts"
import { INTEGRATED_OFFER_COMMITS } from "./plan.ts"

/** A commit on the line carrying integrated offers' `Pineta-Source` trailers. */
export interface IntegratedOfferCommit {
  readonly commit: CommitId
  /** The lane commits it names, from every paragraph (S77 item 6). */
  readonly sources: readonly CommitId[]
}

/** An integrated-offer commit on the line whose sources are not named, for the lanes it names (S97). */
export interface Untraced {
  readonly commit: CommitId
  readonly lanes: readonly LaneName[]
}

/** What the line's record and every lane's refresh read, as one operation left your repo. */
export interface SharedFacts {
  readonly op: string
  /** What `lineFacts` reads: the line, its config, the WIPs, your work's state. */
  readonly line: LineFacts
  /** Every integrated-offer commit on the line that names sources. */
  readonly integratedOfferCommits: readonly IntegratedOfferCommit[]
  /** Every integrated-offer commit on the line that names none (`untracedLanes`). */
  readonly untraced: readonly Untraced[]
  /** Files `@` changes: an offer's `yourEdits` is its files that are here. */
  readonly editing: ReadonlySet<string>
}

/** Read the shared facts with jj pinned to `op`, and git. */
export async function readShared(
  op: string,
  jj: Runner,
  git: Runner,
  line: LineConfig,
): Promise<SharedFacts> {
  const ran = await jj([
    "log",
    "--no-graph",
    "-r",
    `::present(${revsetName(line.onto)}) & ${INTEGRATED_OFFER_COMMITS}`,
    "-T",
    INTEGRATED_OFFER_COMMIT_ROW,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const integrated = parseIntegratedOfferCommits(ran.stdout).map(
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
    line: await lineFacts(jj, git, line),
    integratedOfferCommits: integrated
      .filter(t => t.sources.length > 0)
      .map(({ commit, sources }) => ({ commit, sources })),
    untraced: integrated
      .filter(t => t.lanes.length > 0)
      .map(({ commit, lanes }) => ({ commit, lanes })),
    editing: new Set(lines(edited.stdout)),
  }
}
