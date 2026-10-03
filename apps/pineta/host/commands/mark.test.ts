import { entryId, writerId } from "@pineta/core"
import { deleteRecord, MARK, setRecord } from "@pineta/marginalia"
import { writeEntry } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, putValue, record, row, writesOf } from "../fakes.ts"
import { handleMark, type MarkDeps } from "./mark.ts"

test("clearing a root's title removes its mark", async () => {
  const b = basics()
  const root = entryId("e-1")
  const ada = writerId("ada@example.com")
  writeEntry(b.doc, row(root, null))
  putValue(
    b.doc,
    setRecord(MARK, { entry: root, title: "Plans", by: ada, at: 1 }),
  )
  const agent = record<MarkDeps["agent"]>({ writeValues: async () => {} })
  const out = await handleMark({ basics: b, agent: agent.port }, ada, {
    kind: "mark",
    entry: root,
    title: null,
  })
  expect(out).toEqual({ kind: "marked" })
  expect(writesOf(agent.calls)).toEqual([deleteRecord(MARK, root)])
})
