import { asPlaceFields, placeOfFields } from "@pinetrie/core"
import { expect, test } from "vitest"
import {
  trashedFieldsNow,
  trashedHistoryNow,
  trashedMoveNow,
} from "./0024-trashed-rows.ts"

test("a trashed card's row in the old words reads as the place it left, in the trash", () => {
  const now = trashedFieldsNow({
    kind: "discarded-note",
    column: "n-1",
    order: "c",
  })
  expect(now).toEqual({ kind: "trashed-note", column: "n-1", order: "c" })
  expect(trashedFieldsNow({ kind: "discarded" })).toEqual({ kind: "trashed" })
  expect(
    placeOfFields(asPlaceFields(trashedFieldsNow({ kind: "discarded" }) ?? {})),
  ).toBeUndefined()
})

test("a live place, or one already renamed, needs nothing", () => {
  expect(trashedFieldsNow({ kind: "note" })).toBeNull()
  expect(trashedFieldsNow({ kind: "trashed-note" })).toBeNull()
})

test("a history's events and a trace are rewritten whole, and nothing else", () => {
  const history = {
    events: [{ from: { kind: "note" }, to: { kind: "discarded" } }],
  }
  expect(trashedHistoryNow(history)).toEqual({
    events: [{ from: { kind: "note" }, to: { kind: "trashed" } }],
  })
  expect(
    trashedMoveNow({ from: { kind: "note" }, to: { kind: "note" } }),
  ).toBeNull()
})
