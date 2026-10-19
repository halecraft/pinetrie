import { expect, test } from "vitest"
import { stateGetLatest } from "./0014-state-get-latest.ts"

test("a state an old catch-up made reads as one getting the latest made", () => {
  expect(
    stateGetLatest({ made: { kind: "catch-up", lane: "t-1" }, at: 1 }),
  ).toEqual({ made: { kind: "get-latest", lane: "t-1" }, at: 1 })
})

test("any other state needs nothing", () => {
  expect(stateGetLatest({ made: { kind: "turn", lane: "t-1" } })).toBeNull()
  expect(
    stateGetLatest({ made: { kind: "get-latest", lane: "t-1" } }),
  ).toBeNull()
})
