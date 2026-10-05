import { expect, test } from "vitest"
import { isWithin } from "./paths.ts"

test("isWithin: the path itself and what is under it, never a sibling with the same prefix", () => {
  expect(isWithin("/a/pineta", "/a/pineta")).toBe(true)
  expect(isWithin("/a/pineta/src/x.ts", "/a/pineta")).toBe(true)
  expect(isWithin("/a/pineta/src/x.ts", "/a/pineta/")).toBe(true)
  expect(isWithin("/a/pineta-2/x.ts", "/a/pineta")).toBe(false)
  expect(isWithin("/a", "/a/pineta")).toBe(false)
  expect(isWithin("/b/x.ts", "/a")).toBe(false)
  expect(isWithin("/anything", "/")).toBe(true)
})
