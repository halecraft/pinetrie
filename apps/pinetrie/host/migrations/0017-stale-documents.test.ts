import { expect, test } from "vitest"
import { staleDocuments } from "./0017-stale-documents.ts"
import { deleteStored, type StoreMigration } from "./index.ts"

const STORED = [
  "line:pineta.control:b→a",
  "pinetrie:cards",
  "line:pineta.control:a→b",
  "line:pinetrie.control:a→host",
  "pinetrie:session",
  "root:r-1",
]

test("only the pineta Lines and the old cards document are doomed", () => {
  expect(staleDocuments.doomed(STORED).toSorted()).toEqual([
    "line:pineta.control:a→b",
    "line:pineta.control:b→a",
    "pinetrie:cards",
  ])
})

test("deleteStored deletes what each migration dooms, once, after one copy", async () => {
  const stored = new Set(STORED)
  const store = {
    async *listDocIds() {
      yield* [...stored]
    },
    delete: async (id: string) => void stored.delete(id),
  }
  const roots: StoreMigration = {
    name: "roots",
    doomed: ids => ids.filter(id => id.startsWith("root:")),
  }
  const copies: string[] = []
  const lines: string[] = []
  const run = () =>
    deleteStored({
      store,
      migrations: [staleDocuments, roots],
      backup: name => {
        copies.push(name)
        return `db.before-${name}`
      },
      log: line => lines.push(line),
    })
  await run()
  expect([...stored].sort()).toEqual([
    "line:pinetrie.control:a→host",
    "pinetrie:session",
  ])
  expect(copies).toEqual(["0017-stale-documents"])
  expect(lines).toEqual([
    "[host] store copied to db.before-0017-stale-documents",
    "[host] 0017-stale-documents: 3 document(s) deleted",
    "[host] roots: 1 document(s) deleted",
  ])
  await run()
  expect(copies).toEqual(["0017-stale-documents"])
  expect(lines).toHaveLength(3)
})
