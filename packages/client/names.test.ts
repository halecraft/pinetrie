import { writerId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { cardHeading, namesOf, speakerLabel } from "./names.ts"

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

test("cardHeading: whose draft, and who else wrote in it", () => {
  const nameOf = new Map([[writerId("ada@x.io"), "Ada"]])
  const ADA = writerId("ada@x.io")
  const BEA = writerId("bea@x.io")
  expect(cardHeading(nameOf, ADA, [ADA])).toBe("Ada's draft")
  expect(cardHeading(nameOf, ADA, [])).toBe("Ada's draft")
  expect(cardHeading(nameOf, ADA, [BEA, ADA])).toBe("Ada's draft · with bea")
  expect(namesOf(nameOf, [ADA, BEA])).toBe("Ada, bea")
})
