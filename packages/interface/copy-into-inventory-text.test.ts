import { entryId, type TranscriptMessage } from "@pinetrie/core"
import { FIXTURE_THREAD } from "@pinetrie/core/fixtures"
import { expect, test } from "vitest"
import { copyIntoInventoryText } from "./copy-into-inventory-text.ts"

const message: TranscriptMessage = {
  id: entryId("5-m"),
  thread: FIXTURE_THREAD,
  role: "assistant",
  text: "the whole message",
  toolCalls: [],
}

test("copyIntoInventoryText: a selection inside the message; one outside, or none, gives the whole message", () => {
  expect(copyIntoInventoryText(message, { text: "whole", inside: true })).toBe(
    "whole",
  )
  expect(
    copyIntoInventoryText(message, { text: "elsewhere", inside: false }),
  ).toBe("the whole message")
  expect(copyIntoInventoryText(message, { text: "  ", inside: true })).toBe(
    "the whole message",
  )
  expect(copyIntoInventoryText(message, null)).toBe("the whole message")
})
