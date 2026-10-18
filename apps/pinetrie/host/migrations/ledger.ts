// host/migrations/ledger — the one-time migrations a store has run, by name.
//
// Two stores with one contract (`ledger.test.ts`): a table in the session's
// SQLite file, on the store's own connection, and a set for a host without a
// file. A row says the migration's work is in the file, so it is written only
// after that work is (`migrate`, `prepareStore`).

import type { DatabaseSync } from "node:sqlite"

/** The one-time migrations a store has run, by name. */
export interface MigrationLedger {
  readonly ran: () => ReadonlySet<string>
  /** Record each name as run at `at`; a name already recorded keeps its row. */
  readonly record: (names: readonly string[], at: number) => void
}

/**
 * The ledger in `pinetrie_migrations`, beside Kyneta's `kyneta_*` tables in
 * the session's file. `db` is the store's connection, which holds the file's
 * lock: a second connection would be refused.
 */
export function sqliteLedger(db: DatabaseSync): MigrationLedger {
  db.exec(`CREATE TABLE IF NOT EXISTS pinetrie_migrations (
    name TEXT PRIMARY KEY,
    ran INTEGER NOT NULL
  ) WITHOUT ROWID`)
  const all = db.prepare("SELECT name FROM pinetrie_migrations")
  return {
    ran: () => new Set((all.all() as { name: string }[]).map(row => row.name)),
    record(names, at) {
      if (names.length === 0) return
      // One statement, so the names land together or not at all.
      db.prepare(
        `INSERT OR IGNORE INTO pinetrie_migrations (name, ran) VALUES ${names
          .map(() => "(?, ?)")
          .join(", ")}`,
      ).run(...names.flatMap(name => [name, at]))
    },
  }
}

/** The ledger of a store held in memory. */
export function memoryLedger(): MigrationLedger {
  const names = new Set<string>()
  return {
    ran: () => new Set(names),
    record(recorded) {
      for (const name of recorded) names.add(name)
    },
  }
}
