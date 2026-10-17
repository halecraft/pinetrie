// host/folder/review — the one reader of a folder review, of any two states:
// proposed changes (as their shown merge), a history entry, a conflict's
// side. It gathers for `planFolderReview`: the source paths, their stats,
// each side's facts, and which paths gone and added hold equal bytes. A
// file's bytes stream from its state's snapshot (`fileOut`), typed by what
// `pathFacts` read of them, never by its name.

import type { PathFact, PointId, RevisionReview } from "@pinetrie/core"
import {
  pairRenames,
  planFolderReview,
  renameCandidates,
  type SizedPath,
} from "@pinetrie/folder"
import type { FolderDisks } from "@pinetrie/lanes"
import type { ReviewAnswer } from "@pinetrie/rules"
import { type StateReader, sourceChanges } from "./changes.ts"

/** What a folder review reads. */
export type ReviewReader = StateReader & {
  readonly disks: Pick<
    FolderDisks,
    | "diffStats"
    | "pathFacts"
    | "sameContent"
    | "filesUnder"
    | "read"
    | "fileOut"
  >
}

const sized = (
  files: readonly string[],
  facts: readonly PathFact[],
  holds: (i: number) => boolean,
): readonly SizedPath[] =>
  files.flatMap((path, i) => {
    const f = facts[i]
    return holds(i) && f?.kind === "file" ? [{ path, size: f.size }] : []
  })

/** The review of `from..to`, with `description`. */
export async function readFolderReview(
  reader: ReviewReader,
  from: PointId,
  to: PointId,
  description: string,
): Promise<RevisionReview> {
  // gather
  const files = await sourceChanges(reader, from, to)
  const [stats, before, after] = await Promise.all([
    reader.disks.diffStats(from, to, files),
    reader.disks.pathFacts(from, files),
    reader.disks.pathFacts(to, files),
  ])
  const absent = (facts: readonly PathFact[], i: number) =>
    facts[i]?.kind === "absent"
  const candidates = renameCandidates(
    sized(files, before, i => absent(after, i)),
    sized(files, after, i => absent(before, i)),
  )
  const equal =
    candidates.length === 0
      ? []
      : await reader.disks.sameContent(from, to, candidates)
  // plan
  return planFolderReview({
    files,
    stats,
    before,
    after,
    renames: pairRenames(candidates, equal),
    description,
  })
}

/** `path`'s bytes in `state`, typed by its fact; 404 for anything but a file there. */
export async function readFolderFile(
  reader: Pick<ReviewReader, "disks">,
  state: PointId,
  path: string,
): Promise<ReviewAnswer> {
  const [fact] = await reader.disks.pathFacts(state, [path])
  if (fact?.kind !== "file")
    return { kind: "refused", status: 404, reason: "no file there" }
  return {
    kind: "file",
    content: fact.content,
    size: fact.size,
    bytes: reader.disks.fileOut(state, path),
  }
}
