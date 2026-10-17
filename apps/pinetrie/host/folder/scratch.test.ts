import { pointId } from "@pinetrie/core"
import type { DiskOp } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { withScratch } from "./scratch.ts"

test("withScratch: a body that throws leaves no scratch disk", async () => {
  const ops: DiskOp[] = []
  const runtime = {
    disk: async (op: DiskOp) => {
      ops.push(op)
    },
  }
  await expect(
    withScratch(runtime, pointId("shown-1"), pointId("line-1"), async () => {
      throw new Error("the merge failed")
    }),
  ).rejects.toThrow("the merge failed")
  expect(ops.map(o => o.kind)).toEqual(["delete", "restore", "delete"])
  expect(ops.at(-1)).toEqual({ kind: "delete", lane: "shown-1-scratch" })
})
