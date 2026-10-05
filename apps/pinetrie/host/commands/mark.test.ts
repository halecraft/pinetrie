import { entryId, writerId } from "@pinetrie/core"
import { deleteRecord, MARK, setRecord } from "@pinetrie/rules"
import { writeEntry } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { basics, putValue, ROOT_ID, record, row, writesOf } from "../fakes.ts"
import { handleMark, type MarkDeps } from "./mark.ts"

test("clearing a root's title removes its mark", async () => {
  const b = basics()
  const root = entryId("e-1")
  const ada = writerId("ada@example.com")
  writeEntry(b.root, row(root, null))
  putValue(
    b,
    setRecord(MARK, { entry: root, title: "Plans", by: ada, at: 1 }, ROOT_ID),
  )
  const scribe = record<MarkDeps["scribe"]>({ writeValues: async () => {} })
  const out = await handleMark({ basics: b, scribe: scribe.port }, ada, {
    kind: "mark",
    root: ROOT_ID,
    entry: root,
    title: null,
  })
  expect(out).toEqual({ kind: "marked" })
  expect(writesOf(scribe.calls)).toEqual([deleteRecord(MARK, root, ROOT_ID)])
})
