import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import { ScratchDoc } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { isBusyError, openStore, sizeOfRows } from "./store.ts"

test("a store owns its file: a second is refused until the first closes", async () => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "pinetrie-store-")),
    "s.db",
  )
  const first = openStore(file)
  expect(() => openStore(file, { busyTimeoutMs: 50 })).toThrow(
    /one owner at a time/,
  )
  await first.store.close()
  const second = openStore(file, { busyTimeoutMs: 50 })
  await second.store.close()
})

test("isBusyError reads node:sqlite's SQLITE_BUSY", () => {
  expect(isBusyError({ code: "ERR_SQLITE_ERROR", errcode: 5 })).toBe(true)
  expect(isBusyError({ code: "SQLITE_BUSY" })).toBe(false)
  expect(isBusyError(new Error("x"))).toBe(false)
})

test("storedSizes reads what Kyneta's store wrote: the newest whole record's bytes, and the records after it", async () => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "pinetrie-store-")),
    "s.db",
  )
  const opened = openStore(file)
  const exchange = new Exchange({
    principal: "pinetrie-host",
    store: opened.store,
  })
  const write = async (id: string, n: number) => {
    const doc = exchange.get(id, ScratchDoc)
    await exchange.whenHydrated(id)
    for (let i = 0; i < n; i++) {
      batch(doc, d => d.values.set(`k${i}`, { i }))
      await exchange.flush()
    }
  }
  await write("compacted", 2)
  await exchange.compact("compacted")
  const compacted = exchange.get("compacted", ScratchDoc)
  for (let i = 0; i < 3; i++) {
    batch(compacted, d => d.values.set(`later${i}`, { i }))
    await exchange.flush()
  }
  await write("never", 3)
  const sizes = opened.sizes?.(["compacted", "never"])
  const after = sizes?.get("compacted")
  expect(after?.whole).toBeGreaterThan(0)
  expect(after?.after.count).toBe(3)
  expect(after?.after.bytes).toBeGreaterThan(0)
  // A document's first write is a whole record too: Kyneta registers it
  // whole once hydration finds nothing.
  expect(sizes?.get("never")?.whole).toBeGreaterThan(0)
  expect(sizes?.get("never")?.after.count).toBe(3)
  await exchange.shutdown()
})

test("sizeOfRows: the newest whole record, and what is after it; none whole is whole 0", () => {
  const row = (bytes: number, whole: boolean) => ({ bytes, whole })
  expect(
    sizeOfRows([
      row(5, true),
      row(1, false),
      row(9, true),
      row(2, false),
      row(3, false),
    ]),
  ).toEqual({ whole: 9, after: { count: 2, bytes: 5 } })
  expect(sizeOfRows([row(1, false), row(2, false)])).toEqual({
    whole: 0,
    after: { count: 2, bytes: 3 },
  })
})
