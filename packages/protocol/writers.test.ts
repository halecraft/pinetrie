import { movesDocId, rootDocId, rootIdFor, writerId } from "@pineta/core"
import { expect, test } from "vitest"
import {
  HOST_PRINCIPAL,
  LIVE_DOC_ID,
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

test("mayWrite: the session, the places, now, every root and every stack of moves are the host's; an inventory its person's, relayed by the host", () => {
  for (const doc of [
    SESSION_DOC_ID,
    PLACES_DOC_ID,
    LIVE_DOC_ID,
    rootDocId(rootIdFor("01a0ffd2-4e7a-71c8-a970-306fa07d7f09")),
    movesDocId(ADA, rootIdFor("01a0ffd2-4e7a-71c8-a970-306fa07d7f09")),
  ]) {
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
