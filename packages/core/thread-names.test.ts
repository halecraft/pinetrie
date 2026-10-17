import { expect, test } from "vitest"
import { isThreadNameHandle, threadNameParts } from "./index.ts"

test("a name splits into its adjective and noun", () => {
  expect(threadNameParts("amber-fox")).toEqual({
    adjective: "amber",
    noun: "fox",
  })
})

test.each(["fox", "amber-notanoun", "fox-amber", "amber-fox-x", ""])(
  "%j is no thread's name",
  name => {
    expect(threadNameParts(name)).toBeNull()
    expect(isThreadNameHandle(name)).toBe(false)
  },
)
