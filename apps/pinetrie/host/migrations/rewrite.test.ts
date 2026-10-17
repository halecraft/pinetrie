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
import { rewriteRecords } from "./rewrite.ts"

const NS = "pinetrie.test" as const
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
  const run = (home: "session" | "root") =>
    rewriteRecords({ name: "test", namespace: NS, home, rewrite: rename }).run({
      exchange,
      docIds: [SESSION_DOC_ID, rootDocId(ROOT), "pinetrie:places"],
      hydrated: id => exchange.whenHydrated(id),
    })
  return {
    run,
    session: () => readNamespace(s, NS),
    root: () => readNamespace(r, NS),
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
})
