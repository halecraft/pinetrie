import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { batch, json, Schema } from "@kyneta/schema"
import { LIVE_DOC_ID } from "@pinetrie/protocol/messages"
import { afterEach, describe, expect, test } from "vitest"
import type { StoredKind } from "../policy.ts"
import { openStore } from "../store.ts"
import {
  type Migration,
  migrate,
  planOpen,
  planStoredOpen,
  readStored,
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
    const rootMove: Migration = {
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
        [live, rootMove],
      ),
    ).toEqual({
      kind: "open",
      run: [
        { migration: live, docIds: ["pinetrie:live"] },
        { migration: rootMove, docIds: ["root:r-1", "root:r-2"] },
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
})
