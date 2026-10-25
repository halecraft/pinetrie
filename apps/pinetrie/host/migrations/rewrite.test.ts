import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import {
  rootDocId,
  rootIdFor,
  SESSION_TARGET,
  type Target,
} from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import {
  applyRecordWrites,
  RootDoc,
  readNamespace,
  SessionDoc,
} from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import {
  deleteRecords,
  planHistoryRewrites,
  renamedFields,
  rewriteRecords,
} from "./rewrite.ts"

const NS = "pinetrie.test" as const
const TO = "pinetrie.moved" as const
const OTHER = "pinetrie.other" as const
const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

/** A stand-in rewrite: `old` becomes `new`; a record without `old` is left. */
const rename = (contents: unknown): object | null => {
  if (contents === null || typeof contents !== "object") return null
  if (!("old" in contents)) return null
  const { old, ...rest } = contents as { readonly old: unknown }
  return { ...rest, new: old }
}

async function storeWith(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
) {
  const exchange = new Exchange({
    principal: "pinetrie-host",
    store: createInMemoryStore(),
  })
  const s = exchange.get(SESSION_DOC_ID, SessionDoc)
  const r = exchange.get(rootDocId(ROOT), RootDoc)
  await exchange.whenHydrated(SESSION_DOC_ID)
  await exchange.whenHydrated(rootDocId(ROOT))
  const set = (target: Target, values: object) =>
    Object.entries(values).map(([key, value]) => ({
      kind: "set" as const,
      target,
      namespace: NS,
      key,
      value,
    }))
  applyRecordWrites(s, set(SESSION_TARGET, session))
  applyRecordWrites(r, set({ kind: "root", root: ROOT }, root))
  // A record of another namespace, which no migration of `NS` touches.
  applyRecordWrites(s, [
    {
      kind: "set",
      target: SESSION_TARGET,
      namespace: OTHER,
      key: "z",
      value: {},
    },
  ])
  const migrationRun = {
    exchange,
    docIds: [SESSION_DOC_ID, rootDocId(ROOT), "pinetrie:places"],
    hydrated: (id: string) => exchange.whenHydrated(id),
  }
  const run = (home: "session" | "root", to?: typeof TO) =>
    rewriteRecords({
      name: "test",
      namespace: NS,
      ...(to === undefined ? {} : { to }),
      home,
      rewrite: rename,
    }).run(migrationRun)
  const remove = (home: "session" | "root") =>
    deleteRecords({ name: "test", namespace: NS, home }).run(migrationRun)
  return {
    run,
    remove,
    session: () => readNamespace(s, NS),
    root: () => readNamespace(r, NS),
    moved: () => readNamespace(s, TO),
    other: () => readNamespace(s, OTHER),
  }
}

describe("rewriteRecords: a namespace's records, each by a pure rewrite", () => {
  test("each record the rewrite changes is written in its home; one it leaves is untouched", async () => {
    const store = await storeWith(
      { a: { old: 1, keep: "x" }, b: { new: 2 } },
      { a: { old: 3 } },
    )
    const write = await store.run("session")
    expect(write).not.toBeNull()
    await write?.()
    expect(store.session()).toEqual({ a: { keep: "x", new: 1 }, b: { new: 2 } })
    expect(store.root()).toEqual({ a: { old: 3 } })
    await (await store.run("root"))?.()
    expect(store.root()).toEqual({ a: { new: 3 } })
  })

  test("no step when no record is in the old shape", async () => {
    const store = await storeWith({ b: { new: 2 } }, {})
    expect(await store.run("session")).toBeNull()
    expect(await store.run("root")).toBeNull()
  })

  test("a record moved to another namespace is rewritten there and leaves the old one", async () => {
    const store = await storeWith({ a: { old: 1 }, b: { new: 2 } }, {})
    await (await store.run("session", TO))?.()
    expect(store.moved()).toEqual({ a: { new: 1 }, b: { new: 2 } })
    expect(store.session()).toEqual({})
  })

  test("no step when the old namespace is empty", async () => {
    const store = await storeWith({}, {})
    expect(await store.run("session", TO)).toBeNull()
  })
})

describe("deleteRecords: a namespace's records, all gone", () => {
  test("deleteRecords deletes every record of its namespace in its home, and no other", async () => {
    const store = await storeWith({ a: { old: 1 }, b: { new: 2 } }, { c: {} })
    await (await store.remove("session"))?.()
    expect(store.session()).toEqual({})
    expect(store.root()).toEqual({ c: {} })
    expect(store.other()).toEqual({ z: {} })
    expect(await store.remove("session")).toBeNull()
  })
})

describe("renamedFields: a record's top-level fields renamed", () => {
  const rename = renamedFields({ yours: "workingCopy" })

  test("an old field takes its new name, with its value and the rest kept", () => {
    expect(rename({ yours: { behind: 1 }, commit: "c" })).toEqual({
      workingCopy: { behind: 1 },
      commit: "c",
    })
  })

  test("a record already in the new shape, or not an object, needs nothing", () => {
    expect(rename({ workingCopy: { behind: 1 } })).toBeNull()
    expect(rename(null)).toBeNull()
    expect(rename("yours")).toBeNull()
  })

  test("a record holding both names keeps the new one's value", () => {
    expect(rename({ yours: 1, workingCopy: 2 })).toEqual({ workingCopy: 2 })
  })
})

describe("planHistoryRewrites: one kind of history message's details", () => {
  const row = (id: string, message: unknown) => ({
    id,
    parentId: null,
    type: "message",
    timestamp: 1,
    fromId: null,
    thread: "t-1",
    payload: { type: "message", message },
  })
  const custom = (customType: string, details: object) => ({
    role: "custom",
    customType,
    content: "what the model read",
    details,
  })
  const rename = renamedFields({ old: "new" })

  test("a message of the kind gets its new details, its content and row kept", () => {
    const [written] = planHistoryRewrites(
      { a: row("a", custom("pinetrie.x", { old: 1 })) },
      "pinetrie.x",
      rename,
    )
    expect(written).toEqual(
      row("a", { ...custom("pinetrie.x", {}), details: { new: 1 } }),
    )
  })

  test("another kind, a message the rewrite leaves, or no message, writes nothing", () => {
    expect(
      planHistoryRewrites(
        {
          a: row("a", custom("pinetrie.y", { old: 1 })),
          b: row("b", custom("pinetrie.x", { new: 1 })),
          c: row("c", undefined),
        },
        "pinetrie.x",
        rename,
      ),
    ).toEqual([])
  })
})

test("a history message of one type takes another, its details and content kept", () => {
  const row = {
    id: "a",
    parentId: null,
    type: "message",
    timestamp: 1,
    fromId: null,
    thread: "t-1",
    payload: {
      type: "message",
      message: {
        role: "custom",
        customType: "pinetrie.heard",
        content: "c",
        details: { from: "t-2" },
      },
    },
  }
  const [written] = planHistoryRewrites(
    { a: row },
    "pinetrie.heard",
    () => null,
    "pinetrie.incoming",
  )
  expect(written?.payload).toEqual({
    type: "message",
    message: {
      role: "custom",
      customType: "pinetrie.incoming",
      content: "c",
      details: { from: "t-2" },
    },
  })
  expect(
    planHistoryRewrites(
      { a: row },
      "pinetrie.other",
      () => null,
      "pinetrie.incoming",
    ),
  ).toEqual([])
})
