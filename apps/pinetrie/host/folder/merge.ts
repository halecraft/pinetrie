// host/folder/merge — one path merge of `theirs` into a disk that holds
// `ours`, over their base: gathered in two rounds (the facts at the paths
// either side changed near theirs, then whether ours and theirs hold alike
// content), planned by `@pinetrie/folder` (`planPathMerge`), then applied by
// lanehost. A lane's catch-up, a virtual base's making and a shown merge
// all merge so.

import {
  type BasePlan,
  type PointId,
  snapshotId,
  type TextMerged,
} from "@pinetrie/core"
import {
  type MergePlanned,
  type PathFacts,
  pathsToCompare,
  pathsToGather,
  planPathMerge,
} from "@pinetrie/folder"
import type { FolderDisks, LaneRuntime } from "@pinetrie/lanes"
import { type StateReader, sourceDiff } from "./changes.ts"
import { baseState } from "./virtual-base.ts"

/** What a merge did: its plan, and each text step answered clean or not. */
interface MergeApplied {
  readonly plan: MergePlanned
  readonly texts: readonly TextMerged[]
}

/** The paths a merge left conflicted: the plan's, and its text steps that did not merge clean. */
const conflictedPaths = (m: MergeApplied): readonly string[] => [
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

/**
 * `theirs` merged into `disk`, which holds `ours`, over the base `plan`
 * names (made first when virtual), then snapshotted as `state` by
 * `snapshot`: a catch-up's state, or a shown merge. Writes no record: a
 * catch-up records its state at once, a shown merge only when accepted.
 * Answers the base merged over and the paths left conflicted, their
 * markers in place of ours' text only where `markers`.
 */
export async function mergeToState(
  r: StateReader & {
    readonly runtime: Pick<LaneRuntime, "diff" | "disk" | "snapshotExists">
    readonly disks: Pick<
      FolderDisks,
      "pathFacts" | "sameContent" | "applyMerge" | "filesUnder" | "read"
    >
  },
  input: {
    readonly disk: string
    readonly ours: PointId
    readonly theirs: PointId
    readonly plan: BasePlan
    readonly markers: boolean
    readonly snapshot: () => Promise<void>
  },
): Promise<{ readonly base: PointId; readonly paths: readonly string[] }> {
  const base = await baseState(r, input.plan)
  const merged = await mergeInto(r, {
    disk: input.disk,
    ours: input.ours,
    theirs: input.theirs,
    base,
    markers: input.markers,
  })
  await input.snapshot()
  return { base, paths: conflictedPaths(merged) }
}

/**
 * A virtual base no record names, deleted: once a state, it is the
 * sweep's; else it goes now, left behind by an earlier merge or not.
 */
export async function dropUnrecordedBase(
  runtime: Pick<LaneRuntime, "disk">,
  plan: BasePlan,
  recorded: (state: PointId) => boolean,
): Promise<void> {
  if (plan.kind === "virtual" && !recorded(plan.name))
    await runtime.disk({
      kind: "deleteSnapshots",
      ids: [snapshotId(plan.name)],
    })
}
