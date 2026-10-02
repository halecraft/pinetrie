import { entryId, type TranscriptMessage } from "@pineta/core"
import { expect, test } from "vitest"
import { takeText } from "./take-text.ts"

const message: TranscriptMessage = {
  id: entryId("5-m"),
  role: "assistant",
  text: "the whole message",
  toolCalls: [],
}

test("takeText: a selection inside the message; one outside, or none, gives the whole message", () => {
  expect(takeText(message, { text: "whole", inside: true })).toBe("whole")
  expect(takeText(message, { text: "elsewhere", inside: false })).toBe(
    "the whole message",
  )
  expect(takeText(message, { text: "  ", inside: true })).toBe(
    "the whole message",
  )
  expect(takeText(message, null)).toBe("the whole message")
})
