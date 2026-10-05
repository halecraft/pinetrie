import { expect, test } from "vitest"
import { errorText } from "./errors.ts"

test("errorText reads an Error's message, and anything else as a string", () => {
  expect(errorText(new Error("x"))).toBe("x")
  expect(errorText(42)).toBe("42")
})
