// host/work/snapshot-taking — a turn's or a merge's snapshot taken under its
// index row: the row reserved before the snapshot, then marked taken or not.
// The only caller of the index's `reserve`, `markTaken` and `markNotTaken`,
// so the row always comes first and a record only ever names a snapshot
// that is there.

import type { IndexedSnapshot } from "@pinetrie/core"
import type { SnapshotRow, SnapshotTaking } from "@pinetrie/machine"

/** How a snapshot's taking went. */
export type TakenSnapshot =
  | { readonly kind: "taken"; readonly snapshot: IndexedSnapshot }
  /** The snapshot failed; its row is marked not taken. */
  | { readonly kind: "failed"; readonly error: unknown }
  /** The index could not be written: the snapshot was skipped, or is not named. */
  | { readonly kind: "unindexed"; readonly error: unknown }

/**
 * `take` under `row`'s reservation. A failed index write before the snapshot
 * skips it; after it, the snapshot stays unnamed, its row `reserved` until
 * the next start settles it. Either way `skipped` is told, for the
 * machine's health.
 */
export async function takeIndexedSnapshot(input: {
  readonly taking: SnapshotTaking
  readonly row: Pick<SnapshotRow, "snapshot" | "lane" | "changed">
  /** The snapshot's steps (`planSnapshot`). */
  readonly take: () => Promise<void>
  readonly skipped: () => void
}): Promise<TakenSnapshot> {
  const { taking } = input
  let reservation: ReturnType<SnapshotTaking["reserve"]>
  try {
    reservation = taking.reserve(input.row)
  } catch (error) {
    input.skipped()
    return { kind: "unindexed", error }
  }
  try {
    await input.take()
  } catch (error) {
    // A row left reserved is settled at the next start; nothing is lost.
    try {
      taking.markNotTaken(reservation)
    } catch {}
    return { kind: "failed", error }
  }
  try {
    return { kind: "taken", snapshot: taking.markTaken(reservation) }
  } catch (error) {
    input.skipped()
    return { kind: "unindexed", error }
  }
}
