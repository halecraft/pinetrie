import {
  type EntryLike,
  indexTree,
  type LaneView,
  laneNameForThread,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { type Column, columnsReducer } from "./columns.ts"

/** A tree from `child: parent` pairs; `sends` gives some entries a send id. */
const tree = (
  parents: Record<string, string | null>,
  sends: Record<string, string> = {},
) =>
  indexTree(
    Object.fromEntries(
      Object.entries(parents).map(([id, parentId]): [string, EntryLike] => [
        id,
        {
          id,
          parentId,
          type: "message",
          message: {
            role: "chat",
            content: id,
            ...(sends[id] === undefined ? {} : { sendId: sends[id] }),
          },
        },
      ]),
    ),
  )
const anchors = (s: readonly Column[]) => s.map(c => c.anchor)
const L = laneNameForThread("l")
const lane = (tip: string | null, name = L): LaneView => ({
  name,
  tip,
  running: false,
  waiting: 0,
  askedBy: null,
})
const sync = (
  s: readonly Column[],
  index: ReturnType<typeof tree>,
  lanes: readonly LaneView[] = [],
) => columnsReducer(s, { kind: "sync", index, lanes })

describe("columnsReducer", () => {
  test("sync follows a column's own tip, never a newer branch above it", () => {
    const col: readonly Column[] = [{ key: "k", anchor: "2-b" }]
    // A reply below the tip moves the column on.
    const replied = sync(col, tree({ "1-a": null, "2-b": "1-a", "3-c": "2-b" }))
    expect(anchors(replied)).toEqual(["3-c"])
    // A newer branch off an earlier message does not.
    const branched = sync(
      replied,
      tree({ "1-a": null, "2-b": "1-a", "3-c": "2-b", "4-x": "1-a" }),
    )
    expect(branched).toBe(replied)
  })

  test("a column binds to the one lane ending at its tip, then follows the lane past a newer fork", () => {
    const bound = sync(
      [{ key: "k", anchor: "1-a" }],
      tree({ "1-a": null, "2-t": "1-a" }),
      [lane("2-t")],
    )
    expect(bound[0]).toEqual({ key: "k", anchor: "2-t", lane: L })
    // A conversation steps down at 2-t (4-conv, newest) while the lane moves on to 3-next.
    const grown = tree({
      "1-a": null,
      "2-t": "1-a",
      "3-next": "2-t",
      "4-conv": "2-t",
    })
    expect(sync(bound, grown, [lane("3-next")])[0]).toEqual({
      key: "k",
      anchor: "3-next",
      lane: L,
    })
  })

  test("no binding while two lanes end at the tip: which thread it is cannot be told", () => {
    const i = tree({ "1-a": null, "2-t": "1-a" })
    const two = [lane("2-t"), lane("2-t", laneNameForThread("m"))]
    expect(sync([{ key: "k", anchor: "2-t" }], i, two)[0]?.lane).toBeUndefined()
  })

  test("a fresh column anchors at the message its send wrote, whatever came first", () => {
    const start = columnsReducer([{ key: "k", anchor: "2-t" }], {
      kind: "openFresh",
      key: "fresh",
      at: "2-t",
      after: 0,
    })
    expect(start[1]).toEqual({ key: "fresh", anchor: "2-t", fresh: {} })
    const sent = columnsReducer(start, {
      kind: "sent",
      key: "fresh",
      sendId: "s-1",
    })
    // The lane's own next message at 2-t arrives first, and is not ours.
    const laneFirst = tree({ "1-a": null, "2-t": "1-a", "3-lane": "2-t" })
    expect(sync(sent, laneFirst)[1]).toEqual(sent[1])
    const ours = tree(
      { "1-a": null, "2-t": "1-a", "3-lane": "2-t", "4-ours": "2-t" },
      { "4-ours": "s-1" },
    )
    expect(sync(sent, ours)[1]).toEqual({ key: "fresh", anchor: "4-ours" })
  })

  test("openFresh goes after the column it branches from", () => {
    const after = columnsReducer(
      [
        { key: "a", anchor: "x" },
        { key: "b", anchor: "y" },
      ],
      { kind: "openFresh", key: "f", at: "x", after: 0 },
    )
    expect(after.map(c => c.key)).toEqual(["a", "f", "b"])
  })

  test("a column opened to send a message holds it until its send is recorded", () => {
    const opened = columnsReducer([{ key: "k", anchor: "2-t" }], {
      kind: "openFresh",
      key: "b",
      at: "2-t",
      after: 0,
      text: "@agent separately?",
    })
    expect(opened[1]?.fresh).toEqual({ pending: "@agent separately?" })
    const sent = columnsReducer(opened, { kind: "sent", key: "b", sendId: "s" })
    expect(sent[1]?.fresh).toEqual({ sendId: "s" })
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

  test("close of the last column leaves none: the layout gives the root its first", () => {
    const s = columnsReducer([{ key: "a", anchor: "x" }], {
      kind: "close",
      index: 0,
    })
    expect(s).toEqual([])
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

  test("sync leaves a column whose anchor has not arrived, and settles it once it has", () => {
    const waiting: readonly Column[] = [{ key: "k", anchor: "2-b" }]
    expect(sync(waiting, tree({ "1-a": null }))).toBe(waiting)
    const arrived = tree({ "1-a": null, "2-b": "1-a", "3-c": "2-b" })
    expect(anchors(sync(waiting, arrived))).toEqual(["3-c"])
  })

  test("prune drops the columns whose anchor the settled document lacks", () => {
    const s: readonly Column[] = [
      { key: "a", anchor: "1-a" },
      { key: "b", anchor: "gone" },
      { key: "c", anchor: null },
    ]
    const pruned = columnsReducer(s, {
      kind: "prune",
      index: tree({ "1-a": null }),
    })
    expect(pruned.map(c => c.key)).toEqual(["a", "c"])
    expect(
      columnsReducer(pruned, { kind: "prune", index: tree({ "1-a": null }) }),
    ).toBe(pruned)
  })
})
