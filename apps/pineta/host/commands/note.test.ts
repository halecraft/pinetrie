import { ERR, entryId, runId } from "@pineta/core"
import { expect, test } from "vitest"
import { draftSent } from "./note.ts"

test("a draft is sent when its message is written, running or waiting; a conflict or refusal leaves it a draft", () => {
  expect(draftSent({ kind: "appended", id: entryId("e-1") })).toBe(true)
  expect(draftSent({ kind: "started", runId: runId("r-1") })).toBe(true)
  expect(draftSent({ kind: "queued", position: 0 })).toBe(true)
  expect(draftSent({ kind: "conflict", by: null })).toBe(false)
  expect(draftSent({ kind: "refused", code: ERR.REFUSED, message: "" })).toBe(
    false,
  )
})
