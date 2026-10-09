import { entryId, type LaneView, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { type Column, keyText, newTabReducer } from "./columns.ts"
import { TEST_TASK, threadOfEntry, tree } from "./fixtures.ts"

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
/** Each column settled (`newTabReducer`'s `sync`); the same list when none changes. */
const sync = (
  s: readonly Column[],
  index: ReturnType<typeof tree>,
  lanes: readonly LaneView[] = [],
): readonly Column[] => {
  const next = s.map(c => newTabReducer(c, { kind: "sync", index, lanes }))
  return next.every((c, i) => c === s[i]) ? s : next
}

describe("newTabReducer", () => {
  // In `tree`, an entry with no parent, and each child but an entry's oldest,
  // starts the thread `t-<its id>` (`withThreads`).
  const A = threadOfEntry("1-a")
  test("sync follows its thread to its end, never into a newer branch", () => {
    const col: readonly Column[] = [
      { key: "k", anchor: entryId("2-b"), thread: A },
    ]
    // A reply below the end moves the column on.
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

  test("a fresh column's first send spends its prefill and keeps its task", () => {
    const T = threadIdFor("b")
    const opened: readonly Column[] = [
      {
        key: "b",
        anchor: null,
        thread: T,
        fresh: {
          prefill: { text: "@agent ", blank: true },
          task: TEST_TASK,
        },
      },
    ]
    const sent = newTabReducer(opened[0] as Column, {
      kind: "sent",
      sendId: "s",
    })
    expect(sent).toEqual({
      key: "b",
      anchor: null,
      thread: T,
      fresh: { sendId: "s", task: TEST_TASK },
    })
  })

  describe("a reader's settings (ADR-0106, ADR-0073)", () => {
    const a: Column = { key: "a", anchor: entryId("1-a"), thread: A }
    test("details and density change the column; a setting already so, the same column", () => {
      const open = newTabReducer(a, { kind: "details", open: true })
      expect(open.details).toBe(true)
      expect(newTabReducer(open, { kind: "details", open: false })).toEqual(a)
      expect(
        newTabReducer(a, { kind: "density", density: "outline" }).density,
      ).toBe("outline")
      expect(newTabReducer(a, { kind: "details", open: false })).toBe(a)
      const raw = newTabReducer(a, { kind: "density", density: "raw" })
      expect(newTabReducer(raw, { kind: "density", density: "raw" })).toBe(raw)
    })
    test("open details survive the column settling on its thread", () => {
      const settled = sync(
        [{ key: "k", anchor: entryId("1-a"), thread: A, details: true }],
        tree({ "1-a": null, "2-t": "1-a" }),
      )
      expect(settled).toEqual([
        { key: "k", anchor: entryId("2-t"), thread: A, details: true },
      ])
    })
  })

  test("sync leaves a column whose thread has not arrived, and settles it once it has", () => {
    const waiting: readonly Column[] = [
      { key: "k", anchor: entryId("2-b"), thread: A },
    ]
    expect(sync(waiting, tree({ "5-z": null }))).toBe(waiting)
    const arrived = tree({ "1-a": null, "2-b": "1-a", "3-c": "2-b" })
    expect(anchors(sync(waiting, arrived))).toEqual(["3-c"])
  })
})

test("keyText: a column's key as the page draws it, whatever its kind (ADR-0116)", () => {
  const T = threadIdFor("t")
  expect(keyText({ kind: "card", card: T })).toBe(T)
  expect(keyText({ kind: "fresh", thread: T })).toBe(T)
  expect(keyText({ kind: "newTab", thread: T })).toBe(T)
  expect(keyText({ kind: "task", task: TEST_TASK })).toBe(TEST_TASK)
})
