// What catching up would change in a lane, read in your repo before the
// update runs: the forecast the page's ↓, a base's news and `catch_up`'s
// refusals read, through `pinetrie.base`.

import type {
  CatchUpRead,
  CommitId,
  LaneBase,
  NonEmpty,
  StartRead,
} from "@pinetrie/core"
import { changedPaths, type Runner } from "@pinetrie/lanes"

/**
 * What an update brings in: accepted work's commit, merged, or a WIP's
 * commit, copied onto the lane's previous copy (`planWipCopy`).
 */
export type CatchUpTarget =
  | { readonly kind: "accepted"; readonly commit: CommitId }
  | { readonly kind: "wip"; readonly commit: CommitId }

/**
 * Whether a lane's forecast is read: `none` while the base is at the lane's
 * base start, `keep` when `known` was read at this tip and base commit, else
 * `read`: each lane reads it once per move of its tip or of the base.
 */
export function planCatchUpRead(input: {
  readonly start: CommitId
  readonly to: CommitId
  readonly tip: CommitId
  readonly known: CatchUpRead | null
}): "none" | "keep" | "read" {
  const { start, to, tip, known } = input
  if (start === to) return "none"
  return known !== null && known.tip === tip && known.to === to
    ? "keep"
    : "read"
}

/**
 * The commits the forecast diffs from: where the lane's next offer would
 * start. When the update merges accepted work, that is the offer's start,
 * which holds every accepted source the lane has: the sources `mergeBase`
 * joins to their accepted-offer commits before it merges, so the
 * lane's own accepted work does not count as coming in. A WIP's copy is no
 * merge, and an untraced start names no source: both diff from the base's
 * start.
 */
export function catchUpHolds(input: {
  readonly base: LaneBase
  readonly start: StartRead
  readonly target: CatchUpTarget
}): NonEmpty<CommitId> {
  const { base, start, target } = input
  return target.kind === "accepted" && start.kind === "known"
    ? start.start
    : [base.start]
}

/**
 * The files a catch-up would change, from one diff to the base's commit per
 * commit the lane holds (`moved`) and the diff from the lane's tip to it
 * (`lacking`): those every held commit has differently from the base, and
 * the tip too. A file the base has as any held commit has it keeps that
 * commit's value as the merge's base, so the merge leaves it alone. A union
 * would count every file of an offer accepted after the lane caught up
 * between offering it and its acceptance, whose start has two heads. In
 * the first diff's order.
 */
export function catchUpFilesOf(input: {
  readonly moved: NonEmpty<readonly string[]>
  readonly lacking: readonly string[]
}): string[] {
  const [first, ...rest] = input.moved
  const others = rest.map(files => new Set(files))
  const lacking = new Set(input.lacking)
  return first.filter(f => lacking.has(f) && others.every(o => o.has(f)))
}

/**
 * The files catching up with a base would change in the lane, or null when
 * jj cannot say: one diff from each commit the lane holds of the base's
 * history (`holds`, from `catchUpHolds`) to the base's commit `to`, and one
 * from the lane's `tip`, decided by `catchUpFilesOf`. Two diffs for one held
 * commit. Read as `mergeUpdate` reads the files a merge changed
 * (`changedPaths`), so the two compare.
 */
export async function catchUpFiles(
  jj: Runner,
  input: {
    readonly holds: NonEmpty<CommitId>
    readonly to: CommitId
    readonly tip: CommitId
  },
): Promise<string[] | null> {
  const { holds, to, tip } = input
  try {
    const [first, ...rest] = holds
    const moved: [readonly string[], ...(readonly string[])[]] = [
      await changedPaths(jj, first, to),
    ]
    for (const held of rest) moved.push(await changedPaths(jj, held, to))
    return catchUpFilesOf({ moved, lacking: await changedPaths(jj, tip, to) })
  } catch {
    return null
  }
}

/**
 * What catching up would change, read at `tip` and the target's commit as
 * `planCatchUpRead` decides: null when the base has not moved from the
 * lane's base start, or jj cannot say; `known` when it was read at the same
 * tip and commit; else `catchUpFiles` from the commits `catchUpHolds` names.
 */
export async function readCatchUp(
  jj: Runner,
  input: {
    readonly base: LaneBase
    readonly start: StartRead
    readonly target: CatchUpTarget
    readonly tip: CommitId
    readonly known: CatchUpRead | null
  },
): Promise<CatchUpRead | null> {
  const { base, target, tip, known } = input
  const to = target.commit
  switch (planCatchUpRead({ start: base.start, to, tip, known })) {
    case "none":
      return null
    case "keep":
      return known
    case "read": {
      const files = await catchUpFiles(jj, {
        holds: catchUpHolds(input),
        to,
        tip,
      })
      return files === null ? null : { tip, to, files }
    }
  }
}
