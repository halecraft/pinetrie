import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { openStore } from "../store.ts"
import { type MigrationLedger, memoryLedger } from "./ledger.ts"

let dir = ""
afterEach(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true })
  dir = ""
})
const file = () => {
  dir = mkdtempSync(path.join(tmpdir(), "ledger-"))
  return path.join(dir, "s.db")
}

describe.each([
  ["memory", () => memoryLedger()],
  ["sqlite", () => openStore(file()).ledger],
] as const)("the %s ledger", (_, make: () => MigrationLedger) => {
  test("names recorded are read back, and one recorded twice is kept once", () => {
    const ledger = make()
    expect(ledger.ran()).toEqual(new Set())
    ledger.record(["0001-a", "0002-b"], 1)
    ledger.record(["0002-b"], 2)
    ledger.record([], 3)
    expect(ledger.ran()).toEqual(new Set(["0001-a", "0002-b"]))
  })
})

test("a file's ledger survives a reopen, and the store's backup copies it", async () => {
  const at = file()
  const first = openStore(at)
  first.ledger.record(["0001-a"], 1)
  const copy = first.backup("test")
  await first.store.close()
  const reopened = openStore(at)
  expect(reopened.ledger.ran()).toEqual(new Set(["0001-a"]))
  await reopened.store.close()
  const copied = openStore(copy)
  expect(copied.ledger.ran()).toEqual(new Set(["0001-a"]))
  await copied.store.close()
})
