// host/folder/virtual-base — a merge base as a state: one already, or
// several merged first into a snapshot named by them (`virtualBaseName`),
// made once and found made after. A conflict inside it keeps git's markers,
// as git's recursive strategy does; each inner base is made first, by this
// same driver.

import {
  type BasePlan,
  type PointId,
  pointId,
  snapshotId,
} from "@pinetrie/core"
import type { FolderDisks, LaneOwner, LaneRuntime } from "@pinetrie/lanes"
import type { StateReader } from "./changes.ts"
import { mergeInto } from "./merge.ts"

type MergeReader = StateReader & {
  readonly runtime: Pick<LaneRuntime, "diff" | "disk" | "snapshotExists">
  readonly disks: Pick<
    FolderDisks,
    "pathFacts" | "sameContent" | "applyMerge" | "filesUnder" | "read"
  >
}

/** The state `plan` names: itself, or its virtual base made now unless it is made already. */
export async function baseState(
  r: MergeReader,
  plan: BasePlan,
): Promise<PointId> {
  if (plan.kind === "state") return plan.state
  const { name } = plan
  if (await r.runtime.snapshotExists(snapshotId(name))) return name
  const scratch = `${name}-scratch` as LaneOwner
  const step = (i: number) => pointId(`${name}-step-${i}`)
  const made: PointId[] = []
  await r.runtime.disk({ kind: "delete", lane: scratch })
  await r.runtime.disk({
    kind: "restore",
    lane: scratch,
    from: snapshotId(plan.first),
  })
  try {
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
  } finally {
    await r.runtime.disk({ kind: "delete", lane: scratch })
    if (made.length > 0)
      await r.runtime.disk({
        kind: "deleteSnapshots",
        ids: made.map(snapshotId),
      })
  }
}
