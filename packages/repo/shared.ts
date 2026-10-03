// repo/shared — what the line's record and every lane's refresh read, read
// once per operation (ADR-0065): the line's facts, the taken offers' sources
// on the line, and the files `@` changes. An operation id names the repo
// exactly, so the owner keeps one set until the head moves.

import { type CommitId, commitId, TRAILERS, trailerValues } from "@pineta/core"
import {
  describeFailure,
  type LineConfig,
  lines,
  type Runner,
  revsetName,
} from "@pineta/lanes"
import { type LineFacts, lineFacts } from "./line.ts"

/** A commit on the line carrying taken offers' `Pineta-Source` trailers. */
export interface Taken {
  readonly commit: CommitId
  /** The lane commits it names, from every paragraph (S77 item 6). */
  readonly sources: readonly CommitId[]
}

/** What the line's record and every lane's refresh read, as one operation left your repo. */
export interface SharedFacts {
  readonly op: string
  /** What `lineFacts` reads: the line, its config, the WIPs, your work's state. */
  readonly line: LineFacts
  /** Every commit on the line that a take named sources in. */
  readonly taken: readonly Taken[]
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
    `::present(${revsetName(line.onto)}) & description(regex:"(?m)^${TRAILERS.source}: ")`,
    "-T",
    'commit_id ++ "\\t" ++ json(description) ++ "\\n"',
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  const taken = lines(ran.stdout).map(row => {
    const tab = row.indexOf("\t")
    const description = JSON.parse(row.slice(tab + 1)) as string
    return {
      commit: commitId(row.slice(0, tab)),
      sources: [...new Set(trailerValues(description, TRAILERS.source))].map(
        commitId,
      ),
    }
  })
  const edited = await jj(["diff", "-r", "@", "--name-only"])
  if (!edited.ok) throw new Error(describeFailure("jj diff", edited))
  return {
    op,
    line: await lineFacts(jj, git, line),
    taken,
    editing: new Set(lines(edited.stdout)),
  }
}
