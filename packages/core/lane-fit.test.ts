import { describe, expect, test } from "vitest"
import {
  type LaneRecord,
  laneFits,
  ownLane,
  proveRunnable,
  rootIdFor,
  threadIdFor,
  writerId,
} from "./index.ts"

const LANE = threadIdFor("1")
const lane = (history: LaneRecord["history"]): LaneRecord => ({
  lane: LANE,
  root: rootIdFor("r"),
  history,
  by: writerId("ada@x.io"),
  createdAt: 0,
})

describe("a lane fits the project when it keeps the project's kind of history", () => {
  test("a lane of the project's kind fits; one of the other kind is foreign; one with no copy is no own lane", () => {
    const jj = ownLane(lane("jj"))
    const folder = ownLane(lane("folder"))
    if (jj === null || folder === null) throw new Error("an own lane")
    expect(laneFits(jj, "jj")).toBeNull()
    expect(laneFits(folder, "jj")).toEqual({
      kind: "foreign",
      lane: LANE,
      history: "folder",
    })
    expect(laneFits(jj, "folder")?.history).toBe("jj")
    expect(ownLane(lane(null))).toBeNull()
  })

  test("a run may start on a lane that fits, has no copy or no record, or on a host with no tools; not on a foreign lane", () => {
    expect(proveRunnable(LANE, lane("jj"), "jj")).toBe(LANE)
    expect(proveRunnable(LANE, lane(null), "jj")).toBe(LANE)
    expect(proveRunnable(LANE, undefined, "jj")).toBe(LANE)
    expect(proveRunnable(LANE, lane("folder"), null)).toBe(LANE)
    expect(proveRunnable(LANE, lane("folder"), "jj")).toEqual({
      kind: "foreign",
      lane: LANE,
      history: "folder",
    })
  })
})
