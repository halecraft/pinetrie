import { expect, test } from "vitest"
import { screenMemory } from "./screen-memory.ts"

test("what is remembered is got back by its key, and the last value wins", () => {
  const m = screenMemory<number>()
  expect(m.get("a")).toBeUndefined()
  m.remember("a", 1)
  m.remember("b", 2)
  m.remember("a", 3)
  expect(m.get("a")).toBe(3)
  expect(m.get("b")).toBe(2)
})

test("two memories share nothing", () => {
  const one = screenMemory<number>()
  const two = screenMemory<number>()
  one.remember("a", 1)
  expect(two.get("a")).toBeUndefined()
})
