import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { batch, json, Schema } from "@kyneta/schema"
import { LIVE_DOC_ID } from "@pinetrie/protocol/messages"
import { afterEach, describe, expect, test } from "vitest"
import { SCHEMA_OF, type StoredKind } from "../policy.ts"
import { openStore } from "../store.ts"
import {
  deleteStored,
  type Migration,
  migrate,
  planOpen,
  planStoredOpen,
  type RecordMigration,
  readStored,
  type StoreMigration,
} from "./index.ts"

const hashes: Record<StoredKind, string> = {
  session: "h-session",
  live: "h-live",
  places: "h-places",
  root: "h-root",
  text: "h-text",
  inventory: "h-inventory",
  attention: "h-attention",
  open: "h-open",
}
const kindOf = (docId: string): StoredKind | "kyneta" | undefined =>
  docId.startsWith("moves:")
    ? "kyneta"
    : docId === "pinetrie:session"
      ? "session"
      : docId.startsWith("root:")
        ? "root"
        : docId === "pinetrie:live"
          ? "live"
          : undefined
const plan = (
  stored: Record<string, string>,
  migrations: readonly Migration[] = [],
) =>
  planOpen({
    stored: new Map(Object.entries(stored)),
    kindOf,
    hashOf: kind => hashes[kind],
    migrations,
  })

// A changed hash here is a changed stored schema: it needs a migration from
// the old hash (`MIGRATIONS`), or the store it was written under is refused.
describe("the stored schemas", () => {
  test("each stored document's schema is the one its migrations lead to", () => {
    const now = Object.fromEntries(
      Object.entries(SCHEMA_OF).map(([k, v]) => [k, v.schemaHash]),
    )
    expect(now).toEqual({
      session: "0223893f102c08dc9c7b6f976f712a842a",
      live: "028e3f891b8953894c3667be8ca55a5946",
      places: "0283794d78e992727e2e933fa029b70753",
      root: "02065b897f9f33229f2318be54d33c6e76",
      text: "02cd0629243854b7d6f39abbc4ace6f345",
      inventory: "02d94dfca6ca2d2c5f9bb328f45759aa5b",
      attention: "024af7116f828237ae36a7acf7d388c385",
      open: "0234911a0091f81a8124b5fbfa5d339b44",
    })
  })
})

describe("planOpen", () => {
  test("a store whose hashes are this build's opens as it is", () => {
    expect(
      plan({ "pinetrie:session": "h-session", "root:r-1": "h-root" }),
    ).toEqual({ kind: "open", run: [], unknown: [] })
  })

  test("a stored hash with no migration from it is refused, naming the document and both hashes", () => {
    expect(plan({ "root:r-1": "h-old" })).toEqual({
      kind: "refuse",
      docId: "root:r-1",
      stored: "h-old",
      expected: "h-root",
    })
  })

  test("a migration from a stored hash runs on each document of its kind there, in the registry's order", () => {
    const canvasMove: Migration = {
      name: "2",
      kind: "root",
      from: "h-old",
      run: async () => async () => {},
    }
    const live: Migration = { name: "1", kind: "live", from: "h-old" }
    expect(
      plan(
        {
          "root:r-2": "h-old",
          "pinetrie:live": "h-old",
          "root:r-1": "h-old",
          "root:r-3": "h-root",
        },
        [live, canvasMove],
      ),
    ).toEqual({
      kind: "open",
      run: [
        { migration: live, docIds: ["pinetrie:live"] },
        { migration: canvasMove, docIds: ["root:r-1", "root:r-2"] },
      ],
      unknown: [],
    })
  })

  test("a migration for another kind does not apply", () => {
    const live: Migration = { name: "1", kind: "live", from: "h-old" }
    expect(plan({ "root:r-1": "h-old" }, [live]).kind).toBe("refuse")
  })

  test("an id no schema opens is reported and left alone, and a stack of moves is Kyneta's", () => {
    expect(
      plan({ "pinetrie:cards": "h-whatever", "moves:w-a:r-1": "h-kyneta" }),
    ).toEqual({
      kind: "open",
      run: [],
      unknown: ["pinetrie:cards"],
    })
  })
})

describe("this build's schemas against a store", () => {
  test("a document written under another schema, with no migration from it, is refused", async () => {
    const store = createInMemoryStore()
    const ex = new Exchange({
      principal: "host",
      type: "service",
      transports: [],
      store,
    })
    const Other = json.bind(Schema.struct({ x: Schema.record(Schema.any()) }))
    const doc = ex.get(LIVE_DOC_ID, Other)
    await ex.whenHydrated(LIVE_DOC_ID)
    batch(doc, d => d.x.set("k", 1))
    await ex.flush()
    expect(planStoredOpen(await readStored(store))).toMatchObject({
      kind: "refuse",
      docId: LIVE_DOC_ID,
      stored: Other.schemaHash,
    })
  })
})

