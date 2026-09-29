// host/store — the session, kept on disk.
//
// Kyneta's exchange store (`@kyneta/sqlite-store`) over Node's built-in
// `node:sqlite`, so there is no native dependency (S22). It holds every
// document the host serves, one append-only record stream per document: today
// the one `SessionDoc`, which is also pi's storage. It is not a pi session
// file. A later change to the document's root schema cannot open an existing
// store: migrate it, or start a new file.
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

export function openStore(
  file: string,
  { busyTimeoutMs = BUSY_TIMEOUT_MS }: { readonly busyTimeoutMs?: number } = {},
): Store {
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
      `another process holds ${file}: a Pineta store has one owner at a time`,
      { cause: error },
    )
  }
  return createSqliteStore({
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
}
