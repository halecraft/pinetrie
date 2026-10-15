import { threadIdFor } from "@pinetrie/core"
import { LANE } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { laneHistoryRewrite } from "./0015-lane-history.ts"

const LANE_KEY = threadIdFor("1")
const stored = (more: object) => ({
  root: "r-1",
  by: "w-ada@x.io",
  createdAt: 1,
  ...more,
})

test("a lane's own copy becomes a jj history, and no copy none; a moved record is left", () => {
  const own = laneHistoryRewrite(stored({ work: { kind: "own" } }))
  const none = laneHistoryRewrite(stored({ work: null }))
  expect(own).toEqual(stored({ history: "jj" }))
  expect(none).toEqual(stored({ history: null }))
  expect(LANE.decode(own, LANE_KEY)?.history).toBe("jj")
  expect(LANE.decode(none, LANE_KEY)?.history).toBeNull()
  expect(laneHistoryRewrite(own)).toBeNull()
  expect(laneHistoryRewrite(none)).toBeNull()
})
