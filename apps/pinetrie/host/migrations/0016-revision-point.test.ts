import { REVISION } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { revisionPointRewrite } from "./0016-revision-point.ts"

const DISK = {
  derived: { paths: [], more: 0 },
  local: { paths: [], more: 0 },
  unignored: [],
  leftovers: [],
}

test("a turn's record moves its commit to its point, and is written whole; a whole one is left", () => {
  const oldest = { lane: "t-1", commit: "c1" }
  const moved = revisionPointRewrite(oldest)
  expect(moved).toEqual({
    lane: "t-1",
    point: "c1",
    snapshot: null,
    paths: [],
    conflicts: [],
    disk: null,
  })
  const withDisk = revisionPointRewrite({
    lane: "t-1",
    commit: null,
    snapshot: "e1",
    paths: ["a"],
    conflicts: [],
    disk: DISK,
  })
  expect(withDisk).toEqual({
    lane: "t-1",
    point: null,
    snapshot: "e1",
    paths: ["a"],
    conflicts: [],
    disk: { ...DISK, shared: { read: [], wrote: [] } },
  })
  for (const record of [moved, withDisk]) {
    expect(REVISION.decode(record, "e1")).toBeDefined()
    expect(revisionPointRewrite(record)).toBeNull()
  }
})
