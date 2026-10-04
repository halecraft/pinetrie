import { expect, test } from "vitest"
import { modelRef, recordOf } from "./index.ts"

test("modelRef: provider/id, split at the first slash; anything else is undefined", () => {
  expect(modelRef("anthropic/claude-haiku-4-5")).toEqual({
    provider: "anthropic",
    model: "claude-haiku-4-5",
  })
  expect(modelRef("openrouter/google/gemini-3.1-flash")).toEqual({
    provider: "openrouter",
    model: "google/gemini-3.1-flash",
  })
  for (const value of ["no-slash", "/lead", "trail/", "", 3, null, undefined])
    expect(modelRef(value)).toBeUndefined()
})

test("recordOf: a plain object's fields, else undefined", () => {
  expect(recordOf({ a: 1 })).toEqual({ a: 1 })
  for (const value of [null, [], "x", 1, undefined])
    expect(recordOf(value)).toBeUndefined()
})
