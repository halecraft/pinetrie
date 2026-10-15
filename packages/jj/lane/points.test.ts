// A point reaches a commit only through a lane proven jj. Each
// `@ts-expect-error` fails `tsc` if the line below it ever compiles.

import {
  type CommitId,
  commitId,
  type LaneRecord,
  type PointId,
  pointFromCommit,
  pointId,
  rootIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { commitFromPoint, proveJjLane } from "./points.ts"

const LANE = threadIdFor("1")
const lane = (history: LaneRecord["history"]): LaneRecord => ({
  lane: LANE,
  root: rootIdFor("r"),
  history,
  by: writerId("ada@x.io"),
  createdAt: 0,
})

describe("proveJjLane: a lane's record proven jj, or why not", () => {
  test("a jj lane's record is proven; a folder lane's is foreign; one with no copy has none", () => {
    expect(proveJjLane(lane("jj"))).toEqual(lane("jj"))
    expect(proveJjLane(lane("folder"))).toEqual({
      kind: "foreign",
      lane: LANE,
      history: "folder",
    })
    expect(proveJjLane(lane(null))).toEqual({ kind: "no-copy", lane: LANE })
  })

  test("a point read in a proven lane is the commit it names", () => {
    const proved = proveJjLane(lane("jj"))
    if ("kind" in proved) throw new Error("a jj lane is proven")
    const c = commitId("c".repeat(40))
    expect(commitFromPoint(proved, pointFromCommit(c))).toBe(c)
  })

  test("a point and a commit are each other's only by their conversions, and a lane's record is no proof", () => {
    const p: PointId = pointId("c".repeat(40))
    // @ts-expect-error: a point is no commit until a proven lane reads it
    const c: CommitId = p
    const jjRecord = { ...lane("jj"), history: "jj" as const }
    // @ts-expect-error: only `proveJjLane` proves a lane, a jj one's record too
    expect(commitFromPoint(jjRecord, p)).toBe(c)
    // @ts-expect-error: a commit is a point only by `pointFromCommit`
    const q: PointId = c
    expect(q).toBe(p)
  })
})
