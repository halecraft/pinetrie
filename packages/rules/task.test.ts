import {
  type CardRecord,
  cardIdOfKind,
  NO_CONTENT,
  rootIdFor,
  type ThreadId,
  taskIdFor,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { BOARD } from "./board.ts"
import { orderKey } from "./order.ts"
import { branchAfter, rankAfter } from "./rank.ts"
import { canvasOf, planThreadStart, TASK } from "./task.ts"
import { THREAD } from "./thread.ts"

const ADA = writerId("ada@x.io")
const K = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const [A, B, NEW] = ["a", "b", "new"].map(threadIdFor) as [
  ThreadId,
  ThreadId,
  ThreadId,
]
const N = cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a1")
const DOING = workflowStateIdFor("d")

/** `ids` on `K`'s canvas, ranked `orders`. */
const onCanvas = (
  ids: readonly (ThreadId | typeof N)[],
  orders: readonly number[],
): CardRecord[] =>
  ids.map((id, i) => {
    const place = {
      kind: "canvas",
      task: K,
      order: orderKey(orders[i] ?? 0),
      width: 1,
    } as const
    return id === N
      ? {
          kind: "note-column",
          id: N,
          owner: ADA,
          placer: ADA,
          place,
          content: NO_CONTENT,
        }
      : {
          kind: "thread",
          id: id as ThreadId,
          owner: ADA,
          placer: ADA,
          place,
          content: NO_CONTENT,
        }
  })

const start = (cards: readonly CardRecord[], parent: ThreadId | null) =>
  planThreadStart({
    thread: NEW,
    parent,
    root: ROOT,
    task: K,
    by: ADA,
    now: 7,
    state: null,
    tasks: new Set([K]),
    workflow: null,
    board: new Map(),
    cards,
  })

const ranked = (cards: readonly CardRecord[]) =>
  canvasOf(cards, K).map(c => c.id)

describe("where a thread's card lands (ADR-0116)", () => {
  test("a branch just after the thread it forks from; a new root at the end", () => {
    const cards = onCanvas(
      [A, N, B],
      [100, 200, 300].map(n => n * 2 ** 20),
    )
    const branch = start(cards, A)
    expect(ranked([...cards, ...branch.cards])).toEqual([A, NEW, N, B])
    expect(branch.cards[0]).toMatchObject({
      kind: "thread",
      id: NEW,
      owner: ADA,
      placer: ADA,
      place: { kind: "canvas", task: K, width: 1 },
      content: NO_CONTENT,
    })
    expect(ranked([...cards, ...start(cards, B).cards])).toEqual([A, N, B, NEW])
    expect(ranked([...cards, ...start(cards, null).cards])).toEqual([
      A,
      N,
      B,
      NEW,
    ])
    // A parent on no canvas here: at the end.
    const elsewhere = start(cards, threadIdFor("far")).cards
    expect(ranked([...cards, ...elsewhere])).toEqual([A, N, B, NEW])
  })

  test("with no room after its parent, the crowded cards are given new ranks in the same step, every card keeping its order", () => {
    const cards = onCanvas([A, N, B], [1000, 1001, 1002])
    const branch = start(cards, A)
    expect(branch.cards.length).toBeGreaterThan(1)
    const now = new Map(cards.map(c => [c.id, c] as const))
    for (const c of branch.cards) now.set(c.id, c)
    expect(ranked([...now.values()])).toEqual([A, NEW, N, B])
  })

  test("a new task's record and its board place come with its first thread; an existing one's do not", () => {
    const opened = planThreadStart({
      thread: NEW,
      parent: null,
      root: ROOT,
      task: taskIdFor("new"),
      by: ADA,
      now: 7,
      state: DOING,
      tasks: new Set([K]),
      workflow: {
        open: [{ id: DOING, name: "Doing" }],
        archive: { id: workflowStateIdFor("x"), name: "Done" },
      },
      board: new Map(),
      cards: [],
    })
    expect(opened.records.map(w => w.namespace)).toEqual([
      THREAD.namespace,
      TASK.namespace,
      BOARD.namespace,
    ])
    expect(start([], null).records.map(w => w.namespace)).toEqual([
      THREAD.namespace,
    ])
  })
})

test("branchAfter and rankAfter: the parent's index, else the last; a rank between two neighbours", () => {
  const canvas = canvasOf(onCanvas([A, N, B], [100, 200, 300]), K)
  expect(branchAfter(canvas, A)).toBe(0)
  expect(branchAfter(canvas, B)).toBe(2)
  expect(branchAfter(canvas, null)).toBe(2)
  expect(branchAfter([], A)).toBe(-1)
  const between = rankAfter(canvas, 0)
  expect(between.respaced).toEqual([])
  expect(between.order > orderKey(100) && between.order < orderKey(200)).toBe(
    true,
  )
  expect(rankAfter(canvas, -1).order < orderKey(100)).toBe(true)
  expect(rankAfter([], -1).order).toBeTruthy()
})
