import { entryId, type LaneView, textCardId, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { type Column, columnsReducer } from "./columns.ts"
import { threadOfEntry, tree } from "./fixtures.ts"

const anchors = (s: readonly Column[]) => s.map(c => c.anchor)
const L = threadIdFor("l")
const lane = (tip: string | null, name = L): LaneView => ({
  name,
  tip: tip === null ? null : entryId(tip),
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
})
const sync = (
  s: readonly Column[],
  index: ReturnType<typeof tree>,
  lanes: readonly LaneView[] = [],
) => columnsReducer(s, { kind: "sync", index, lanes })

describe("columnsReducer", () => {
  // In `tree`, an entry with no parent, and each child but an entry's oldest,
  // starts the thread `t-<its id>` (`withThreads`).
  const A = threadOfEntry("1-a")
  test("sync follows its thread to its end, never into a newer branch", () => {
    const col: readonly Column[] = [{ key: "k", anchor: entryId("2-b") }]
    // A reply below the end moves the column on, and it takes its thread.
    const replied = sync(col, tree({ "1-a": null, "2-b": "1-a", "3-c": "2-b" }))
    expect(replied).toEqual([{ key: "k", anchor: "3-c", thread: A }])
    // A newer branch off an earlier message does not.
    const branched = sync(
      replied,
      tree({ "1-a": null, "2-b": "1-a", "3-c": "2-b", "4-x": "1-a" }),
    )
    expect(branched).toBe(replied)
    // A branch at its end, 5-x, is another thread too, newer as it is.
    const forked = sync(
      replied,
      tree({
        "1-a": null,
        "2-b": "1-a",
        "3-c": "2-b",
        "4-d": "3-c",
        "5-x": "3-c",
      }),
    )
    expect(anchors(forked)).toEqual(["4-d"])
  })

  test("a column opened at an entry takes the thread that entry is in", () => {
    const i = tree({ "1-a": null, "2-b": "1-a", "3-x": "1-a", "4-y": "3-x" })
    expect(sync([{ key: "k", anchor: entryId("3-x") }], i)).toEqual([
      { key: "k", anchor: "4-y", thread: threadOfEntry("3-x") },
    ])
  })

  test("a fresh column waits for its own message, then follows its thread; before that, a lane created for it holds its fork", () => {
    const T = threadIdFor("new")
    const fresh: readonly Column[] = [
      {
        key: "k",
        anchor: entryId("2-t"),
        thread: T,
        fresh: { sendId: "s-1" },
      },
    ]
    const i = tree({ "1-a": null, "2-t": "1-a" })
    expect(sync(fresh, i, [lane("2-t", T)])).toBe(fresh)
    const ours = tree(
      { "1-a": null, "2-t": "1-a", "3-lane": "2-t", "4-ours": "2-t" },
      { "4-ours": "s-1" },
    )
    // `withThreads` gives 4-ours its own thread, as its send's `starts` would.
    const t4 = threadOfEntry("4-ours")
    expect(
      sync([{ ...fresh[0], thread: t4 } as Column], ours, [lane("4-ours", t4)]),
    ).toEqual([{ key: "k", anchor: "4-ours", thread: t4 }])
  })

  test("a thread with no entry yet follows its lane's tip", () => {
    const T = threadIdFor("new")
    const col: readonly Column[] = [
      { key: "k", anchor: entryId("1-a"), thread: T },
    ]
    const i = tree({ "1-a": null, "2-t": "1-a" })
    expect(sync(col, i, [lane("2-t", T)])).toEqual([
      { key: "k", anchor: "2-t", thread: T },
    ])
    expect(sync(col, i)).toBe(col)
  })

  test("openFresh goes after the column it branches from", () => {
    const after = columnsReducer(
      [
        { key: "a", anchor: entryId("x") },
        { key: "b", anchor: entryId("y") },
      ],
      {
        kind: "openFresh",
        key: "f",
        thread: threadIdFor("f"),
        at: entryId("x"),
        after: 0,
      },
    )
    expect(after.map(c => c.key)).toEqual(["a", "f", "b"])
  })

  test("a column opened to send a message holds it until its send is recorded", () => {
    const opened = columnsReducer([{ key: "k", anchor: entryId("2-t") }], {
      kind: "openFresh",
      key: "b",
      thread: threadIdFor("b"),
      at: entryId("2-t"),
      after: 0,
      pending: {
        text: "@agent separately?",
        card: textCardId("c0000000-0000-7000-8000-000000000001"),
      },
    })
    expect(opened[1]?.fresh).toEqual({
      pending: {
        text: "@agent separately?",
        card: "c0000000-0000-7000-8000-000000000001",
      },
    })
    const sent = columnsReducer(opened, { kind: "sent", key: "b", sendId: "s" })
    expect(sent[1]?.fresh).toEqual({ sendId: "s" })
  })

  test("a branch's column holds its prefill until its first send", () => {
    const opened = columnsReducer([{ key: "k", anchor: entryId("2-t") }], {
      kind: "openFresh",
      key: "b",
      thread: threadIdFor("b"),
      at: entryId("2-t"),
      after: 0,
      prefill: { text: "@agent ", blank: true },
    })
    expect(opened[1]?.fresh).toEqual({
      prefill: { text: "@agent ", blank: true },
    })
    const sent = columnsReducer(opened, { kind: "sent", key: "b", sendId: "s" })
    expect(sent[1]).toEqual({
      key: "b",
      anchor: "2-t",
      thread: threadIdFor("b"),
      fresh: { sendId: "s" },
    })
  })

  test("open inserts next to the column it forks from", () => {
    const three: Column[] = [
      { key: "a", anchor: entryId("x") },
      { key: "b", anchor: entryId("y") },
    ]
    const s = columnsReducer(three, {
      kind: "open",
      key: "new",
      after: 0,
      anchor: entryId("z"),
    })
    expect(anchors(s)).toEqual(["x", "z", "y"])
  })

  test("close of the last column leaves none: the layout gives the root its first", () => {
    const s = columnsReducer([{ key: "a", anchor: entryId("x") }], {
      kind: "close",
      index: 0,
    })
    expect(s).toEqual([])
  })

  describe("move", () => {
    const abcd: readonly Column[] = [
      { key: "a", anchor: entryId("w") },
      { key: "b", anchor: entryId("x") },
      { key: "c", anchor: entryId("y") },
      { key: "d", anchor: entryId("z") },
    ]
    const keys = (from: number, to: number) =>
      columnsReducer(abcd, { kind: "move", from, to }).map(c => c.key)

    test("moves a column left or right, keeping its key and the others' order", () => {
      expect(keys(2, 0)).toEqual(["c", "a", "b", "d"])
      expect(keys(0, 2)).toEqual(["b", "c", "a", "d"])
      expect(keys(1, 3)).toEqual(["a", "c", "d", "b"])
    })

    test("clamps `to` to the list", () => {
      expect(keys(1, 9)).toEqual(["a", "c", "d", "b"])
      expect(keys(2, -1)).toEqual(["c", "a", "b", "d"])
    })

    test("a move to where the column is, or of no column, returns the same state", () => {
      expect(columnsReducer(abcd, { kind: "move", from: 1, to: 1 })).toBe(abcd)
      expect(columnsReducer(abcd, { kind: "move", from: 7, to: 0 })).toBe(abcd)
    })
  })

  describe("a reader's settings (ADR-0106, ADR-0073)", () => {
    const ab: readonly Column[] = [
      { key: "a", anchor: entryId("1-a") },
      { key: "b", anchor: entryId("1-a") },
    ]
    test("details and density change only the column with their key", () => {
      const open = columnsReducer(ab, { kind: "details", key: "b", open: true })
      expect(open.map(c => c.details)).toEqual([undefined, true])
      const closed = columnsReducer(open, {
        kind: "details",
        key: "b",
        open: false,
      })
      expect(closed).toEqual(ab)
      const outline = columnsReducer(ab, {
        kind: "density",
        key: "a",
        density: "outline",
      })
      expect(outline.map(c => c.density)).toEqual(["outline", undefined])
    })
    test("a key no column has, or a setting already so, returns the same state", () => {
      expect(
        columnsReducer(ab, { kind: "details", key: "z", open: true }),
      ).toBe(ab)
      expect(
        columnsReducer(ab, { kind: "details", key: "a", open: false }),
      ).toBe(ab)
      expect(
        columnsReducer(ab, { kind: "density", key: "z", density: "raw" }),
      ).toBe(ab)
    })
    test("open details survive the column settling on its thread", () => {
      const settled = sync(
        [{ key: "k", anchor: entryId("1-a"), details: true }],
        tree({ "1-a": null, "2-t": "1-a" }),
      )
      expect(settled).toEqual([
        {
          key: "k",
          anchor: entryId("2-t"),
          thread: threadOfEntry("1-a"),
          details: true,
        },
      ])
    })
  })

  test("sync leaves a column whose anchor has not arrived, and settles it once it has", () => {
    const waiting: readonly Column[] = [{ key: "k", anchor: entryId("2-b") }]
    expect(sync(waiting, tree({ "1-a": null }))).toBe(waiting)
    const arrived = tree({ "1-a": null, "2-b": "1-a", "3-c": "2-b" })
    expect(anchors(sync(waiting, arrived))).toEqual(["3-c"])
  })

  test("prune drops the columns whose anchor the settled document lacks", () => {
    const s: readonly Column[] = [
      { key: "a", anchor: entryId("1-a") },
      { key: "b", anchor: entryId("gone") },
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
