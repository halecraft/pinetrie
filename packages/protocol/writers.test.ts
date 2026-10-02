import { writerId } from "@pineta/core"
import { expect, test } from "vitest"
import {
  HOST_PRINCIPAL,
  PLACES_DOC_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "./messages.ts"
import { inventoryDocId, mayWrite, writerOfInventoryDoc } from "./writers.ts"

const ADA = writerId("ada@x.io")

test("an inventory's document names its writer, and nothing else names one", () => {
  expect(writerOfInventoryDoc(inventoryDocId(ADA))).toBe(ADA)
  for (const other of [
    "inventory:",
    "inventory:ada@x.io",
    "inventory:w-Ada@X.io",
    "card:c-1",
    "places",
  ])
    expect(writerOfInventoryDoc(other)).toBeUndefined()
})

test("mayWrite: the session and the places are the host's; an inventory its person's, relayed by the host", () => {
  for (const doc of [SESSION_DOC_ID, PLACES_DOC_ID]) {
    expect(mayWrite(doc, HOST_PRINCIPAL)).toBe(true)
    expect(mayWrite(doc, "ada@x.io")).toBe(false)
  }
  const inventory = inventoryDocId(ADA)
  expect(mayWrite(inventory, "Ada@X.io")).toBe(true)
  expect(mayWrite(inventory, HOST_PRINCIPAL)).toBe(true)
  expect(mayWrite(inventory, "bea@x.io")).toBe(false)
  expect(mayWrite(inventory, undefined)).toBe(false)
  for (const doc of [PRESENCE_DOC_ID, "card:c-1", "undo:seat-a"])
    expect(mayWrite(doc, "ada@x.io")).toBeUndefined()
})
