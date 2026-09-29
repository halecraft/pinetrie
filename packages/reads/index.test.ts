import { newSessionDoc, type StoredEntryRow, writeEntry } from "@pineta/schema"
import { expect, test } from "vitest"
import { readTreeIndex } from "./index.ts"

const row = (id: string, parentId: string | null): StoredEntryRow => ({
  id,
  parentId,
  type: "message",
  timestamp: 0,
  fromId: null,
  payload: { message: { role: "user", content: id } },
})

test("readTreeIndex keeps the index, and each unchanged entry, until entries change", () => {
  const doc = newSessionDoc()
  writeEntry(doc, row("e1", null))
  writeEntry(doc, row("e2", "e1"))
  const before = readTreeIndex(doc)

  doc.values.set("k", { namespace: "n", key: "k", value: 1 })
  expect(readTreeIndex(doc)).toBe(before)

  writeEntry(doc, row("e3", "e2"))
  const after = readTreeIndex(doc)
  expect(after).not.toBe(before)
  expect(after.entries.e1).toBe(before.entries.e1)
  expect(after.entries.e2).toBe(before.entries.e2)
  expect(after.childrenOf.get("e2")).toEqual(["e3"])
})
