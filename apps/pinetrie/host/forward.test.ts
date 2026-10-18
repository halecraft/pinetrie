import { expect, test } from "vitest"
import { forward } from "./forward.ts"

test("a refused call throws before the bind, and returns the bound call's value after", () => {
  const relays = forward<[string], number>("the relays", "refuse")
  expect(() => relays.call("a")).toThrow("the relays is not made yet")
  relays.bind(s => s.length)
  expect(relays.call("abc")).toBe(3)
})

test("held calls are made at the bind, in order, and later ones at once", () => {
  const made: string[] = []
  const recover = forward<[string]>("recovering a root", "hold")
  recover.call("a")
  recover.call("b")
  expect(made).toEqual([])
  recover.bind(root => made.push(root))
  expect(made).toEqual(["a", "b"])
  recover.call("c")
  expect(made).toEqual(["a", "b", "c"])
})

test("a dropped call is never made, and later ones are made at once", () => {
  const made: string[] = []
  const drain = forward<[string]>("the drain", "drop")
  drain.call("a")
  drain.bind(lane => made.push(lane))
  expect(made).toEqual([])
  drain.call("b")
  expect(made).toEqual(["b"])
})

test("a second bind throws", () => {
  const upkeep = forward<[]>("the upkeep", "drop")
  upkeep.bind(() => {})
  expect(() => upkeep.bind(() => {})).toThrow("the upkeep is bound already")
})
