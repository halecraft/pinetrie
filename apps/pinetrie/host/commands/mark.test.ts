import { threadIdFor, writerId } from "@pinetrie/core"
import { deleteRecord, MARK, setRecord } from "@pinetrie/rules"
import { expect, test } from "vitest"
import {
  basics,
  putTask,
  putValue,
  record,
  TASK_ID,
  writesOf,
} from "../fakes.ts"
import { handleMark, type MarkDeps } from "./mark.ts"

test("clearing a task's title removes its mark (ADR-0116)", async () => {
  const b = basics()
  const ada = writerId("ada@example.com")
  putTask(b, threadIdFor("t"))
  putValue(
    b,
    setRecord(MARK, { task: TASK_ID, title: "Plans", by: ada, at: 1 }),
  )
  const scribe = record<MarkDeps["records"]>({ writeValues: async () => {} })
  const out = await handleMark({ basics: b, records: scribe.port }, ada, {
    kind: "mark",
    task: TASK_ID,
    title: null,
  })
  expect(out).toEqual({ kind: "marked" })
  expect(writesOf(scribe.calls)).toEqual([deleteRecord(MARK, TASK_ID)])
})

test("a task the session does not hold takes no title", async () => {
  const b = basics()
  const scribe = record<MarkDeps["records"]>({ writeValues: async () => {} })
  const out = await handleMark(
    { basics: b, records: scribe.port },
    writerId("ada@example.com"),
    { kind: "mark", task: TASK_ID, title: "Plans" },
  )
  expect(out).toMatchObject({ kind: "refused", code: "unknown_target" })
  expect(scribe.calls).toEqual([])
})
