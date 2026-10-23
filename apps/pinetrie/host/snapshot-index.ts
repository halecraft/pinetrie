// host/snapshot-index — the host's index of its project's entry snapshots,
// in `pinetrie_snapshots` beside the documents' tables in the session's
// file (`@pinetrie/machine`'s `SnapshotIndex`). A store serves one folder,
// and the project's lock keeps one host on it, so the rows are that
// project's alone and carry no project of their own.

import { DatabaseSync } from "node:sqlite"
import {
  type IndexedSnapshot,
  isThreadId,
  type SnapshotId,
  snapshotId,
} from "@pinetrie/core"
import {
  type Reservation,
  ROW_STATES,
  type RowState,
  type SnapshotIndex,
  type SnapshotRow,
} from "@pinetrie/machine"

interface Stored {
  readonly snapshot: string
  readonly lane: string
  readonly changed: number
  readonly used: number
  readonly branched: number
  readonly state: string
}

const isRowState = (s: string): s is RowState =>
  (ROW_STATES as readonly string[]).includes(s)

/** A stored row as a row; null for one no writer of this code made. */
function decodeRow(r: Stored): SnapshotRow | null {
  if (!isThreadId(r.lane) || !isRowState(r.state)) return null
  return {
    snapshot: snapshotId(r.snapshot),
    lane: r.lane,
    changed: r.changed,
    used: r.used,
    branched: r.branched !== 0,
    state: r.state,
  }
}

/**
 * The index over `db`, the store's connection, which holds the file's lock:
 * a second connection would be refused. Its tables are made if missing.
 */
export function sqliteSnapshotIndex(db: DatabaseSync): SnapshotIndex {
  db.exec(`CREATE TABLE IF NOT EXISTS pinetrie_snapshots (
    snapshot TEXT PRIMARY KEY,
    lane TEXT NOT NULL,
    changed INTEGER NOT NULL,
    used INTEGER NOT NULL,
    branched INTEGER NOT NULL,
    state TEXT NOT NULL
  ) WITHOUT ROWID`)
  db.exec(`CREATE TABLE IF NOT EXISTS pinetrie_snapshots_meta (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  ) WITHOUT ROWID`)
  // The next use is the highest so far plus one: the order of uses, whatever
  // the clock does.
  const NEXT_USE = "(SELECT COALESCE(MAX(used), 0) + 1 FROM pinetrie_snapshots)"
  const reserve = db.prepare(
    `INSERT INTO pinetrie_snapshots (snapshot, lane, changed, used, branched, state)
     VALUES (?, ?, ?, ${NEXT_USE}, 0, 'reserved')
     ON CONFLICT(snapshot) DO UPDATE SET
       lane = excluded.lane, changed = excluded.changed,
       used = excluded.used, state = 'reserved'`,
  )
  const fromReserved = db.prepare(
    "UPDATE pinetrie_snapshots SET state = ? WHERE snapshot = ? AND state = 'reserved'",
  )
  const used = db.prepare(
    `UPDATE pinetrie_snapshots SET used = ${NEXT_USE}, branched = MAX(branched, ?)
     WHERE snapshot = ?`,
  )
  const all = db.prepare(
    "SELECT snapshot, lane, changed, used, branched, state FROM pinetrie_snapshots",
  )
  const reserved = db.prepare(
    "SELECT snapshot FROM pinetrie_snapshots WHERE state = 'reserved'",
  )
  const keptAgain = db.prepare(
    "UPDATE pinetrie_snapshots SET state = 'kept' WHERE lane = ? AND state = 'to-delete'",
  )
  const toDelete = db.prepare(
    "UPDATE pinetrie_snapshots SET state = 'to-delete' WHERE snapshot = ? AND state = 'kept'",
  )
  const deleted = db.prepare(
    "UPDATE pinetrie_snapshots SET state = 'deleted' WHERE snapshot = ? AND state != 'reserved'",
  )
  const meta = db.prepare(
    "SELECT value FROM pinetrie_snapshots_meta WHERE key = 'complete'",
  )
  const recorded = db.prepare(
    `INSERT INTO pinetrie_snapshots (snapshot, lane, changed, used, branched, state)
     VALUES (?, ?, ?, ${NEXT_USE}, 0, 'kept')
     ON CONFLICT(snapshot) DO NOTHING`,
  )
  const complete = db.prepare(
    "INSERT OR REPLACE INTO pinetrie_snapshots_meta (key, value) VALUES ('complete', 1)",
  )
  /** `work` as one transaction: every row it changes, or none. */
  const atomically = (work: () => void) => {
    db.exec("BEGIN")
    try {
      work()
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }
  return {
    rows: () =>
      (all.all() as unknown as Stored[]).flatMap(r => {
        const row = decodeRow(r)
        return row === null ? [] : [row]
      }),
    reserve(row) {
      reserve.run(row.snapshot, row.lane, row.changed)
      return row.snapshot as Reservation
    },
    markTaken(reservation) {
      fromReserved.run("kept", reservation)
      return reservation as SnapshotId as IndexedSnapshot
    },
    markNotTaken(reservation) {
      fromReserved.run("deleted", reservation)
    },
    markUsed(snapshot, branched) {
      used.run(branched ? 1 : 0, snapshot)
    },
    settleReserved(listed) {
      const names = (
        reserved.all() as unknown as { readonly snapshot: string }[]
      ).map(r => snapshotId(r.snapshot))
      atomically(() => {
        for (const name of names)
          fromReserved.run(listed.has(name) ? "kept" : "deleted", name)
      })
    },
    keepAgain(lanes) {
      atomically(() => {
        for (const lane of lanes) keptAgain.run(lane)
      })
    },
    markToDelete(snapshots) {
      atomically(() => {
        for (const s of snapshots) toDelete.run(s)
      })
    },
    markDeleted(snapshots) {
      atomically(() => {
        for (const s of snapshots) deleted.run(s)
      })
    },
    indexRecorded(rows) {
      atomically(() => {
        for (const r of rows) recorded.run(r.snapshot, r.lane, r.changed)
      })
    },
    isComplete: () => meta.get() !== undefined,
    markComplete() {
      complete.run()
    },
  }
}

/** The same index over a database of its own in memory: a store in memory's, and the tests'. */
export const memorySnapshotIndex = (): SnapshotIndex =>
  sqliteSnapshotIndex(new DatabaseSync(":memory:"))
