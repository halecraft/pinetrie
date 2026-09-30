import { entryId, writerId } from "@pineta/core"
import { encodeMark, MARK_NAMESPACE } from "@pineta/marginalia"
import { writeEntry } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, methods, putValue, record, row } from "../fakes.ts"
import { handleMark, type MarkDeps } from "./mark.ts"

test("clearing a root's title removes its mark", async () => {
  const b = basics()
  const root = entryId("e-1")
  const ada = writerId("ada@example.com")
  writeEntry(b.doc, row(root, null))
  putValue(b.doc, {
    namespace: MARK_NAMESPACE,
    key: root,
    value: encodeMark({ entry: root, title: "Plans", by: ada, at: 1 }),
  })
  const agent = record<MarkDeps["agent"]>({ removeMark: async () => {} })
  const out = await handleMark({ basics: b, agent: agent.port }, ada, {
    kind: "mark",
    entry: root,
    title: null,
  })
  expect(out).toEqual({ kind: "marked" })
  expect(methods(agent.calls)).toEqual(["removeMark"])
})
