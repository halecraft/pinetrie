import { expect, test } from "vitest"
import { withoutSharedReads } from "./0022-turn-shared-reads.ts"

const turn = {
  lane: "t-0123456789abcdef",
  point: null,
  snapshot: null,
  paths: [],
  conflicts: [],
}
const disk = {
  derived: { paths: [], more: 0 },
  local: { paths: [], more: 0 },
  unignored: [],
  leftovers: [],
}
const wrote = [{ path: ".plans/p.md", version: 2, concurrent: true }]

test("a turn's shared reads are dropped; its writes and the rest stay", () => {
  expect(
    withoutSharedReads({
      ...turn,
      disk: {
        ...disk,
        shared: { read: [{ path: ".plans/p.md", version: 1 }], wrote },
      },
    }),
  ).toEqual({ ...turn, disk: { ...disk, shared: { wrote } } })
})

test("a record without shared reads is left as it is", () => {
  expect(withoutSharedReads({ ...turn, disk: null })).toBeNull()
  expect(
    withoutSharedReads({ ...turn, disk: { ...disk, shared: { wrote } } }),
  ).toBeNull()
})
