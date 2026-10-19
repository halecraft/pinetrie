import {
  type CanvasId,
  canvasIdFor,
  entryId,
  type LaneRecord,
  rootIdFor,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  type CardRecord,
  type EntryLike,
  indexTree,
  type Send,
  type SendAt,
  UNTICKED,
} from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { indexCanvases } from "./canvas-index.ts"
import { landedThreadCard } from "./fixtures.ts"
import { type GateFacts, type GateRoot, planGate } from "./gate.ts"

const T = threadIdFor("t")
const NEW = threadIdFor("new")
const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const OTHER = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const BEA = writerId("bea@x.io")
const E = entryId("e")

const send = (at: SendAt): Send => ({
  kind: "send",
  text: "x",
  root: ROOT,
  at,
  mentions: [],
  card: null,
  pinned: [],
  base: null,
  state: null,
})
const atEnd = send({ kind: "end", thread: T, seen: E })
const popped = send({ kind: "queue", thread: T })
const branch = (canvas: CanvasId = OTHER) =>
  send({ kind: "branch", thread: NEW, at: E, canvas })

const onCanvas = landedThreadCard({
  thread: T,
  canvas: CANVAS,
  by: BEA,
  cards: [],
})
const inInventory: CardRecord = {
  ...onCanvas,
  place: { kind: "inventory", holder: BEA },
}
const inTrash: CardRecord = {
  kind: "thread",
  id: T,
  owner: BEA,
  placer: BEA,
  place: {
    kind: "trash",
    left: { kind: "canvas", canvas: CANVAS, order: "1", width: 1 },
  },
  content: UNTICKED,
}

/** One root, whose entry `e` is in T. */
const root: GateRoot = {
  index: indexTree({
    [E]: {
      id: E,
      parentId: null,
      thread: T,
      type: "message",
      message: { role: "user", content: "e" },
    } satisfies EntryLike,
  }),
  revisions: new Map(),
}

const lane = (history: "jj" | "folder"): LaneRecord => ({
  lane: T,
  root: ROOT,
  history,
  by: BEA,
  createdAt: 0,
})

const facts = (over: Partial<GateFacts> = {}): GateFacts => {
  const cards = over.cards ?? [onCanvas]
  return {
    canvases: indexCanvases(cards, new Map()),
    cards,
    archived: new Map(),
    lanes: new Map(),
    kind: "jj",
    roots: new Map(),
    ...over,
  }
}
const archivedCanvas = (canvas: CanvasId) =>
  new Map([[canvas, { canvas, by: BEA, at: 1 }]])

describe("planGate", () => {
  test("a send in a free thread in no archived canvas is cleared, as given", () => {
    const plan = planGate(atEnd, facts())
    expect(plan.kind).toBe("cleared")
    if (plan.kind === "cleared") expect(plan.command).toBe(atEnd)
  })

  test("a send at an archived canvas's thread, or popped from its queue, is refused archived", () => {
    const archived = archivedCanvas(CANVAS)
    for (const command of [atEnd, popped])
      expect(planGate(command, facts({ archived }))).toEqual({
        kind: "archived",
        canvas: { canvas: CANVAS, by: BEA, at: 1 },
      })
  })

  test("a branch into an archived canvas is refused before any root is read", () => {
    expect(
      planGate(branch(OTHER), facts({ archived: archivedCanvas(OTHER) })).kind,
    ).toBe("archived")
  })

  test("a branch at an entry asks for its root's tree, then is decided by it", () => {
    expect(planGate(branch(), facts())).toEqual({
      kind: "read",
      roots: [ROOT],
    })
    const roots = new Map([[ROOT, root]])
    expect(planGate(branch(), facts({ cards: [inInventory], roots }))).toEqual({
      kind: "held",
      thread: T,
      holding: { kind: "held", by: BEA },
    })
    expect(planGate(branch(), facts({ roots })).kind).toBe("cleared")
  })

  test("a copy's first send, at its record's fork, answers to the copy's holder", () => {
    const cards = [inInventory]
    const canvases = {
      ...indexCanvases(cards, new Map()),
      forkOf: new Map([[NEW, { kind: "fork", at: E, how: "copy" } as const]]),
    }
    const roots = new Map([[ROOT, root]])
    expect(planGate(branch(), facts({ cards, canvases, roots })).kind).toBe(
      "cleared",
    )
  })

  test("a send in a trashed thread is refused held, as trashed", () => {
    expect(planGate(popped, facts({ cards: [inTrash] }))).toEqual({
      kind: "held",
      thread: T,
      holding: { kind: "trashed" },
    })
  })

  test("a send on a lane of another kind is refused foreign, after a hold", () => {
    const lanes = new Map<ThreadId, LaneRecord>([[T, lane("folder")]])
    expect(planGate(atEnd, facts({ lanes }))).toEqual({
      kind: "foreign",
      lane: { kind: "foreign", lane: T, history: "folder" },
    })
    expect(planGate(atEnd, facts({ lanes, cards: [inInventory] })).kind).toBe(
      "held",
    )
    expect(planGate(atEnd, facts({ lanes, kind: null })).kind).toBe("cleared")
  })
})
