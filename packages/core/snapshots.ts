// core/snapshots — whose rule decides a snapshot's name, and the proof a
// deletion carries. A project's `snapshots/` holds the names of four owners;
// a rule written for one must never delete another's.

import type { SnapshotId } from "./disks.ts"
import { isFolderStateId } from "./folder.ts"

export type SnapshotOwner = "entry" | "folder-state" | "base" | "unknown"
/** The owners a rule may delete for: nobody deletes the base, or a name no owner holds. */
export type DeletableOwner = Exclude<SnapshotOwner, "base" | "unknown">

const UUIDV7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Total, in this order: a bare UUIDv7 is an entry's, checked first because
 * `isFolderStateId` accepts any disk name with a dash, a UUID's too; then
 * `isFolderStateId`'s are folder states'; `base` is the base's; anything
 * else, unknown.
 */
export function snapshotOwner(name: string): SnapshotOwner {
  if (UUIDV7.test(name)) return "entry"
  if (isFolderStateId(name)) return "folder-state"
  if (name === "base") return "base"
  return "unknown"
}

declare const deletableBrand: unique symbol
/** A snapshot its owner's rule said can go: the only thing `delete-snapshots` takes. */
export type Deletable<O extends DeletableOwner = DeletableOwner> =
  SnapshotId & { readonly [deletableBrand]: O }

/** Throws unless `snapshotOwner(id)` is `owner`: a rule cannot delete another owner's name. */
export function deletableSnapshot<O extends DeletableOwner>(
  owner: O,
  id: SnapshotId,
): Deletable<O> {
  const found = snapshotOwner(id)
  if (found !== owner)
    throw new Error(
      `the ${owner} rule cannot delete ${JSON.stringify(id)}, a ${found} snapshot`,
    )
  return id as Deletable<O>
}
