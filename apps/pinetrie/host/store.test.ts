import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { isBusyError, openStore } from "./store.ts"

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
