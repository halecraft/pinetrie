// host/store — the session, kept on disk.
//
// Kyneta's exchange store (`@kyneta/sqlite-store`) over Node's built-in
// `node:sqlite`, so there is no native dependency (S22). It holds every
// document the host serves, one append-only record stream per document: today
// the one `SessionDoc`, which is also pi's storage. It is not a pi session
// file. A later change to the document's root schema cannot open an existing
// store: migrate it, or start a new file.

import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { createSqliteStore } from "@kyneta/sqlite-store"

export function openStore(file: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
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
  return { store, close: () => db.close() }
}
