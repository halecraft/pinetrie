// jj/lane/points — the one way from a point to a commit: a lane's record
// proven to keep a jj history (`JjLane`), which only `proveJjLane` makes.
// A point names a state any kind of project has; read in a jj lane it is
// the commit it names, so the proof is made once per lane, not per point.

import {
  type CommitBase,
  type CommitId,
  commitId,
  type ForeignLane,
  type LaneBase,
  type LaneRecord,
  laneFits,
  type OwnLane,
  ownLane,
  type PointId,
  pointFromCommit,
  type ThreadId,
} from "@pinetrie/core"
import type { MergedOf, TurnCommittedOf } from "@pinetrie/lanes"

declare const jjLaneBrand: unique symbol
/** A lane's record, proven to keep a jj history. */
export type JjLane = OwnLane & {
  readonly history: "jj"
  readonly [jjLaneBrand]: true
}

/** A lane's record, proven to keep a jj history: `proveJjLane`'s answer. */
export interface ProvenJjLane {
  readonly kind: "jj"
  readonly lane: JjLane
}

/** A lane with no copy of its own: no history to read. */
export interface NoCopy {
  readonly kind: "no-copy"
  readonly lane: ThreadId
}

/**
 * The record proven jj, or why not: no copy of its own, or another kind.
 * Each answer is tagged: a refusal is never told from the proof by a field
 * the record lacks, which a record that gained it would flip unseen.
 */
export function proveJjLane(record: OwnLane): ProvenJjLane | ForeignLane
export function proveJjLane(
  record: LaneRecord,
): ProvenJjLane | ForeignLane | NoCopy
export function proveJjLane(
  record: LaneRecord,
): ProvenJjLane | ForeignLane | NoCopy {
  const own = ownLane(record)
  if (own === null) return { kind: "no-copy", lane: record.lane }
  return laneFits(own, "jj") ?? { kind: "jj", lane: own as JjLane }
}

/** A point of the history `lane` reads, as the commit it is. */
export const commitFromPoint = (_lane: JjLane, p: PointId): CommitId =>
  commitId(p)

/** jj's base read in your repo, as the ports carry it. */
export const baseFromCommits = (b: CommitBase): LaneBase => ({
  base: b.base,
  start: pointFromCommit(b.start),
  source: pointFromCommit(b.source),
})

/** A base a port carried, read in its proven lane: the commits it names. */
export const baseInCommits = (lane: JjLane, b: LaneBase): CommitBase => ({
  base: b.base,
  start: commitFromPoint(lane, b.start),
  source: commitFromPoint(lane, b.source),
})

/** A turn jj committed, as the port carries it. */
export const turnFromCommits = (
  t: TurnCommittedOf<CommitId>,
): TurnCommittedOf<PointId> => ({
  point: t.point === null ? null : pointFromCommit(t.point),
  conflicted: t.conflicted,
})

/** A merge jj made, as the port carries it. */
export function mergedFromCommits(m: MergedOf<CommitId>): MergedOf<PointId> {
  switch (m.kind) {
    case "nothing":
      return {
        ...m,
        ours: pointFromCommit(m.ours),
        mark: m.mark === null ? null : pointFromCommit(m.mark),
      }
    case "clean":
      return {
        ...m,
        from: pointFromCommit(m.from),
        ours: pointFromCommit(m.ours),
        merge: pointFromCommit(m.merge),
      }
    case "conflicted":
      return { ...m, from: pointFromCommit(m.from) }
  }
}
