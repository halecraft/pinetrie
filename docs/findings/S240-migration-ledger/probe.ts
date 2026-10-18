// S240 probe: is a record migration's write in the store's file once
// `exchange.flush()` resolves, so a ledger row written after it on the same
// connection never lands without the write it records?
//
//   node s240-probe.ts write <file> <mode>   writes, marks, then SIGKILLs itself
//   node s240-probe.ts read <file>           reports what the file holds
//
// modes: unflushed (mark in the same tick as the write), flushed (mark after
// flush), compacted (flush, compact, unload, then mark), lateflush (mark after
// one macrotask, no flush)

import { Exchange } from "@kyneta/exchange"
import { createSqliteStore } from "@kyneta/sqlite-store"
import { SESSION_TARGET } from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { applyRecordWrites, readNamespace, SessionDoc } from "@pinetrie/schema"
import { openDatabase } from "./store.ts"
import { readStored } from "./migrations/index.ts"


const NS = "pinetrie.probe"

function open(file: string) {
  const db = openDatabase(file)
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
  db.exec(`CREATE TABLE IF NOT EXISTS pinetrie_migrations (
    name TEXT PRIMARY KEY,
    ran INTEGER NOT NULL
  ) WITHOUT ROWID`)
  return { db, store }
}

const [, , cmd, file, mode] = process.argv
if (file === undefined) throw new Error("usage")

if (cmd === "write") {
  const { db, store } = open(file)
  const storedBefore = await readStored(store)
  const exchange = new Exchange({ principal: "pinetrie-host", store })
  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
  await exchange.whenHydrated(SESSION_DOC_ID)
  applyRecordWrites(doc, [
    { kind: "set", target: SESSION_TARGET, namespace: NS, key: mode ?? "?", value: { v: 1 } },
  ])
  const mark = () =>
    db.prepare("INSERT OR REPLACE INTO pinetrie_migrations VALUES (?, ?)").run(mode ?? "?", 1)
  if (mode === "unflushed") mark()
  else if (mode === "lateflush") {
    await new Promise(r => setTimeout(r, 0))
    mark()
  } else if (mode === "flushed") {
    await exchange.flush()
    mark()
  } else if (mode === "compacted") {
    await exchange.flush()
    await exchange.compact(SESSION_DOC_ID)
    exchange.unload(SESSION_DOC_ID)
    mark()
  }
  console.log(
    JSON.stringify({
      storedBefore: storedBefore.size,
      journal: db.prepare("PRAGMA journal_mode").get(),
      synchronous: db.prepare("PRAGMA synchronous").get(),
    }),
  )
  process.kill(process.pid, "SIGKILL")
} else if (cmd === "read") {
  const { db, store } = open(file)
  const exchange = new Exchange({ principal: "pinetrie-host", store })
  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
  await exchange.whenHydrated(SESSION_DOC_ID)
  const ledger = db.prepare("SELECT name FROM pinetrie_migrations").all()
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
  console.log(JSON.stringify({ records: readNamespace(doc, NS), ledger, tables }))
  if (mode === "backup") {
    db.prepare("VACUUM INTO ?").run(`${file}.copy`)
    const copy = openDatabase(`${file}.copy`)
    console.log(
      JSON.stringify({ copyLedger: copy.prepare("SELECT name FROM pinetrie_migrations").all() }),
    )
    copy.close()
  }
  await exchange.shutdown()
}
