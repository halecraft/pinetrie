// host/folder/proven — a lane's record proven to keep a folder's history,
// which only `proveFolderLane` makes: the folder adapter reads a lane's
// states only through one.

import {
  type ForeignLane,
  type LaneRecord,
  laneFits,
  type OwnLane,
  ownLane,
  type ThreadId,
} from "@pinetrie/core"

declare const folderLaneBrand: unique symbol
/** A lane's record, proven to keep a folder's history. */
export type FolderLane = OwnLane & {
  readonly history: "folder"
  readonly [folderLaneBrand]: true
}

/** A lane's record proven folder: `proveFolderLane`'s answer. */
interface ProvenFolderLane {
  readonly kind: "folder"
  readonly lane: FolderLane
}

/** The record proven folder, or why not: no copy of its own, or another kind. */
export function proveFolderLane(record: OwnLane): ProvenFolderLane | ForeignLane
export function proveFolderLane(
  record: LaneRecord,
):
  | ProvenFolderLane
  | ForeignLane
  | { readonly kind: "no-copy"; readonly lane: ThreadId }
export function proveFolderLane(
  record: LaneRecord,
):
  | ProvenFolderLane
  | ForeignLane
  | { readonly kind: "no-copy"; readonly lane: ThreadId } {
  const own = ownLane(record)
  if (own === null) return { kind: "no-copy", lane: record.lane }
  return laneFits(own, "folder") ?? { kind: "folder", lane: own as FolderLane }
}
