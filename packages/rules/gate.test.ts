import {
  type CardRecord,
  type EntryLike,
  ERR,
  entryId,
  indexTree,
  type LaneRecord,
  NO_CONTENT,
  rootIdFor,
  type Send,
  type SendAt,
  type TaskId,
  type ThreadId,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { threadCardOf } from "./fixtures.ts"
import { type GateFacts, type GateRoot, gateRefusal, planGate } from "./gate.ts"
import { HELD_WORDS, TRASHED_WORDS } from "./held.ts"
import { indexTasks } from "./task.ts"

const T = threadIdFor("t")
const NEW = threadIdFor("new")
const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const OTHER = taskIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const BEA = writerId("bea@x.io")
const E = entryId("e")

const send = (at: SendAt): Send => ({
  kind: "chat",
  text: "x",
  root: ROOT,
  at,
  asksAgent: false,
  mentions: [],
  card: null,
  pinned: [],
  base: null,
  state: null,
})
const atEnd = send({ kind: "end", thread: T, seen: E })
const popped = send({ kind: "queue", thread: T })
const branch = (task: TaskId = OTHER) =>
  send({ kind: "branch", thread: NEW, at: E, task })

const onCanvas = threadCardOf({ thread: T, task: TASK, by: BEA, cards: [] })
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
    left: { kind: "canvas", task: TASK, order: "1", width: 1 },
  },
  content: NO_CONTENT,
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
    tasks: indexTasks(cards, new Map()),
    cards,
    archived: new Map(),
    lanes: new Map(),
    kind: "jj",
    roots: new Map(),
    ...over,
  }
}
const archivedTask = (task: TaskId) =>
  new Map([[task, { task, by: BEA, at: 1 }]])

describe("planGate", () => {
  test("a send in a free thread in no archived task is cleared, as given", () => {
    const plan = planGate(atEnd, facts())
    expect(plan.kind).toBe("cleared")
    if (plan.kind === "cleared") expect(plan.command).toBe(atEnd)
  })

  test("a send at an archived task's thread, or popped from its queue, is refused archived", () => {
    const archived = archivedTask(TASK)
    for (const command of [atEnd, popped])
      expect(planGate(command, facts({ archived }))).toEqual({
        kind: "archived",
        task: { task: TASK, by: BEA, at: 1 },
      })
  })

  test("a branch into an archived task is refused before any root is read", () => {
    expect(
      planGate(branch(OTHER), facts({ archived: archivedTask(OTHER) })).kind,
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
    const tasks = {
      ...indexTasks(cards, new Map()),
      forkOf: new Map([[NEW, { kind: "fork", at: E, how: "copy" } as const]]),
    }
    const roots = new Map([[ROOT, root]])
    expect(planGate(branch(), facts({ cards, tasks, roots })).kind).toBe(
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

test("gateRefusal: an archive names its archiver, a hold and a trash say what to do", () => {
  const nameOf = (w: string) => (w === BEA ? "Bea" : "?")
  expect(
    gateRefusal(
      { kind: "archived", task: { task: TASK, by: BEA, at: 1 } },
      nameOf,
    ),
  ).toEqual({
    kind: "refused",
    code: ERR.TASK_ARCHIVED,
    message: "archived by Bea: restore the task first",
  })
  expect(
    gateRefusal(
      { kind: "held", thread: T, holding: { kind: "held", by: BEA } },
      nameOf,
    ),
  ).toEqual({ kind: "refused", code: ERR.REFUSED, message: HELD_WORDS })
  expect(
    gateRefusal(
      { kind: "held", thread: T, holding: { kind: "trashed" } },
      nameOf,
    ).message,
  ).toBe(TRASHED_WORDS)
})
