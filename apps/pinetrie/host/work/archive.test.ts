import { snapshotId, threadIdFor } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import type { LaneRuntime } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { basics, record } from "../fakes.ts"
import { createArchive } from "./archive.ts"
import type { LaneRegistry } from "./registry.ts"

const [STUCK, NEXT] = [threadIdFor("1"), threadIdFor("2")]

test("a lane whose removal fails leaves the other lanes removed and the snapshots deleted", async () => {
  const removed: string[] = []
  const deleted: unknown[] = []
  const runtime = record<LaneRuntime>({
    remove: async container => {
      removed.push(container)
    },
    disk: async op => {
      if (op.kind === "delete" && op.lane === STUCK)
        throw new Error("EROFS: read-only file system")
      if (op.kind === "deleteSnapshots") deleted.push(...op.ids)
    },
  }).port
  const registry = record<LaneRegistry>({ forget: async () => {} }).port
  const keeper = createKeeper()
  const b = basics()
  await createArchive({
    basics: b,
    offers: null,
    runtime,
    registry,
    keeper,
  }).teardown({
    forget: [STUCK, NEXT],
    refs: [],
    snapshots: [snapshotId("s1")],
  })
  await keeper.idle()
  expect(removed).toHaveLength(2)
  expect(deleted).toEqual([snapshotId("s1")])
  expect(
    b.lines.some(l => l.includes("removing an archived lane failed")),
  ).toBe(true)
})
