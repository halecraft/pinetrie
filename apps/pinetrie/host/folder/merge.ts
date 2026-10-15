// host/folder/merge — one path merge of `theirs` into a disk that holds
// `ours`, over their base: gathered in two rounds (the facts at the paths
// either side changed near theirs, then whether ours and theirs hold alike
// content), planned by `@pinetrie/folder` (`planPathMerge`), then applied by
// lanehost. A lane's catch-up and a virtual base's making both merge so.

import type { PointId, TextMerged } from "@pinetrie/core"
import {
  type MergePlanned,
  type PathFacts,
  pathsToCompare,
  pathsToGather,
  planPathMerge,
} from "@pinetrie/folder"
import type { FolderDisks } from "@pinetrie/lanes"
import { type StateReader, sourceDiff } from "./changes.ts"

/** What a merge did: its plan, and each text step answered clean or not. */
export interface MergeApplied {
  readonly plan: MergePlanned
  readonly texts: readonly TextMerged[]
}

/** The paths a merge left conflicted: the plan's, and its text steps that did not merge clean. */
export const conflictedPaths = (m: MergeApplied): readonly string[] => [
  ...new Set([
    ...m.plan.conflicts,
    ...m.texts.filter(t => !t.clean).map(t => t.path),
  ]),
]

/**
 * `theirs` merged into `disk`, which holds `ours`, over `base`. With
 * `markers`, a conflicted text keeps git's markers, as a virtual base does;
 * else ours.
 */
export async function mergeInto(
  r: StateReader & {
    readonly disks: Pick<
      FolderDisks,
      "pathFacts" | "sameContent" | "applyMerge"
    >
  },
  input: {
    readonly disk: string
    readonly ours: PointId
    readonly theirs: PointId
    readonly base: PointId
    readonly markers: boolean
  },
): Promise<MergeApplied> {
  const { ours, theirs, base } = input
  // gather
  const [oursChanged, theirsChanged] = await Promise.all([
    sourceDiff(r, base, ours),
    sourceDiff(r, base, theirs),
  ])
  const paths = pathsToGather(oursChanged, theirsChanged)
  const [atBase, atOurs, atTheirs] = await Promise.all([
    r.disks.pathFacts(base, paths),
    r.disks.pathFacts(ours, paths),
    r.disks.pathFacts(theirs, paths),
  ])
  const facts = new Map<string, PathFacts>()
  paths.forEach((p, i) => {
    const b = atBase[i]
    const o = atOurs[i]
    const t = atTheirs[i]
    if (b !== undefined && o !== undefined && t !== undefined)
      facts.set(p, { base: b, ours: o, theirs: t })
  })
  const same = new Set(
    await r.disks.sameContent(
      ours,
      theirs,
      pathsToCompare(theirsChanged, facts),
    ),
  )
  // plan
  const plan = planPathMerge({
    ours: oursChanged,
    theirs: theirsChanged,
    facts,
    same,
  })
  // execute
  const texts = await r.disks.applyMerge({
    disk: input.disk,
    base,
    theirs,
    steps: plan.steps,
    markers: input.markers,
  })
  return { plan, texts }
}
