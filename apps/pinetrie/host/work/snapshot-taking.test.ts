import { threadIdFor } from "@pinetrie/core"
import { entrySnapshotId } from "@pinetrie/core/fixtures"
import type { SnapshotTaking } from "@pinetrie/machine"
import { describe, expect, test } from "vitest"
import { memorySnapshotIndex } from "../snapshot-index.ts"
import { takeIndexedSnapshot } from "./snapshot-taking.ts"

const LANE = threadIdFor("01a0ffd2-0000-7000-8000-000000000001")
const SNAPSHOT = entrySnapshotId(1)
const row = { snapshot: SNAPSHOT, lane: LANE, changed: 2 }

describe("takeIndexedSnapshot", () => {
  test("the row is reserved before the snapshot is taken, and kept after", async () => {
    const index = memorySnapshotIndex()
    const during: unknown[] = []
    const taken = await takeIndexedSnapshot({
      taking: index,
      row,
      take: async () => {
        during.push(index.rows().map(r => r.state))
      },
      skipped: () => {},
    })
    expect(during).toEqual([["reserved"]])
    expect(taken).toEqual({ kind: "taken", snapshot: SNAPSHOT })
    expect(index.rows().map(r => r.state)).toEqual(["kept"])
  })

  test("a snapshot that fails leaves its row not taken", async () => {
    const index = memorySnapshotIndex()
    const taken = await takeIndexedSnapshot({
      taking: index,
      row,
      take: async () => {
        throw new Error("ENOSPC")
      },
      skipped: () => {},
    })
    expect(taken.kind).toBe("failed")
    expect(index.rows().map(r => r.state)).toEqual(["deleted"])
  })

  test("a retake after a failed one keeps its row", async () => {
    const index = memorySnapshotIndex()
    const take = (fails: boolean) =>
      takeIndexedSnapshot({
        taking: index,
        row,
        take: async () => {
          if (fails) throw new Error("cut short")
        },
        skipped: () => {},
      })
    await take(true)
    expect((await take(false)).kind).toBe("taken")
    expect(index.rows().map(r => r.state)).toEqual(["kept"])
  })

  test("an index write that fails skips the snapshot, or names none, and is told", async () => {
    for (const fails of ["reserve", "markTaken"] as const) {
      const index = memorySnapshotIndex()
      const taking: SnapshotTaking = {
        ...index,
        reserve: r => {
          if (fails === "reserve") throw new Error("SQLITE_FULL")
          return index.reserve(r)
        },
        markTaken: r => {
          throw new Error(`SQLITE_FULL, but ${r}`)
        },
      }
      let took = 0
      let told = 0
      const taken = await takeIndexedSnapshot({
        taking,
        row,
        take: async () => {
          took++
        },
        skipped: () => {
          told++
        },
      })
      expect([fails, taken.kind, told]).toEqual([fails, "unindexed", 1])
      expect([fails, took]).toEqual([fails, fails === "reserve" ? 0 : 1])
    }
  })
})
