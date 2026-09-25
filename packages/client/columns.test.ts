import { type EntryLike, indexTree } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { type Column, columnsReducer, initialColumns } from "./columns.ts"

const tree = (parents: Record<string, string | null>) =>
  indexTree(
    Object.fromEntries(
      Object.entries(parents).map(([id, parentId]): [string, EntryLike] => [
        id,
        {
          id,
          parentId,
          type: "message",
          message: { role: "chat", content: id },
        },
      ]),
    ),
  )
const anchors = (s: readonly Column[]) => s.map(c => c.anchor)

describe("columnsReducer", () => {
  test("sync pins a new session's first column once, and never re-pins it", () => {
    const empty = initialColumns()
    expect(columnsReducer(empty, { kind: "sync", index: tree({}) })).toBe(empty)
    const pinned = columnsReducer(empty, {
      kind: "sync",
      index: tree({ "1-a": null, "2-b": "1-a" }),
    })
    expect(anchors(pinned)).toEqual(["2-b"])
    // A newer thread elsewhere must not pull the pinned column away.
    const later = columnsReducer(pinned, {
      kind: "sync",
      index: tree({ "1-a": null, "2-b": "1-a", "3-other": null }),
    })
    expect(later).toBe(pinned)
  })

  test("sync follows a column's own tip, never a newer branch above it", () => {
    const col: readonly Column[] = [{ key: "k", anchor: "2-b" }]
    // A reply below the tip moves the column on.
    const replied = columnsReducer(col, {
      kind: "sync",
      index: tree({ "1-a": null, "2-b": "1-a", "3-c": "2-b" }),
    })
    expect(anchors(replied)).toEqual(["3-c"])
    // A newer branch off an earlier message does not.
    const branched = columnsReducer(replied, {
      kind: "sync",
      index: tree({ "1-a": null, "2-b": "1-a", "3-c": "2-b", "4-x": "1-a" }),
    })
    expect(branched).toBe(replied)
  })

  test("sync resolves a fresh branch to its first new message", () => {
    const start = columnsReducer([{ key: "k", anchor: "2-b" }], {
      kind: "branch",
      key: "fresh",
      after: 0,
      at: "1-a",
      existing: ["2-b"],
    })
    const before = columnsReducer(start, {
      kind: "sync",
      index: tree({ "1-a": null, "2-b": "1-a" }),
    })
    expect(before).toBe(start)
    const after = columnsReducer(start, {
      kind: "sync",
      index: tree({ "1-a": null, "2-b": "1-a", "3-new": "1-a" }),
    })
    expect(after[1]).toMatchObject({ anchor: "3-new" })
    expect(after[1]?.exclude).toBeUndefined()
  })

  test("open inserts next to the column it forks from", () => {
    const three: Column[] = [
      { key: "a", anchor: "x" },
      { key: "b", anchor: "y" },
    ]
    const s = columnsReducer(three, {
      kind: "open",
      key: "new",
      after: 0,
      anchor: "z",
    })
    expect(anchors(s)).toEqual(["x", "z", "y"])
  })

  test("close of the last column leaves one following the newest", () => {
    const s = columnsReducer([{ key: "a", anchor: "x" }], {
      kind: "close",
      index: 0,
    })
    expect(anchors(s)).toEqual([null])
  })

  test("makeMain moves a column to the front, keeping its key", () => {
    const s = columnsReducer(
      [
        { key: "a", anchor: "x" },
        { key: "b", anchor: "y" },
        { key: "c", anchor: "z" },
      ],
      { kind: "makeMain", index: 2 },
    )
    expect(s.map(c => c.key)).toEqual(["c", "a", "b"])
  })
})
