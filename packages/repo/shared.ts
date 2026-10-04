// repo/shared — what the line's record and every lane's refresh read, read
// once per operation (ADR-0065): the line's facts, the takes on the line
// with their sources or the lanes they name none for, and the files `@`
// changes. An operation id names the repo
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
  type LineConfig,
  lines,
  parseTakes,
  type Runner,
  revsetName,
  TAKE_ROW,
} from "@pineta/lanes"
import { lineFacts } from "./line.ts"
import { TAKES } from "./plan.ts"

/** A commit on the line carrying taken offers' `Pineta-Source` trailers. */
export interface Taken {
  readonly commit: CommitId
  /** The lane commits it names, from every paragraph (S77 item 6). */
  readonly sources: readonly CommitId[]
}

/** A take on the line whose sources are not named, for the lanes it names (S97). */
export interface Untraced {
  readonly commit: CommitId
  readonly lanes: readonly LaneName[]
}

/** What the line's record and every lane's refresh read, as one operation left your repo. */
export interface SharedFacts {
  readonly op: string
  /** What `lineFacts` reads: the line, its config, the WIPs, your work's state. */
  readonly line: LineFacts
  /** Every commit on the line that a take named sources in. */
  readonly taken: readonly Taken[]
  /** Every commit on the line holding a take that named none (`untracedLanes`). */
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
    `::present(${revsetName(line.onto)}) & ${TAKES}`,
    "-T",
    TAKE_ROW,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const takes = parseTakes(ran.stdout).map(({ commit, description }) => ({
    commit,
    sources: sourcesOf(description),
    lanes: untracedLanes(description),
  }))
  const edited = await jj(["diff", "-r", "@", "--name-only"])
  if (!edited.ok) throw new Error(describeFailure("jj diff", edited))
  return {
    op,
    line: await lineFacts(jj, git, line),
    taken: takes
      .filter(t => t.sources.length > 0)
      .map(({ commit, sources }) => ({ commit, sources })),
    untraced: takes
      .filter(t => t.lanes.length > 0)
      .map(({ commit, lanes }) => ({ commit, lanes })),
    editing: new Set(lines(edited.stdout)),
  }
}
