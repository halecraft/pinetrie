// host/folder/scratch — a scratch disk for a snapshot built from another:
// a shown merge, a virtual base, a restore's state. Its name is the
// snapshot's own with `-scratch`, so two builds of different snapshots never
// share one, and one left by a stopped host is deleted before its next use.

import { type PointId, snapshotId } from "@pinetrie/core"
import type { LaneDisks, LaneOwner } from "@pinetrie/lanes"

/**
 * `body` run on the scratch disk `<name>-scratch`, restored from `from`'s
 * snapshot: deleted first, so a stopped build's is never built on, and in
 * `finally`, so a throw leaves none.
 */
export async function withScratch<T>(
  runtime: Pick<LaneDisks, "disk">,
  name: PointId,
  from: PointId,
  body: (disk: LaneOwner) => Promise<T>,
): Promise<T> {
  const scratch = `${name}-scratch` as LaneOwner
  await runtime.disk({ kind: "delete", lane: scratch })
  await runtime.disk({
    kind: "restore",
    lane: scratch,
    from: snapshotId(from),
  })
  try {
    return await body(scratch)
  } finally {
    await runtime.disk({ kind: "delete", lane: scratch })
  }
}
