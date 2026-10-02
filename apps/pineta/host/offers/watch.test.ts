import { laneNameForThread } from "@pineta/core"
import { expect, test } from "vitest"
import { planPoll } from "./watch.ts"

test("planPoll: the first read and a new op touch every open offer; the same op touches none", () => {
  const open = [laneNameForThread("a"), laneNameForThread("b")]
  expect(planPoll({ last: null, op: "o1", open })).toEqual({
    last: "o1",
    touch: open,
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
