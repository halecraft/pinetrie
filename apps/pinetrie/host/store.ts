// host/store — the session, kept on disk.
//
// Kyneta's exchange store (`@kyneta/sqlite-store`) over Node's built-in
// `node:sqlite`, so there is no native dependency (S22). It holds every
// document the host serves, one append-only record stream per document: the
// session's records, `pinetrie:live`, the places, and one `StorageDoc` per root,
// which is that root's pi storage (ADR-0063). It is not a pi session file. A
// document whose root schema drops a field still opens (S86); any other
// change to it cannot open an existing store: migrate it, or start a new
// file. The host's images are in the same file, in `pinetrie_blobs` (`blobs.ts`,
// ADR-0042), on the same connection.
//
// The store owns its file (S47). Kyneta's SQLite store issues the same seat on
// every open, so the host keeps its peer id across restarts; that is sound
// only while nothing else writes the file. Kyneta's own adapters take the
// file's lock when they wrap a connection, and so does this one: a second
// process, or a second store in this one, is refused, and so is any reader.
// The Runtime closes the store when the Exchange shuts down.

import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { Store } from "@kyneta/exchange"
import { createSqliteStore } from "@kyneta/sqlite-store"
import { type BlobStore, PRODUCT_NAME } from "@pinetrie/core"
import { sqliteBlobs } from "./blobs.ts"

/** How long taking the file waits for another owner to close it. */
const BUSY_TIMEOUT_MS = 5_000

/**
 * Whether `error` says another connection holds the file: `node:sqlite`
 * reports SQLite's `SQLITE_BUSY` (5) as `errcode` (S47). Pure.
 */
export const isBusyError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "errcode" in error &&
  error.errcode === 5

/**
 * The session's file, opened and locked: this connection is its only owner
 * until it closes (S47).
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
      `another process holds ${file}: a ${PRODUCT_NAME} store has one owner at a time`,
      { cause: error },
    )
  }
  return db
}

/**
 * The session's store and the host's blobs, over one connection to `file`.
 * Closing the store closes the connection, and with it the blobs.
 */
export function openStore(
  file: string,
  options: { readonly busyTimeoutMs?: number } = {},
): { readonly store: Store; readonly blobs: BlobStore } {
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
  return { store, blobs: sqliteBlobs(db) }
}
