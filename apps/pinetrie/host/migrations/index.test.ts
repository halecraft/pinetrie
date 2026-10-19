import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { batch, json, Schema } from "@kyneta/schema"
import { CONTROL_TOPIC, LIVE_DOC_ID } from "@pinetrie/protocol/messages"
import { afterEach, describe, expect, test } from "vitest"
import { lineDocPrefix } from "../lines.ts"
import { SCHEMA_OF, type StoredKind } from "../policy.ts"
import { openStore } from "../store.ts"
import {
  type Migration,
  migrate,
  migrationNameClash,
  ONE_TIME_MIGRATIONS,
  type OneTimeRegistry,
  oneTimeNames,
  planOpen,
  planStart,
  planStoredStart,
  prepareStore,
  type RecordMigration,
  readStored,
  type StoreMigration,
} from "./index.ts"
import { type MigrationLedger, memoryLedger } from "./ledger.ts"

const hashes: Record<StoredKind, string> = {
  session: "h-session",
  live: "h-live",
  places: "h-places",
  root: "h-root",
  scratch: "h-scratch",
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
      places: "021c2551de2c5407d0256bc79fb580ee86",
      root: "02065b897f9f33229f2318be54d33c6e76",
      scratch: "0273580c3e061af065151eb6b6f081aeb0",
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
    expect(planStoredStart(await readStored(store), new Set())).toMatchObject({
      kind: "refuse",
      refusal: { kind: "hash", docId: LIVE_DOC_ID, stored: Other.schemaHash },
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

  /** `ledger`, and `ex`'s flushes, each pushing to one list of calls. */
  function callsOf(ex: Exchange, inner: MigrationLedger) {
    const calls: string[] = []
    const flush = ex.flush.bind(ex)
    ex.flush = async () => {
      calls.push("flush")
      await flush()
    }
    const ledger: MigrationLedger = {
      ran: inner.ran,
      record(names, at) {
        calls.push(`record ${names.join(", ")}`)
        inner.record(names, at)
      },
    }
    return { ledger, calls }
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
    const { ledger, calls } = callsOf(ex, opened.ledger)
    const warn = console.warn
    console.warn = () => {}
    try {
      await migrate({
        plan: {
          kind: "open",
          run: [{ migration, docIds: ["d"] }],
          unknown: [],
        },
        records: [{ name: "test-nothing", run: async () => null }],
        storedIds: ["d"],
        exchange: ex,
        opened: { ...opened, ledger },
        now: () => 1,
        log: line => lines.push(line),
      })
      return { wrote, lines, calls, error: null }
    } catch (error) {
      return { wrote, lines, calls, error: String(error) }
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
    const { wrote, calls, error } = await run(file)
    expect(wrote).toEqual([])
    expect(error).toContain("stopped a migration before it wrote anything")
    expect(calls.filter(c => c.startsWith("record"))).toEqual([])
  })

  test("migrate records each due record migration after the flush, one that found nothing too", async () => {
    const { calls, error } = await run(await stored(false))
    expect(error).toBeNull()
    expect(calls).toEqual(["flush", "record test-nothing"])
  })

  test("a record migration runs at the first start of a store whose ledger lacks it, and not at the next", async () => {
    const file = await stored(false)
    let runs = 0
    const probe: RecordMigration = {
      name: "test-probe",
      run: async ({ exchange, hydrated }) => {
        runs++
        exchange.get("d", Doc)
        await hydrated("d")
        return null
      },
    }
    const start = async () => {
      const opened = openStore(file)
      const plan = planStart({
        stored: await readStored(opened.store),
        ran: opened.ledger.ran(),
        registry: { store: [], records: [probe], retired: [] },
        kindOf: () => "kyneta",
        hashOf: kind => hashes[kind],
        migrations: [],
      })
      if (plan.kind === "refuse") throw new Error("refused")
      await prepareStore(opened, plan, { now: () => 1, log: () => {} })
      const ex = new Exchange({
        principal: "host",
        type: "service",
        transports: [],
        store: opened.store,
      })
      await migrate({
        plan: plan.open,
        records: plan.records,
        storedIds: plan.kept,
        exchange: ex,
        opened,
        now: () => 1,
        log: () => {},
      })
      await ex.shutdown()
    }
    await start()
    await start()
    expect(runs).toBe(1)
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
        opened,
        now: () => 1,
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

describe("planStart", () => {
  const line = (n: string) => `${lineDocPrefix(CONTROL_TOPIC)}${n}`
  const nothing = (name: string): RecordMigration => ({
    name,
    run: async () => null,
  })
  const deleting = (name: string, prefix: string): StoreMigration => ({
    name,
    doomed: ids => ids.filter(id => id.startsWith(prefix)),
  })
  const start = (
    stored: Record<string, string>,
    ran: readonly string[],
    registry: OneTimeRegistry,
  ) =>
    planStart({
      stored: new Map(Object.entries(stored)),
      ran: new Set(ran),
      registry,
      kindOf,
      hashOf: kind => hashes[kind],
      migrations: [],
    })
  const registry: OneTimeRegistry = {
    store: [deleting("s-1", "root:old")],
    records: [nothing("r-1"), nothing("r-2")],
    retired: ["gone-1", "gone-2"],
  }

  test("a store with nothing stored is new: it records every carried and retired name, and runs and deletes nothing", () => {
    expect(start({}, [], registry)).toMatchObject({
      kind: "open",
      record: ["s-1", "r-1", "r-2", "gone-1", "gone-2"],
      lines: [],
      deletions: [],
      records: [],
    })
  })

  test("a store in use that lacks retired names is refused, naming each", () => {
    expect(
      start({ "pinetrie:session": "h-session" }, ["gone-2"], registry),
    ).toEqual({
      kind: "refuse",
      refusal: { kind: "retired", missing: ["gone-1"] },
    })
    expect(start({ "pinetrie:session": "h-session" }, [], registry)).toEqual({
      kind: "refuse",
      refusal: { kind: "retired", missing: ["gone-1", "gone-2"] },
    })
  })

  test("a store in use runs only the one-time migrations its ledger lacks", () => {
    const plan = start(
      { "pinetrie:session": "h-session", "root:old-1": "h-root" },
      ["gone-1", "gone-2", "s-1", "r-1"],
      registry,
    )
    expect(plan).toMatchObject({ kind: "open", record: [], deletions: [] })
    if (plan.kind !== "open") return
    expect(plan.records.map(m => m.name)).toEqual(["r-2"])
    expect(plan.kept).toEqual(["pinetrie:session", "root:old-1"])
  })

  test("a ledger name neither carried nor retired is reported", () => {
    expect(
      start(
        { "pinetrie:session": "h-session" },
        ["gone-1", "gone-2", "z-newer", "a-newer", "r-1"],
        registry,
      ),
    ).toMatchObject({ kind: "open", unknownNames: ["a-newer", "z-newer"] })
  })

  test("the stored command Lines are deleted, and a store holding only Lines is in use", () => {
    expect(
      start({ [line("a→b")]: "h-line", "pinetrie:session": "h-session" }, [], {
        store: [],
        records: [],
        retired: [],
      }),
    ).toMatchObject({
      kind: "open",
      lines: [line("a→b")],
      kept: ["pinetrie:session"],
      open: { unknown: [] },
    })
    expect(start({ [line("a→b")]: "h-line" }, [], registry)).toMatchObject({
      kind: "refuse",
      refusal: { kind: "retired" },
    })
  })

  test("a store migration's documents are deleted before the hash check, which does not see them", () => {
    const plan = start(
      {
        "pinetrie:session": "h-session",
        "root:old-1": "h-stale",
        "root:r-1": "h-root",
      },
      ["gone-1", "gone-2"],
      registry,
    )
    expect(plan).toMatchObject({
      kind: "open",
      deletions: [{ ids: ["root:old-1"] }],
      kept: ["pinetrie:session", "root:r-1"],
    })
  })

  test("a hash refusal is planned before anything is deleted", () => {
    expect(
      start(
        { "root:old-1": "h-root", "root:r-1": "h-stale" },
        ["gone-1", "gone-2"],
        registry,
      ),
    ).toEqual({
      kind: "refuse",
      refusal: {
        kind: "hash",
        docId: "root:r-1",
        stored: "h-stale",
        expected: "h-root",
      },
    })
  })
})

test("prepareStore records a new store's names first, copies the store once before the first deletion, and records each due store migration, one that deleted nothing too", async () => {
  const calls: string[] = []
  const inner = memoryLedger()
  const opened = {
    store: { delete: async (id: string) => void calls.push(`delete ${id}`) },
    ledger: {
      ran: inner.ran,
      record(names: readonly string[], at: number) {
        if (names.length > 0) calls.push(`record ${names.join(", ")}`)
        inner.record(names, at)
      },
    },
    backup: (name: string) => {
      calls.push(`copy ${name}`)
      return `db.before-${name}`
    },
  }
  const migration = (name: string): StoreMigration => ({
    name,
    doomed: () => [],
  })
  await prepareStore(
    opened,
    {
      kind: "open",
      record: ["fresh"],
      lines: ["line:old"],
      deletions: [
        { migration: migration("none"), ids: [] },
        { migration: migration("roots"), ids: ["root:a", "root:b"] },
        { migration: migration("more"), ids: ["root:c"] },
      ],
      open: { kind: "open", run: [], unknown: [] },
      records: [],
      kept: [],
      unknownNames: [],
    },
    { now: () => 1, log: () => {} },
  )
  expect(calls).toEqual([
    "record fresh",
    "delete line:old",
    "record none",
    "copy roots",
    "delete root:a",
    "delete root:b",
    "record roots",
    "delete root:c",
    "record more",
  ])
})

test("migrationNameClash finds a name given twice; the build's registries have none", () => {
  expect(migrationNameClash(["a", "b", "c"])).toBeNull()
  expect(migrationNameClash(["a", "b", "a"])).toBe("a")
  expect(migrationNameClash(oneTimeNames(ONE_TIME_MIGRATIONS))).toBeNull()
})
