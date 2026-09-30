import { laneNameForThread } from "@pineta/core"
import { expect, test } from "vitest"
import { planPoll } from "./watch.ts"

test("planPoll: the first read touches none; the same op touches none; a new op touches every open offer", () => {
  const open = [laneNameForThread("a"), laneNameForThread("b")]
  expect(planPoll({ last: null, op: "o1", open })).toEqual({
    last: "o1",
    touch: [],
  })
  expect(planPoll({ last: "o1", op: "o1", open })).toEqual({
    last: "o1",
    touch: [],
  })
  expect(planPoll({ last: "o1", op: "o2", open })).toEqual({
    last: "o2",
    touch: open,
  })
})
