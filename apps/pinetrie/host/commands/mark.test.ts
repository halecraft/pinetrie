import { cardIdOfKind, threadIdFor, writerId } from "@pinetrie/core"
import { deleteRecord, MARK, NOTE_COLUMN, setRecord } from "@pinetrie/rules"
import { expect, test } from "vitest"
import {
  basics,
  putNoteColumn,
  putTask,
  putValue,
  record,
  TASK_ID,
  writesOf,
} from "../fakes.ts"
import { handleMark, type MarkDeps } from "./mark.ts"

test("clearing a task's title removes its mark", async () => {
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
    of: { kind: "task", task: TASK_ID },
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
    { kind: "mark", of: { kind: "task", task: TASK_ID }, title: "Plans" },
  )
  expect(out).toMatchObject({ kind: "refused", code: "unknown_target" })
  expect(scribe.calls).toEqual([])
})

test("a note column on a canvas takes its title in its own record", async () => {
  const b = basics()
  const ada = writerId("ada@example.com")
  putTask(b, threadIdFor("t"))
  const column = cardIdOfKind(
    "note-column",
    "01a0ffd2-0000-7000-8000-0000000000a1",
  )
  putNoteColumn(b, column)
  const scribe = record<MarkDeps["records"]>({ writeValues: async () => {} })
  const out = await handleMark({ basics: b, records: scribe.port }, ada, {
    kind: "mark",
    of: { kind: "note-column", column },
    title: "Ideas",
  })
  expect(out).toEqual({ kind: "marked" })
  expect(writesOf(scribe.calls)).toEqual([
    setRecord(NOTE_COLUMN, { column, title: "Ideas", by: ada, at: 1_000 }),
  ])
})
