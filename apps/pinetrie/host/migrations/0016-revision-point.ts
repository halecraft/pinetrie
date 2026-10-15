// host/migrations/0016-revision-point — a turn's record names its state as a
// point (`point`), the string its `commit` was, and is written whole: the
// fields records written before each existed lack (`snapshot`, `paths`,
// `conflicts`, `disk`, and a disk's `shared`) become none, so the decoder
// reads one shape. A record's contents change and no schema's hash does.
//
// One-time: delete this file once Duane's store has run it.

import { REVISION } from "@pinetrie/rules"
import { rewriteRecords } from "./rewrite.ts"

type Stored = Readonly<Record<string, unknown>>

const isStored = (v: unknown): v is Stored =>
  v !== null && typeof v === "object" && !Array.isArray(v)

/** Whether a stored disk carries its shared files' versions. */
const isWholeDisk = (disk: unknown): boolean =>
  disk === null || (isStored(disk) && "shared" in disk)

/**
 * A stored turn record with `commit`, or missing a later field, written
 * whole with `point`; null for one already whole.
 */
export function revisionPointRewrite(contents: unknown): object | null {
  if (!isStored(contents)) return null
  const { commit, ...rest } = contents
  const whole =
    !("commit" in contents) &&
    "point" in contents &&
    "snapshot" in contents &&
    "paths" in contents &&
    "conflicts" in contents &&
    "disk" in contents &&
    isWholeDisk(contents.disk)
  if (whole) return null
  const { disk } = contents
  return {
    ...rest,
    point: "point" in contents ? contents.point : (commit ?? null),
    snapshot: contents.snapshot ?? null,
    paths: contents.paths ?? [],
    conflicts: contents.conflicts ?? [],
    disk: isStored(disk)
      ? { ...disk, shared: disk.shared ?? { read: [], wrote: [] } }
      : null,
  }
}

export const revisionPoint = rewriteRecords({
  name: "0016-revision-point",
  namespace: REVISION.namespace,
  home: "root",
  rewrite: revisionPointRewrite,
})
