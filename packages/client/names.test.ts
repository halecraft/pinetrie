import { describe, expect, test } from "vitest"
import { speakerLabel } from "./names.ts"

describe("speakerLabel: the current name, and the one it was sent under", () => {
  const names = new Map([["w-duane", "Duane"]])
  test("renamed since: the current name, then the sent one in parentheses", () => {
    expect(speakerLabel(names, "w-duane", "guest-x4bu")).toBe(
      "Duane (guest-x4bu)",
    )
  })
  test("unchanged: just the name", () => {
    expect(speakerLabel(names, "w-duane", "Duane")).toBe("Duane")
  })
  test("no current name, or no writer: the name as sent", () => {
    expect(speakerLabel(names, "w-someone", "Bea")).toBe("Bea")
    expect(speakerLabel(names, undefined, "Bea")).toBe("Bea")
  })
})
