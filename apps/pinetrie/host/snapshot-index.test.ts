import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { deletableSnapshot, type SnapshotId, threadIdFor } from "@pinetrie/core"
import { entrySnapshotId } from "@pinetrie/core/fixtures"
import type { SnapshotIndex } from "@pinetrie/machine"
import { memoryIndex } from "@pinetrie/machine/fixtures"
import { afterAll, describe, expect, test } from "vitest"
import { memorySnapshotIndex, sqliteSnapshotIndex } from "./snapshot-index.ts"

const LANE = threadIdFor("01a0ffd2-0000-7000-8000-000000000001")
const OTHER = threadIdFor("01a0ffd2-0000-7000-8000-000000000002")
const a = entrySnapshotId(1)
const b = entrySnapshotId(2)
const c = entrySnapshotId(3)

const stateOf = (index: SnapshotIndex, snapshot: SnapshotId) =>
  index.rows().find(r => r.snapshot === snapshot)?.state
const take = (index: SnapshotIndex, snapshot: SnapshotId, lane = LANE) =>
  index.markTaken(index.reserve({ snapshot, lane, changed: 1 }))

/**
 * The same rules for both: the machine's tests plan over its fixture, the
 * host runs over SQLite, so neither drifts from the other.
 */
describe.each([
  ["in SQLite", memorySnapshotIndex],
  ["as the machine's tests keep it", () => memoryIndex()],
] as const)("the snapshot index %s", (_, fresh) => {
  test("a row is reserved, then kept once taken, or deleted when never taken", () => {
    const index = fresh()
    const r = index.reserve({ snapshot: a, lane: LANE, changed: 5 })
    expect(stateOf(index, a)).toBe("reserved")
    expect(index.markTaken(r)).toBe(a)
    expect(stateOf(index, a)).toBe("kept")
    index.markNotTaken(index.reserve({ snapshot: b, lane: LANE, changed: 0 }))
    expect(stateOf(index, b)).toBe("deleted")
  })

  test("a retake under the same name reserves its row again, whatever its state", () => {
    const index = fresh()
    index.markNotTaken(index.reserve({ snapshot: a, lane: LANE, changed: 1 }))
    index.reserve({ snapshot: a, lane: LANE, changed: 3 })
    expect(index.rows()).toMatchObject([
      { snapshot: a, state: "reserved", changed: 3 },
    ])
  })

  test("uses order rows by the order they came in, and a branch stays branched", () => {
    const index = fresh()
    for (const s of [a, b, c]) take(index, s)
    index.markUsed(a, true)
    index.markUsed(b, false)
    const used = new Map(index.rows().map(r => [r.snapshot, r.used]))
    expect(
      [...used.entries()].sort((x, y) => x[1] - y[1]).map(([s]) => s),
    ).toEqual([c, a, b])
    expect(index.rows().find(r => r.snapshot === a)?.branched).toBe(true)
    index.markUsed(a, false)
    expect(index.rows().find(r => r.snapshot === a)?.branched).toBe(true)
  })

  test("a use of a name with no row writes none", () => {
    const index = fresh()
    index.markUsed(a, true)
    expect(index.rows()).toEqual([])
  })

  test("settling at a start keeps a reserved row whose snapshot is listed, and deletes one whose is not", () => {
    const index = fresh()
    index.reserve({ snapshot: a, lane: LANE, changed: 1 })
    index.reserve({ snapshot: b, lane: LANE, changed: 1 })
    index.settleReserved(new Set([a]))
    expect([stateOf(index, a), stateOf(index, b)]).toEqual(["kept", "deleted"])
  })

  test("rows marked to delete are kept again for a restored lane, and only for it", () => {
    const index = fresh()
    take(index, a)
    take(index, b, OTHER)
    index.markToDelete([a, b])
    index.keepAgain([LANE])
    expect([stateOf(index, a), stateOf(index, b)]).toEqual([
      "kept",
      "to-delete",
    ])
  })

  test("only a kept row is marked to delete, and no reserved row is marked deleted", () => {
    const index = fresh()
    index.reserve({ snapshot: a, lane: LANE, changed: 1 })
    take(index, b)
    index.markToDelete([a, b])
    index.markDeleted([deletableSnapshot("entry", a)])
    expect([stateOf(index, a), stateOf(index, b)]).toEqual([
      "reserved",
      "to-delete",
    ])
    index.markDeleted([deletableSnapshot("entry", b)])
    expect(stateOf(index, b)).toBe("deleted")
  })

  test("the fill writes a recorded snapshot kept, and leaves a name that has a row as it is", () => {
    const index = fresh()
    index.markNotTaken(index.reserve({ snapshot: a, lane: LANE, changed: 1 }))
    index.indexRecorded([
      { snapshot: a, lane: LANE, changed: 9 },
      { snapshot: b, lane: OTHER, changed: 4 },
    ])
    expect(index.rows()).toMatchObject([
      { snapshot: a, state: "deleted", changed: 1 },
      { snapshot: b, lane: OTHER, state: "kept", changed: 4 },
    ])
  })

  test("the index is incomplete until marked complete", () => {
    const index = fresh()
    expect(index.isComplete()).toBe(false)
    index.markComplete()
    expect(index.isComplete()).toBe(true)
  })
})

describe("the snapshot index in a file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-snapshot-index-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test("its rows and its completeness outlive the connection", () => {
    const file = path.join(dir, "store.db")
    const first = new DatabaseSync(file)
    const index = sqliteSnapshotIndex(first)
    take(index, a)
    index.markComplete()
    first.close()
    const again = sqliteSnapshotIndex(new DatabaseSync(file))
    expect(again.rows()).toMatchObject([{ snapshot: a, state: "kept" }])
    expect(again.isComplete()).toBe(true)
  })
})
