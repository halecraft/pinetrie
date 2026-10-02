import { writerId } from "@pineta/core"
import { expect, test } from "vitest"
import { inventoryDocId, writerOfInventoryDoc } from "./inventory.ts"

test("an inventory's document names its writer, and nothing else names one", () => {
  const ada = writerId("ada@x.io")
  expect(writerOfInventoryDoc(inventoryDocId(ada))).toBe(ada)
  for (const other of [
    "inventory:",
    "inventory:ada@x.io",
    "inventory:w-Ada@X.io",
    "card:c-1",
    "places",
  ])
    expect(writerOfInventoryDoc(other)).toBeUndefined()
})
