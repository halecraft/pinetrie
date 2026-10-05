import { describe, expect, test } from "vitest"
import { prefixChange, prefixOf } from "./prefix.ts"

const payload = (over: Record<string, unknown> = {}) => ({
  model: "m",
  system: [{ type: "text", text: "you are" }],
  tools: [{ name: "read" }],
  thinking: { type: "adaptive" },
  messages: [{ role: "user", content: "hi" }],
  ...over,
})

describe("prefixChange", () => {
  test("a first request is no change", () => {
    expect(prefixChange(undefined, prefixOf(payload()))).toBe(false)
  })

  test("the same prefix with more messages is no change", () => {
    const later = payload({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    })
    expect(prefixChange(prefixOf(payload()), prefixOf(later))).toBe(false)
  })

  test("tools, the system prompt or the thinking settings changing is a change", () => {
    const before = prefixOf(payload())
    for (const over of [
      { tools: [{ name: "read" }, { name: "ask_about_conflict" }] },
      { system: [{ type: "text", text: "you are, named" }] },
      { thinking: { type: "enabled" } },
    ])
      expect(prefixChange(before, prefixOf(payload(over)))).toBe(true)
  })
})
