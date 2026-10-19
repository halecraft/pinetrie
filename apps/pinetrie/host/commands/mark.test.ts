import { cardIdOfKind, ERR, threadIdFor, writerId } from "@pinetrie/core"
import { CARD_TITLE, deleteRecord, MARK, setRecord } from "@pinetrie/rules"
import { expect, test } from "vitest"
import {
  basics,
  CANVAS_ID,
  putCanvas,
  putNoteColumn,
  putValue,
  record,
  writtenValues,
} from "../fakes.ts"
import { handleMark, type MarkDeps } from "./mark.ts"

test("clearing a canvas's title removes its mark", async () => {
  const b = basics()
  const ada = writerId("ada@example.com")
  putCanvas(b, threadIdFor("t"))
  putValue(
    b,
    setRecord(MARK, { canvas: CANVAS_ID, title: "Plans", by: ada, at: 1 }),
  )
  const scribe = record<MarkDeps["records"]>({ writeValues: async () => {} })
  const out = await handleMark({ basics: b, records: scribe.port }, ada, {
    kind: "mark",
    of: { kind: "canvas", canvas: CANVAS_ID },
    title: null,
  })
  expect(out).toEqual({ kind: "marked" })
  expect(writtenValues(scribe.calls)).toEqual([deleteRecord(MARK, CANVAS_ID)])
})

test("a canvas the session does not hold takes no title", async () => {
  const b = basics()
  const scribe = record<MarkDeps["records"]>({ writeValues: async () => {} })
  const out = await handleMark(
    { basics: b, records: scribe.port },
    writerId("ada@example.com"),
    { kind: "mark", of: { kind: "canvas", canvas: CANVAS_ID }, title: "Plans" },
  )
  expect(out).toMatchObject({ kind: "refused", code: ERR.UNKNOWN_TARGET })
  expect(scribe.calls).toEqual([])
})

test("a note column on a canvas takes its title in its card's title record", async () => {
  const b = basics()
  const ada = writerId("ada@example.com")
  putCanvas(b, threadIdFor("t"))
  const column = cardIdOfKind(
    "note-column",
    "01a0ffd2-0000-7000-8000-0000000000a1",
  )
  putNoteColumn(b, column)
  const scribe = record<MarkDeps["records"]>({ writeValues: async () => {} })
  const out = await handleMark({ basics: b, records: scribe.port }, ada, {
    kind: "mark",
    of: { kind: "card", card: column },
    title: "Ideas",
  })
  expect(out).toEqual({ kind: "marked" })
  expect(writtenValues(scribe.calls)).toEqual([
    setRecord(CARD_TITLE, { card: column, title: "Ideas", by: ada, at: 1_000 }),
  ])
})