describe("migrate", () => {
  let dir = ""
  afterEach(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true })
  })

  const Doc = json.bind(Schema.struct({ values: Schema.record(Schema.any()) }))

  /** A store holding `d` in five writes, the third torn out when `torn`. */
  async function stored(torn: boolean): Promise<string> {
    dir = mkdtempSync(path.join(tmpdir(), "migrate-"))
    const file = path.join(dir, "s.db")
    const ex = new Exchange({
      principal: "host",
      type: "service",
      transports: [],
      store: openStore(file).store,
    })
    const doc = ex.get("d", Doc)
    await ex.whenHydrated("d")
    for (let i = 0; i < 5; i++) {
      batch(doc, d => d.values.set(`k${i}`, i))
      await ex.flush()
    }
    await ex.shutdown()
    if (torn) {
      const db = new DatabaseSync(file)
      const rows = db
        .prepare(
          "select seq from kyneta_records where doc_id = 'd' and kind = 'entry' order by seq",
        )
        .all() as { seq: number }[]
      db.prepare(
        "delete from kyneta_records where doc_id = 'd' and seq = ?",
      ).run(rows[2]?.seq ?? -1)
      db.close()
    }
    return file
  }

  async function run(file: string) {
    const opened = openStore(file)
    const ex = new Exchange({
      principal: "host",
      type: "service",
      transports: [],
      store: opened.store,
    })
    const wrote: string[] = []
    const migration: Migration = {
      name: "test-move",
      kind: "root",
      from: "h",
      run: async ({ docIds, hydrated }) => {
        for (const id of docIds) {
          ex.get(id, Doc)
          await hydrated(id)
        }
        return async () => {
          for (const id of docIds) {
            batch(ex.get(id, Doc), d => d.values.set("moved", true))
            wrote.push(id)
          }
        }
      },
    }
    const lines: string[] = []
    const warn = console.warn
    console.warn = () => {}
    try {
      await migrate({
        plan: {
          kind: "open",
          run: [{ migration, docIds: ["d"] }],
          unknown: [],
        },
        records: [],
        storedIds: [],
        exchange: ex,
        backup: opened.backup,
        log: line => lines.push(line),
      })
      return { wrote, lines, error: null }
    } catch (error) {
      return { wrote, lines, error: String(error) }
    } finally {
      console.warn = warn
      await ex.shutdown()
    }
  }

  test("a migration writes after its reads, backs the store up first, and compacts", async () => {
    const file = await stored(false)
    const { wrote, lines, error } = await run(file)
    expect([wrote, error]).toEqual([["d"], null])
    expect(lines[0]).toBe(`[host] store copied to ${file}.before-test-move`)
    const ex = new Exchange({
      principal: "host",
      type: "service",
      transports: [],
      store: openStore(file).store,
    })
    const doc = ex.get("d", Doc)
    await ex.whenHydrated("d")
    expect(Object.keys(doc.values()).length).toBe(6)
    await ex.shutdown()
  })

  test("a stored record that fails to load stops the migration before it writes", async () => {
    const file = await stored(true)
    const { wrote, error } = await run(file)
    expect(wrote).toEqual([])
    expect(error).toContain("stopped a migration before it wrote anything")
  })

  test("a record migration writes only when it finds its old shape, backed up first; one that finds none writes nothing, and is not backed up for", async () => {
    const file = await stored(false)
    /** A one-time rename of `k0` to `renamed`, due while `k0` is stored. */
    const rename: RecordMigration = {
      name: "test-rename",
      run: async ({ exchange, docIds, hydrated }) => {
        if (!docIds.includes("d")) return null
        const doc = exchange.get("d", Doc)
        await hydrated("d")
        if (!("k0" in doc.values())) return null
        return async () => {
          batch(doc, d => {
            d.values.delete("k0")
            d.values.set("renamed", 0)
          })
        }
      },
    }
    const start = async () => {
      const opened = openStore(file)
      const ex = new Exchange({
        principal: "host",
        type: "service",
        transports: [],
        store: opened.store,
      })
      const lines: string[] = []
      await migrate({
        plan: { kind: "open", run: [], unknown: [] },
        records: [rename],
        storedIds: [...(await readStored(opened.store)).keys()],
        exchange: ex,
        backup: opened.backup,
        log: line => lines.push(line),
      })
      const doc = ex.get("d", Doc)
      await ex.whenHydrated("d")
      const keys = Object.keys(doc.values()).toSorted()
      await ex.shutdown()
      return { lines, keys }
    }
    const first = await start()
    expect(first.lines).toEqual([
      `[host] store copied to ${file}.before-test-rename`,
      "[host] test-rename: records migrated",
    ])
    expect(first.keys).toEqual(["k1", "k2", "k3", "k4", "renamed"])
    expect((await start()).lines).toEqual([])
  })
})

test("deleteStored deletes what each migration dooms, once, after one copy", async () => {
  const stored = new Set([
    "line:old:b→a",
    "line:old:a→b",
    "pinetrie:session",
    "root:r-1",
  ])
  const store = {
    async *listDocIds() {
      yield* [...stored]
    },
    delete: async (id: string) => void stored.delete(id),
  }
  const lines: StoreMigration = {
    name: "old-lines",
    doomed: ids => ids.filter(id => id.startsWith("line:old:")),
  }
  const roots: StoreMigration = {
    name: "roots",
    doomed: ids => ids.filter(id => id.startsWith("root:")),
  }
  const copies: string[] = []
  const logged: string[] = []
  const run = () =>
    deleteStored({
      store,
      migrations: [lines, roots],
      backup: name => {
        copies.push(name)
        return `db.before-${name}`
      },
      log: line => logged.push(line),
    })
  await run()
  expect([...stored]).toEqual(["pinetrie:session"])
  expect(copies).toEqual(["old-lines"])
  expect(logged).toEqual([
    "[host] store copied to db.before-old-lines",
    "[host] old-lines: 2 document(s) deleted",
    "[host] roots: 1 document(s) deleted",
  ])
  await run()
  expect(copies).toEqual(["old-lines"])
  expect(logged).toHaveLength(3)
})
