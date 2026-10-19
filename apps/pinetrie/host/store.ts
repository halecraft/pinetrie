// host/store — the session, kept on disk.
//
// Kyneta's exchange store (`@kyneta/sqlite-store`) over Node's built-in
// `node:sqlite`, so there is no native dependency. It holds every document the
// host serves, one append-only record stream per document: the session's
// records, `pinetrie:live`, the places, and one `RootDoc` per root, which is
// that root's pi storage. It is not a pi session file. A document opens under a
// changed schema without complaint, and a dropped field's data is deleted at
// the next compaction. The host's blobs are in the same file, in
// `pinetrie_blobs` (`blobs.ts`), and the one-time migrations it has run in
// `pinetrie_migrations` (`migrations/ledger.ts`), on the same connection.
//
// The store owns its file. Kyneta's SQLite store issues the same seat on every
// open, so the host keeps its peer id across restarts; that is sound only while
// nothing else writes the file. Kyneta's own adapters take the file's lock when
// they wrap a connection, and so does this one: a second process, or a second
// store in this one, is refused, and so is any reader. `pnpm tidy` takes the
// same lock (`tidy.ts`), so a host cannot start beside it. The Runtime closes the
// store when the Exchange shuts down.

import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { Store } from "@kyneta/exchange"
import { createSqliteStore } from "@kyneta/sqlite-store"
import { type BlobStore, PRODUCT_NAME } from "@pinetrie/core"
import { sqliteBlobs } from "./blobs.ts"
import { type MigrationLedger, sqliteLedger } from "./migrations/ledger.ts"

/** How long taking the file waits for another owner to close it. */
const BUSY_TIMEOUT_MS = 5_000

/**
 * Whether `error` says another connection holds the file: `node:sqlite` reports
 * SQLite's `SQLITE_BUSY` (5) as `errcode`.
 */
export const isBusyError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "errcode" in error &&
  error.errcode === 5

/**
 * The session's file, opened and locked: this connection is its only owner
 * until it closes.
 */
export function openDatabase(
  file: string,
  { busyTimeoutMs = BUSY_TIMEOUT_MS }: { readonly busyTimeoutMs?: number } = {},
): DatabaseSync {
  mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file, { timeout: busyTimeoutMs })
  // Exclusive locking mode keeps every lock once taken; the empty exclusive
  // transaction takes the lock now, not at the first write.
  try {
    db.exec("PRAGMA locking_mode = EXCLUSIVE")
    db.exec("BEGIN EXCLUSIVE; COMMIT")
  } catch (error) {
    db.close()
    if (!isBusyError(error)) throw error
    throw new Error(
      `another process holds ${file}: a ${PRODUCT_NAME} store has one owner at a time (a host, or \`pinetrie tidy\`)`,
      { cause: error },
    )
  }
  return db
}

/**
 * A store with what describes it: its blobs and its ledger live beside it,
 * so they come with it. `backup` copies a file store and returns the copy's
 * path; a store in memory has none.
 */
export interface OpenedStore {
  readonly store: Store
  readonly blobs: BlobStore
  readonly ledger: MigrationLedger
  readonly backup: ((suffix: string) => string) | null
  /** What each document stores beside its whole record (`storedSizes`); null for a store that cannot say. */
  readonly sizes:
    | ((docIds: readonly string[]) => ReadonlyMap<string, StoredSize>)
    | null
}

/**
 * What a document stores: the bytes of its newest whole record (0 for one
 * never compacted), and the count and bytes of the records after it.
 */
export interface StoredSize {
  readonly whole: number
  readonly after: { readonly count: number; readonly bytes: number }
}

/** A stored entry record as `storedSizes` reads it: its bytes, and whether it is a whole record. */
interface SizedRow {
  readonly bytes: number
  readonly whole: boolean
}

/** `rows`, in the order stored, as one document's `StoredSize`. */
export function sizeOfRows(rows: readonly SizedRow[]): StoredSize {
  const last = rows.findLastIndex(r => r.whole)
  const after = rows.slice(last + 1)
  return {
    whole: last < 0 ? 0 : (rows[last]?.bytes ?? 0),
    after: {
      count: after.length,
      bytes: after.reduce((n, r) => n + r.bytes, 0),
    },
  }
}

/**
 * Kyneta's SQLite store writes an entry record's payload as JSON with `kind`
 * first (`toRow`, `@kyneta/sql-core`), so a whole record's begins with this,
 * and is told apart without parsing a payload of megabytes.
 */
const WHOLE_PAYLOAD = '{"kind":"entirety"'

/** Each document's `StoredSize`, read from Kyneta's records table: one query per document, payloads never read. */
function storedSizes(
  db: DatabaseSync,
  docIds: readonly string[],
): ReadonlyMap<string, StoredSize> {
  const rows = db.prepare(
    `SELECT COALESCE(LENGTH(payload), 0) + COALESCE(LENGTH(blob), 0) AS bytes,
            substr(payload, 1, ${WHOLE_PAYLOAD.length}) AS head
       FROM kyneta_records WHERE doc_id = ? AND kind = 'entry' ORDER BY seq`,
  )
  return new Map(
    docIds.map(id => [
      id,
      sizeOfRows(
        (rows.all(id) as { bytes: number; head: string | null }[]).map(r => ({
          bytes: r.bytes,
          whole: r.head === WHOLE_PAYLOAD,
        })),
      ),
    ]),
  )
}

/**
 * The session's store, the host's blobs and the migrations' ledger, over one
 * connection to `file`. Closing the store closes the connection, and with it
 * the blobs and the ledger. `backup` writes a consistent copy beside the
 * file, through the same connection, since the store holds the file's lock.
 */
export function openStore(
  file: string,
  options: {
    readonly busyTimeoutMs?: number
    /** The blobs' clock, which stamps each one as it is stored or touched. */
    readonly now?: () => number
  } = {},
): OpenedStore & { readonly backup: (suffix: string) => string } {
  const db = openDatabase(file, options)
  const store = createSqliteStore({
    exec: (sql, ...params) => void db.prepare(sql).run(...(params as never[])),
    iterate: <T>(sql: string, ...params: unknown[]) =>
      db.prepare(sql).iterate(...(params as never[])) as Iterable<T>,
    transaction<R>(fn: () => R): R {
      db.exec("BEGIN")
      try {
        const result = fn()
        db.exec("COMMIT")
        return result
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    close: () => db.close(),
  })
  const backup = (suffix: string): string => {
    const base = `${file}.before-${suffix}`
    const to = existsSync(base) ? `${base}-${Date.now()}` : base
    db.prepare("VACUUM INTO ?").run(to)
    return to
  }
  return {
    store,
    blobs: sqliteBlobs(db, options.now),
    ledger: sqliteLedger(db),
    backup,
    sizes: docIds => storedSizes(db, docIds),
  }
}
