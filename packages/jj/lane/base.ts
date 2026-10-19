// jj/lane/base — a lane's base as its history names it, read the same way
// from the lane's own repo and from yours.

import type { CommitBase, RepoConfig } from "@pinetrie/core"
import type { Runner } from "@pinetrie/lanes"
import { newestBase } from "./merge.ts"
import { revsetName } from "./names.ts"
import { readCommits } from "./revisions.ts"

/**
 * A lane's base, from the newest `Pinetrie-Base` in the history of `tip`, a
 * revset: the lane's tip in your repo, or its bookmark in its own repo. A
 * lane with none (one from before accepted work) is on accepted work, from the newest
 * accepted commit in its history; null when there is none. In the lane's own
 * repo such a lane is always null: that repo has no line bookmark.
 */
export async function laneBase(
  jj: Runner,
  tip: string,
  repoConfig: RepoConfig,
): Promise<CommitBase | null> {
  const newest = await newestBase(jj, tip, repoConfig.wipPrefix)
  if (newest === null) {
    const [start] = await readCommits(
      jj,
      `latest(heads(::(${tip}) & ::present(${revsetName(repoConfig.acceptedBookmark)})))`,
    )
    return start === undefined
      ? null
      : { base: { kind: "accepted" }, start, source: start }
  }
  return newest.kind === "accepted"
    ? {
        base: { kind: "accepted" },
        start: newest.commit,
        source: newest.commit,
      }
    : {
        base: { kind: "unfinished", bookmark: newest.bookmark },
        start: newest.at,
        source: newest.commit,
      }
}
