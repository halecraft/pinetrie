// machine/snapshot-index — the host's index of a project's entry snapshots,
// as rows and ports: what the upkeep reads instead of every root's records.
// A row is written before its snapshot is taken, so nothing the host makes is
// ever unindexed. Each writer is given the narrowest port it needs: the
// host's lane work takes `SnapshotTaking`, and only the manager the whole
// `SnapshotIndex`, so only its keeper changes a row's state otherwise.

import type {
  Deletable,
  IndexedSnapshot,
  SnapshotId,
  ThreadId,
} from "@pinetrie/core"

/** `reserved`: the name is the row's before the snapshot is taken; no upkeep touches it. */
export const ROW_STATES = ["reserved", "kept", "to-delete", "deleted"] as const
export type RowState = (typeof ROW_STATES)[number]

export interface SnapshotRow {
  readonly snapshot: SnapshotId
  readonly lane: ThreadId
  /** The paths its turn changed: what its metadata costs grows with it. */
  readonly changed: number
  /** Its place in the order of uses: higher is more recent. Never a clock. */
  readonly used: number
  /** Someone branched from it: never deleted while its lane lives. */
  readonly branched: boolean
  readonly state: RowState
}

declare const reservationBrand: unique symbol
/** A name the index holds `reserved`: what a snapshot is taken under. No record may name it. */
export type Reservation = SnapshotId & { readonly [reservationBrand]: true }

export interface SnapshotReads {
  rows(): readonly SnapshotRow[]
}

/** What the host's lane work may write: a snapshot's own life, and its uses. */
export interface SnapshotTaking extends SnapshotReads {
  /**
   * The row `reserved`, as the newest use. A name with a row already is
   * reset, whatever its state: a retake reuses its name.
   */
  reserve(row: Pick<SnapshotRow, "snapshot" | "lane" | "changed">): Reservation
  /** Its snapshot was taken: `reserved` becomes `kept`. The only maker of core's `IndexedSnapshot`. */
  markTaken(reservation: Reservation): IndexedSnapshot
  /** Its snapshot was never made: `reserved` becomes `deleted`, with no `Deletable` to show. */
  markNotTaken(reservation: Reservation): void
  /** Read as a source: the newest use; `branched` once a branch took it, never unset. A name with no row is no one's. */
  markUsed(snapshot: SnapshotId, branched: boolean): void
}

/** The whole index: given to the manager alone. */
export interface SnapshotIndex extends SnapshotTaking {
  /** At the host's start: every `reserved` row is a dead host's, `kept` if listed, else `deleted`. */
  settleReserved(listed: ReadonlySet<SnapshotId>): void
  /** A restore's lanes' rows marked to delete are kept again. */
  keepAgain(lanes: readonly ThreadId[]): void
  markToDelete(snapshots: readonly SnapshotId[]): void
  /**
   * Set just before the deletion, so no fork picks a snapshot about to go.
   * A deletion that fails or is cut short leaves its name listed: the next
   * step deletes it again.
   */
  markDeleted(snapshots: readonly Deletable<"entry">[]): void
  /** Whether every root's records have been read in: until then no unindexed entry is deleted. */
  isComplete(): boolean
  markComplete(): void
}
