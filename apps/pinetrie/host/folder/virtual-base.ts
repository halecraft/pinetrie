// host/folder/virtual-base — a merge base as a state: one already, or
// several merged first into a snapshot named by them (`virtualBaseName`),
// found made while it is kept. The merge over it deletes it after, unless a
// record names it (`history.ts`). A conflict inside it keeps git's markers,
// as git's recursive strategy does; each inner base is made first, by this
// same driver.

import {
  type BasePlan,
  type PointId,
  pointId,
  snapshotId,
} from "@pinetrie/core"
import type { FolderDisks, LaneRuntime } from "@pinetrie/lanes"
import type { StateReader } from "./changes.ts"
import { mergeInto } from "./merge.ts"
import { withScratch } from "./scratch.ts"

type MergeReader = StateReader & {
  readonly runtime: Pick<LaneRuntime, "diff" | "disk" | "snapshotExists">
  readonly disks: Pick<
    FolderDisks,
    "pathFacts" | "sameContent" | "applyMerge" | "filesUnder" | "read"
  >
}

/**
 * The first state `plan` reads whose snapshot is gone, or null when it can
 * be had: a virtual base found made reads nothing below it.
 */
export async function baseMissing(
  r: Pick<MergeReader, "runtime">,
  plan: BasePlan,
): Promise<PointId | null> {
  const has = (state: PointId) => r.runtime.snapshotExists(snapshotId(state))
  if (plan.kind === "state") return (await has(plan.state)) ? null : plan.state
  if (await has(plan.name)) return null
  if (!(await has(plan.first))) return plan.first
  for (const m of plan.merges) {
    if (!(await has(m.other))) return m.other
    const below = m.base === null ? null : await baseMissing(r, m.base)
    if (below !== null) return below
  }
  return null
}

/** The state `plan` names: itself, or its virtual base made now unless it is made already. */
export async function baseState(
  r: MergeReader,
  plan: BasePlan,
): Promise<PointId> {
  if (plan.kind === "state") return plan.state
  const { name } = plan
  if (await r.runtime.snapshotExists(snapshotId(name))) return name
  const step = (i: number) => pointId(`${name}-step-${i}`)
  const made: PointId[] = []
  try {
    return await withScratch(r.runtime, name, plan.first, async scratch => {
      let ours = plan.first
      for (const [i, m] of plan.merges.entries()) {
        if (m.base === null)
          throw new Error(
            `${plan.first} and ${m.other} share no state: every state of a folder project descends from its first read`,
          )
        const base = await baseState(r, m.base)
        await mergeInto(r, {
          disk: scratch,
          ours,
          theirs: m.other,
          base,
          markers: true,
        })
        const isLast = i === plan.merges.length - 1
        const at = isLast ? name : step(i)
        await r.runtime.disk({
          kind: "snapshot",
          lane: scratch,
          snapshot: snapshotId(at),
        })
        if (!isLast) made.push(at)
        ours = at
      }
      return name
    })
  } finally {
    if (made.length > 0)
      await r.runtime.disk({
        kind: "delete-snapshots",
        ids: made.map(snapshotId),
      })
  }
}
