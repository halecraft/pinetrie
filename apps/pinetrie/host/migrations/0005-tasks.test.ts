import {
  entryId,
  rootIdFor,
  type ThreadId,
  type ThreadRecord,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { readTreeIndex } from "@pinetrie/reads"
import { BOARD, MARK, TASK } from "@pinetrie/rules"

import { newRootDoc, writeEntry } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import { threadRow } from "../fakes.ts"
import {
  historiesByRoot,
  planOpenTasks,
  planTaskPlaces,
  planTaskRecords,
  railOrder,
  taskOfRoot,
} from "./0005-tasks.ts"

const ADA = writerId("ada@x.io")
const R = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const OTHER = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const [T1, T2, T3] = ["1", "2", "3"].map(threadIdFor) as [
  ThreadId,
  ThreadId,
  ThreadId,
]

/** r1 starts T1; T1 goes on at a; a branch at r1, b, starts T2; one at a, c, T3. */
const index = () => {
  const doc = newRootDoc()
  writeEntry(doc, threadRow("r1", null, T1))
  writeEntry(doc, threadRow("b", "r1", T2))
  writeEntry(doc, {
    ...threadRow("a", "r1", T1),
    payload: { message: { role: "user", content: "a" } },
  })
  writeEntry(doc, threadRow("c", "a", T3))
  return readTreeIndex(doc)
}
const record = (thread: ThreadId, createdAt: number): ThreadRecord => ({
  thread,
  root: R,
  by: ADA,
  createdAt,
  fork: null,
})
const threads = new Map([
  [T1, record(T1, 1)],
  [T2, record(T2, 2)],
  [T3, record(T3, 3)],
])

test("a root's task is k- and the root's own id", () => {
  expect(taskOfRoot(R)).toBe("k-01a0ffd2-0000-7000-8000-00000000000a")
})

test("railOrder: the threads by where their first entries come, depth first, oldest child first", () => {
  expect(railOrder(index())).toEqual([T1, T3, T2])
})

describe("planTaskPlaces", () => {
  const row = (over: Record<string, string>) => ({
    owner: ADA,
    kind: "drafting",
    root: R,
    at: "",
    lane: "",
    column: "",
    order: "",
    by: "",
    seen: "",
    command: "",
    fact: "",
    unsent: "",
    placer: ADA,
    holder: "",
    ...over,
  })
  const plan = (rows: Record<string, Record<string, string>>) =>
    planTaskPlaces({ rows, threads, indexes: new Map([[R, index()]]) })

  test("each thread a card on its root's task's canvas, in rail order, one column wide", () => {
    const { rows } = plan({})
    expect(
      [T1, T3, T2].map(t => [rows[t]?.kind, rows[t]?.task, rows[t]?.width]),
    ).toEqual([
      ["canvas", taskOfRoot(R), "1"],
      ["canvas", taskOfRoot(R), "1"],
      ["canvas", taskOfRoot(R), "1"],
    ])
    const order = [T1, T3, T2].map(t => rows[t]?.order ?? "")
    expect(order).toEqual([...order].sort())
    expect(rows[T1]).toMatchObject({ owner: ADA, placer: ADA })
  })

  test("a card at a thread's end, or queued, names its thread and no root, from the tree when its lane is no thread's; one in no thread is left", () => {
    const { rows, lost } = plan({
      c1: row({ kind: "drafting", at: "a" }),
      c2: row({ kind: "note", at: "c", lane: "main", order: "3" }),
      c3: row({ kind: "pinned", at: "b", lane: T2, order: "m" }),
      c4: row({ kind: "drafting", at: "x", root: OTHER }),
      c5: row({ kind: "queued", at: "a", lane: T1, order: "m", by: ADA }),
    })
    expect(
      ["c1", "c2", "c3", "c5"].map(id => [rows[id]?.lane, rows[id]?.root]),
    ).toEqual([
      [T1, ""],
      [T3, ""],
      [T2, ""],
      [T1, ""],
    ])
    expect(rows.c4).toMatchObject({ root: OTHER, lane: "", task: "" })
    expect(lost).toEqual(["c4"])
  })

  test("a fresh card names its root's task; a gone one, its root's task in place of the root", () => {
    const { rows } = plan({
      f: row({ kind: "fresh", column: "k", at: "a" }),
      g: row({ kind: "discarded", holder: ADA }),
      n: row({ kind: "discarded", root: "", holder: ADA }),
    })
    expect(rows.f).toMatchObject({ task: taskOfRoot(R), root: R })
    expect(rows.g).toMatchObject({ task: taskOfRoot(R), root: "" })
    expect(rows.n).toMatchObject({ task: "", root: "" })
  })

  test("a second run writes nothing: rows with a task, and threads with a card, are left", () => {
    const { rows } = plan({})
    expect(
      planTaskPlaces({ rows, threads, indexes: new Map([[R, index()]]) }).rows,
    ).toEqual({})
  })
})

test("historiesByRoot: the moves: documents no task names", () => {
  const byTask = `moves:${ADA}:${taskOfRoot(R)}`
  const byRoot = `moves:${ADA}:${R}`
  expect(historiesByRoot([byTask, byRoot, "places"])).toEqual([byRoot])
})

test("planOpenTasks: each open root's order key under its task; a key that is no root goes", () => {
  expect(planOpenTasks({ [R]: "a", [OTHER]: "b", main: "c" })).toEqual({
    [taskOfRoot(R)]: "a",
    [taskOfRoot(OTHER)]: "b",
  })
})

describe("planTaskRecords", () => {
  const place = { state: "w-1", rank: "m", by: ADA, at: 5 }
  const writes = planTaskRecords({
    roots: [
      { root: R, entry: entryId("r1") },
      { root: OTHER, entry: entryId("o1") },
    ],
    threads,
    board: { [R]: place },
    marks: new Map([
      [R, { r1: { title: "Plans", by: ADA, at: 4 }, a: { title: "x" } }],
    ]),
  })

  test("a task per root with a thread, opened by its first thread's starter; its place and its title moved to it", () => {
    const task = taskOfRoot(R)
    expect(writes).toEqual([
      expect.objectContaining({
        kind: "set",
        namespace: TASK.namespace,
        key: task,
        value: { by: ADA, createdAt: 1 },
      }),
      expect.objectContaining({
        kind: "set",
        namespace: BOARD.namespace,
        key: task,
        value: place,
      }),
      expect.objectContaining({
        kind: "delete",
        namespace: BOARD.namespace,
        key: R,
      }),
      expect.objectContaining({
        kind: "set",
        namespace: MARK.namespace,
        key: task,
        value: { title: "Plans", by: ADA, at: 4 },
      }),
    ])
  })

  test("a root with no thread recorded gets no task", () => {
    expect(writes.some(w => w.key === taskOfRoot(OTHER))).toBe(false)
  })
})
