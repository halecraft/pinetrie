import {
  type CardHistoryRecord,
  type CardId,
  type CardRecord,
  type LaneRecord,
  NO_CONTENT,
  noteColumnIdFor,
  rootIdFor,
  type TextCard,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { threadCardOf } from "./fixtures.ts"
import { planRootDelete } from "./root.ts"
import { planLiftRoot, planSpinOff, type SpunThread } from "./spin-off.ts"
import { indexTasks, NO_TASK_INDEX, type TaskIndex } from "./task.ts"

const TEST_THREAD = threadIdFor("e")
const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const NEW_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000d")
const _ROOT_A = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const THREAD = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
const STARTS = threadIdFor("spun")
const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const C1 = cardIdFor("c1")
const canvasKey = { kind: "canvas", task: NEW_TASK } as const
/** Your message at the thread: a card at a thread, in its task. */
const note = {
  kind: "composing",
  thread: TEST_THREAD,
} as const
const spun = {
  kind: "gone",
  why: { kind: "spun", into: THREAD, thread: STARTS },
} as const
const card = (over: Partial<TextCard> = {}): TextCard => ({
  kind: "text",
  id: C1,
  owner: ADA,
  placer: ADA,
  place: note,
  content: { command: null, unsent: null, origin: null },
  ...over,
})

describe("planSpinOff (ADR-0111)", () => {
  const plan = (
    over: {
      cards?: CardRecord[]
      text?: string
      roots?: Set<typeof THREAD>
      sender?: typeof ADA
      tasks?: TaskIndex
    } = {},
  ) =>
    planSpinOff({
      cards: over.cards ?? [card()],
      request: {
        move: { card: C1, from: note, to: spun },
        task: NEW_TASK,
        state: null,
        here: TEST_TASK,
      },
      sender: over.sender ?? ADA,
      tasks: over.tasks ?? NO_TASK_INDEX,
      text: over.text ?? " plan it @agent ",
      roots: over.roots ?? new Set(),
    })

  test("the thread's first message is the card's text, trimmed, naming no agent; the card goes gone, spun into it", () => {
    expect(plan()).toEqual({
      kind: "spin",
      root: THREAD,
      thread: STARTS,
      text: "plan it @agent",
      mentions: [],
      step: {
        kind: "write",
        record: { ...card(), place: { ...spun, task: TEST_TASK, by: ADA } },
      },
    })
  })

  test("its history is the task the card leaves; from no task, the one its sender will be on", () => {
    const placeOf = (p: ReturnType<typeof plan>) =>
      p.kind === "spin" ? p.step.record.place : null
    const other = taskIdFor("01a0ffd2-0000-7000-8000-0000000000ee")
    const tasks = indexTasks(
      [threadCardOf({ thread: TEST_THREAD, task: other, by: ADA, cards: [] })],
      new Map(),
    )
    expect(placeOf(plan({ tasks }))).toMatchObject({ task: other })
    expect(placeOf(plan())).toMatchObject({ task: TEST_TASK })
  })

  test.each([
    ["a blank card", { text: " \n" }, { kind: "blank" }],
    ["a root id in use", { roots: new Set([THREAD]) }, { kind: "root-in-use" }],
    [
      "a card someone moved first",
      { cards: [card({ place: { ...note, kind: "pinned", order: "a" } })] },
      { kind: "refused", code: "moved" },
    ],
    [
      "a card in someone else's inventory",
      {
        cards: [card({ place: { kind: "inventory", holder: BEA } })],
      },
      { kind: "refused", code: "moved" },
    ],
  ] as const)("refused: %s", (_, over, refusal) => {
    expect(plan(over as Parameters<typeof plan>[0])).toEqual(refusal)
  })
})

describe("planLiftRoot (S139)", () => {
  const gone = card({ place: { ...spun, task: TEST_TASK, by: ADA } })
  const thread = (
    writers: SpunThread["writers"],
    known = true,
  ): SpunThread => ({
    thread: THREAD,
    known,
    writers,
  })
  /** The spun thread's card, alone on the task the spin-off made. */
  const spunCard = threadCardOf({
    thread: STARTS,
    task: NEW_TASK,
    by: ADA,
    cards: [],
  })
  const lift = (
    t: SpunThread,
    over: {
      cards?: CardRecord[]
      lanes?: LaneRecord[]
      histories?: ReadonlyMap<CardId, CardHistoryRecord>
    } = {},
  ) =>
    planLiftRoot({
      lifting: [C1],
      cards: over.cards ?? [gone, spunCard],
      threads: new Map([[THREAD, t]]),
      lanes: over.lanes ?? [],
      rootOfThread: new Map([[STARTS, THREAD]]),
      histories: over.histories ?? new Map(),
    })

  test.each([
    [
      "its first message alone: lifted, and deleted",
      thread([ADA]),
      {},
      {
        kind: "lift",
        delete: [{ root: THREAD, thread: STARTS }],
      },
    ],
    [
      "a reply: refused, naming who wrote second",
      thread([ADA, BEA]),
      {},
      {
        kind: "replied",
        by: BEA,
      },
    ],
    [
      "the agent answered: refused",
      thread([ADA, null]),
      {},
      {
        kind: "replied",
        by: null,
      },
    ],
    [
      "a card in it: refused",
      thread([ADA]),
      {
        cards: [
          gone,
          spunCard,
          card({
            id: cardIdFor("c2"),
            place: { ...note, thread: STARTS },
          }),
        ],
      },
      { kind: "replied", by: null },
    ],
    [
      "its thread's card taken into an inventory: refused (ADR-0124)",
      thread([ADA]),
      {
        cards: [
          gone,
          { ...spunCard, place: { kind: "inventory", holder: BEA } },
        ],
      },
      { kind: "replied", by: null },
    ],
    [
      "its thread's card moved since it was made: refused (ADR-0124)",
      thread([ADA]),
      {
        histories: new Map([
          [
            STARTS,
            {
              card: STARTS,
              events: [
                { kind: "created", by: ADA, from: null, to: canvasKey, at: 1 },
                {
                  kind: "moved",
                  by: BEA,
                  from: { kind: "canvas", task: TEST_TASK },
                  to: canvasKey,
                  at: 2,
                },
              ],
            },
          ],
        ]),
      },
      { kind: "replied", by: null },
    ],
    [
      "another card on its task's canvas: refused (ADR-0124)",
      thread([ADA]),
      {
        cards: [
          gone,
          spunCard,
          {
            kind: "note-column",
            id: noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a9"),
            owner: BEA,
            placer: BEA,
            place: { kind: "canvas", task: NEW_TASK, order: "9", width: 1 },
            content: NO_CONTENT,
          },
        ],
      },
      { kind: "replied", by: null },
    ],
    [
      "a card pinned to its task: refused (ADR-0124)",
      thread([ADA]),
      {
        cards: [
          gone,
          spunCard,
          card({
            id: cardIdFor("c3"),
            place: { kind: "task-pinned", task: NEW_TASK, order: "a" },
          }),
        ],
      },
      { kind: "replied", by: null },
    ],
    [
      "a lane in it: refused",
      thread([ADA]),
      {
        lanes: [
          {
            lane: threadIdFor("x"),
            root: THREAD,
            work: { kind: "own" },
            by: ADA,
            createdAt: 1,
          } as unknown as LaneRecord,
        ],
      },
      { kind: "replied", by: null },
    ],
    [
      "a thread the directory no longer names: undone, nothing to delete",
      thread([], false),
      {},
      { kind: "lift", delete: [] },
    ],
  ] as const)("%s", (_, t, over, plan) => {
    expect(lift(t, over as Parameters<typeof lift>[1])).toEqual(plan)
  })

  test("an undo of no spin-off lifts nothing", () => {
    expect(
      planLiftRoot({
        lifting: [C1],
        cards: [card()],
        threads: new Map(),
        lanes: [],
        rootOfThread: new Map(),
        histories: new Map(),
      }),
    ).toEqual({ kind: "lift", delete: [] })
  })
})

test("planRootDelete: its directory record, its thread's, its task's record, board place and title, the cards in it and on its task's canvas, its document and the task's stacks", () => {
  const inThread = card({
    id: cardIdFor("c2"),
    place: { ...note, thread: STARTS },
  })
  const onCanvas = threadCardOf({
    thread: STARTS,
    task: TEST_TASK,
    by: ADA,
    cards: [],
  })
  const plan = planRootDelete(
    THREAD,
    STARTS,
    TEST_TASK,
    [card(), inThread, onCanvas],
    new Map([[STARTS, THREAD]]),
  )
  expect(plan.values.map(v => v.namespace)).toEqual([
    "pinetrie.root",
    "pinetrie.thread",
    "pinetrie.task",
    "pinetrie.board",
    "pinetrie.mark",
  ])
  expect(plan.cards).toEqual([
    { kind: "remove", id: cardIdFor("c2") },
    { kind: "remove", id: STARTS },
  ])
  expect(plan.doc).toBe(`root:${THREAD}`)
  expect(plan.histories).toBe(TEST_TASK)
})
