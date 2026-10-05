import { expect, test } from "vitest"
import { isWithin } from "./paths.ts"

test("isWithin: the path itself and what is under it, never a sibling with the same prefix", () => {
  expect(isWithin("/a/pinetrie", "/a/pinetrie")).toBe(true)
  expect(isWithin("/a/pinetrie/src/x.ts", "/a/pinetrie")).toBe(true)
  expect(isWithin("/a/pinetrie/src/x.ts", "/a/pinetrie/")).toBe(true)
  expect(isWithin("/a/pinetrie-2/x.ts", "/a/pinetrie")).toBe(false)
  expect(isWithin("/a", "/a/pinetrie")).toBe(false)
  expect(isWithin("/b/x.ts", "/a")).toBe(false)
  expect(isWithin("/anything", "/")).toBe(true)
})
