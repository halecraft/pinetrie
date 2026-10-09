import { expect, test } from "vitest"
import { streamId, streamStart } from "./live.ts"

test("a stream's start is its uuidv7's milliseconds; an id that is no uuidv7 has none", () => {
  const at = Date.UTC(2026, 9, 9, 12, 0, 0, 123)
  const hex = at.toString(16).padStart(12, "0")
  const id = `${hex.slice(0, 8)}-${hex.slice(8)}-7abc-8def-0123456789ab`
  expect(streamStart(streamId(id))).toBe(at)
  expect(
    streamStart(streamId("01a11e0c-e0f5-4d22-98f6-2ffdd74bf965")),
  ).toBeUndefined()
  expect(streamStart(streamId("id-0001"))).toBeUndefined()
})
