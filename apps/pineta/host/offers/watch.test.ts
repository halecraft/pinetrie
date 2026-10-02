import { laneNameForThread } from "@pineta/core"
import { expect, test } from "vitest"
import { planPoll } from "./watch.ts"

test("planPoll: the first read and a new op touch each lane with an offer bookmark or an open record, once, and the line; the same op touches nothing", () => {
  const [a, b, c] = ["a", "b", "c"].map(laneNameForThread)
  if (a === undefined || b === undefined || c === undefined) throw new Error()
  const input = { bookmarked: [a, b], open: [b, c] }
  expect(planPoll({ last: null, op: "o1", ...input })).toEqual({
    last: "o1",
    line: true,
    touch: [a, b, c],
  })
  expect(planPoll({ last: "o1", op: "o1", ...input })).toEqual({
    last: "o1",
    line: false,
    touch: [],
  })
  expect(planPoll({ last: "o1", op: "o2", ...input }).touch).toEqual([a, b, c])
})
