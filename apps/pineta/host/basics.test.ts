import { laneNameForThread } from "@pineta/core"
import { expect, test } from "vitest"
import { failed, messageOf } from "./basics.ts"
import { basics } from "./fakes.ts"

test("failed logs the host's line, with the thread when it names a lane", () => {
  const b = basics()
  const lane = laneNameForThread("0123456789abcdef")
  failed(b, "compaction")(new Error("disk full"))
  failed(b, "forking", lane)("no volume")
  expect(b.lines).toEqual([
    "[host] compaction failed: disk full",
    "[host] 89abcdef: forking failed: no volume",
  ])
})

test("messageOf reads an Error's message, and anything else as a string", () => {
  expect(messageOf(new Error("x"))).toBe("x")
  expect(messageOf(42)).toBe("42")
})
