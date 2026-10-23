import { snapshotId, threadIdFor } from "@pinetrie/core"
import { entrySnapshotId } from "@pinetrie/core/fixtures"
import type { LaneRuntime } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { basics, record } from "../fakes.ts"
import { createArchive, type UpkeepAsks } from "./archive.ts"
import type { LaneRegistry } from "./registry.ts"

const [STUCK, NEXT] = [threadIdFor("1"), threadIdFor("2")]
const ENTRY = entrySnapshotId(1)

/** An archive over fakes, with what it asked of the upkeep and deleted itself. */
function archiveWith(runtime: Partial<LaneRuntime> = {}) {
  const asked: string[] = []
  const deleted: unknown[] = []
  const removed: string[] = []
  const upkeep: UpkeepAsks = {
    markArchivedForDeletion: s => asked.push(`to-delete ${s.join(" ")}`),
    keepRestored: l => asked.push(`kept again ${l.join(" ")}`),
  }
  const b = basics()
  const archive = createArchive({
    basics: b,
    destination: null,
    runtime: record<LaneRuntime>({
      remove: async container => {
        removed.push(container)
      },
      disk: async op => {
        if (op.kind === "delete-snapshots") deleted.push(...op.ids)
      },
      ...runtime,
    }).port,
    registry: record<LaneRegistry>({ forget: async () => {} }).port,
    upkeep,
  })
  return { archive, asked, deleted, removed, b }
}

test("a lane whose removal fails leaves the other lanes removed and the snapshots marked to delete", async () => {
  const a = archiveWith({
    disk: async op => {
      if (op.kind === "delete" && op.lane === STUCK)
        throw new Error("EROFS: read-only file system")
    },
  })
  await a.archive.teardown({
    forget: [STUCK, NEXT],
    refs: [],
    snapshots: [ENTRY],
    restored: [],
  })
  expect(a.removed).toHaveLength(2)
  expect(a.asked).toEqual([`to-delete ${ENTRY}`])
  expect(
    a.b.lines.some(l => l.includes("removing an archived lane failed")),
  ).toBe(true)
})

test("an archive marks only entries' snapshots to delete, skips any other name, and deletes none itself", async () => {
  const a = archiveWith()
  await a.archive.teardown({
    forget: [],
    refs: [],
    snapshots: [snapshotId("base"), snapshotId(`turn-${ENTRY}`), ENTRY],
    restored: [],
  })
  expect(a.asked).toEqual([`to-delete ${ENTRY}`])
  expect(a.deleted).toEqual([])
})

test("a restore keeps its lanes' snapshots marked to delete", async () => {
  const a = archiveWith()
  await a.archive.teardown({
    forget: [],
    refs: [],
    snapshots: [],
    restored: [STUCK, NEXT],
  })
  expect(a.asked).toEqual([`kept again ${STUCK} ${NEXT}`])
})
