import {
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  entryId,
  NO_CONTENT,
  ROOT_ORIGIN,
  rootIdFor,
  type ThreadId,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  canvasOfPlace,
  cardsOnCanvas,
  indexCanvases,
  isOnCanvas,
  planThreadOpen,
  type ThreadPlacement,
} from "./canvas-index.ts"
import { orderKey } from "./order.ts"
import { branchAfter, rankAfter } from "./rank.ts"
import { THREAD } from "./thread.ts"

const ADA = writerId("ada@x.io")
const K = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
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
      canvas: K,
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

/** A thread opened just after `parent` on K's canvas: its records, and the cards it writes. */
const start = (cards: readonly CardRecord[], parent: ThreadId | null) => {
  const opened = planThreadOpen({
    thread: NEW,
    origin: ROOT_ORIGIN,
    root: ROOT,
    by: ADA,
    now: 7,
    placement: { kind: "after", canvas: K, parent },
    opens: null,
    cards,
  })
  if (opened.kind !== "open") throw new Error(`refused: ${opened.code}`)
  return {
    records: opened.records,
    cards: opened.steps.flatMap(s => (s.kind === "write" ? [s.record] : [])),
  }
}

const ranked = (cards: readonly CardRecord[]) =>
  cardsOnCanvas(cards, K).map(c => c.id)

describe("where a thread's card lands as it opens", () => {
  test("a branch just after the thread it forks from; a new root at the end", () => {
    const cards = onCanvas(
      [A, N, B],
      [100, 200, 300].map(n => n * 2 ** 20),
    )
    const branch = start(cards, A)
    expect(ranked([...cards, ...branch.cards])).toEqual([A, NEW, N, B])
    expect(branch.cards.at(-1)).toMatchObject({
      kind: "thread",
      id: NEW,
      owner: ADA,
      placer: ADA,
      place: { kind: "canvas", canvas: K, width: 1 },
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

  test("with no room after its parent, the crowded cards are given new ranks in the same step", () => {
    const cards = onCanvas([A, N, B], [1000, 1001, 1002])
    const branch = start(cards, A)
    expect(branch.cards.length).toBeGreaterThan(1)
    const now = new Map(cards.map(c => [c.id, c] as const))
    for (const c of branch.cards) now.set(c.id, c)
    expect(ranked([...now.values()])).toEqual([A, NEW, N, B])
  })

  test("where it was dropped on a canvas, or into an inventory", () => {
    const cards = onCanvas(
      [A, N, B],
      [100, 200, 300].map(n => n * 2 ** 20),
    )
    const at = (placement: ThreadPlacement) => {
      const opened = planThreadOpen({
        thread: NEW,
        origin: { kind: "fork", at: entryId("e"), how: "copy" },
        root: ROOT,
        by: ADA,
        now: 7,
        placement,
        opens: null,
        cards,
      })
      return opened.kind === "open" ? opened.steps.at(-1) : opened
    }
    const spot = at({
      kind: "spot",
      to: { kind: "canvas-at", canvas: K, after: N },
    })
    expect(
      spot?.kind === "write" ? ranked([...cards, spot.record]) : null,
    ).toEqual([A, N, NEW, B])
    expect(at({ kind: "inventory", holder: ADA })).toMatchObject({
      kind: "write",
      record: { id: NEW, place: { kind: "inventory", holder: ADA } },
    })
  })

  test("a new canvas's card, at the end of its state, comes with its first thread; an existing one's does not", () => {
    const opened = planThreadOpen({
      thread: NEW,
      origin: ROOT_ORIGIN,
      root: ROOT,
      by: ADA,
      now: 7,
      placement: { kind: "after", canvas: canvasIdFor("new"), parent: null },
      opens: {
        state: DOING,
        workflow: {
          open: [{ id: DOING, name: "Doing" }],
          archive: { id: workflowStateIdFor("x"), name: "Done" },
        },
      },
      cards: [],
    })
    if (opened.kind !== "open") throw new Error("refused")
    expect(opened.records.map(w => w.namespace)).toEqual([THREAD.namespace])
    expect(opened.steps.map(s => s.kind === "write" && s.record.kind)).toEqual([
      "canvas",
      "thread",
    ])
    expect(opened.steps[0]).toMatchObject({
      record: { place: { kind: "board", state: DOING } },
    })
    expect(start([], null).cards.map(c => c.kind)).toEqual(["thread"])
  })
})

test("branchAfter and rankAfter: the parent's index, else the last; a rank between two neighbours", () => {
  const here = cardsOnCanvas(onCanvas([A, N, B], [100, 200, 300]), K)
  expect(branchAfter(here, A)).toBe(0)
  expect(branchAfter(here, B)).toBe(2)
  expect(branchAfter(here, null)).toBe(2)
  expect(branchAfter([], A)).toBe(-1)
  const between = rankAfter(here, 0)
  expect(between.respaced).toEqual([])
  expect(between.order > orderKey(100) && between.order < orderKey(200)).toBe(
    true,
  )
  expect(rankAfter(here, -1).order < orderKey(100)).toBe(true)
  expect(rankAfter([], -1).order).toBeTruthy()
})

describe("a trashed card is in the canvas its left place is in", () => {
  const trashedB: CardRecord = {
    kind: "thread",
    id: B,
    owner: ADA,
    placer: ADA,
    place: {
      kind: "trash",
      left: { kind: "canvas", canvas: K, order: orderKey(2), width: 1 },
    },
    content: NO_CONTENT,
  }
  const cards = [...onCanvas([A], [1]), trashedB]
  const threads = new Map([
    [A, { thread: A, root: ROOT, by: ADA, createdAt: 0, origin: ROOT_ORIGIN }],
    [B, { thread: B, root: ROOT, by: ADA, createdAt: 0, origin: ROOT_ORIGIN }],
  ])

  test("in its canvas by the index, and on no canvas", () => {
    const canvases = indexCanvases(cards, threads)
    expect(canvases.canvasOfThread.get(B)).toBe(K)
    expect(canvases.canvasOfCard.get(B)).toBe(K)
    expect(cardsOnCanvas(cards, K).map(c => c.id)).toEqual([A])
    expect(canvases.threadsOf.get(K)).toEqual([A])
    expect([isOnCanvas(canvases, A), isOnCanvas(canvases, B)]).toEqual([
      true,
      false,
    ])
    const pinned = { kind: "pinned", thread: B, order: "a" } as const
    expect(canvasOfPlace(canvases, pinned)).toBe(K)
    const trashed = cards.find(c => c.id === B)
    expect(trashed && canvasOfPlace(canvases, trashed.place)).toBe(K)
  })
})
