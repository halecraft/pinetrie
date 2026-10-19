import {
  canvasIdFor,
  type LaneRecord,
  rootIdFor,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import {
  type CardId,
  type CardRecord,
  cardIdOfKind,
  type TextCard,
  UNTICKED,
} from "@pinetrie/threads"
import { canvasCard, cardIdFor } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import { type CanvasIndex, NO_CANVAS_INDEX } from "./canvas-index.ts"
import type { CardHistoryRecord } from "./card-history.ts"
import { landedThreadCard } from "./fixtures.ts"
import { planRootDelete } from "./root.ts"
import { planLiftRoot, planSpinOff, type SpunThread } from "./spin-off.ts"

const TEST_THREAD = threadIdFor("e")
const TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const NEW_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000d")
const _ROOT_A = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const THREAD = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
const STARTS = threadIdFor("spun")
const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const C1 = cardIdFor("c1")
const canvasKey = { kind: "canvas", canvas: NEW_CANVAS } as const
const SPIN_WORKFLOW = {
  open: [{ id: workflowStateIdFor("d"), name: "Doing" }],
  archive: { id: workflowStateIdFor("x"), name: "Done" },
}
/** Your message at the thread: a card at a thread, in its canvas. */
const note = {
  kind: "composing",
  thread: TEST_THREAD,
} as const
const spun = { kind: "trash" } as const
const card = (over: Partial<TextCard> = {}): TextCard => ({
  kind: "text",
  id: C1,
  owner: ADA,
  placer: ADA,
  place: note,
  content: { command: null, unsent: null, origin: null },
  ...over,
})

describe("planSpinOff", () => {
  const plan = (
    over: {
      cards?: CardRecord[]
      text?: string
      roots?: Set<typeof THREAD>
      sender?: typeof ADA
      canvases?: CanvasIndex
    } = {},
  ) =>
    planSpinOff({
      cards: over.cards ?? [card()],
      request: {
        move: { card: C1, from: note, to: spun },
        root: THREAD,
        thread: STARTS,
        canvas: NEW_CANVAS,
        state: null,
        here: TEST_CANVAS,
      },
      sender: over.sender ?? ADA,
      canvases: over.canvases ?? NO_CANVAS_INDEX,
      text: over.text ?? " plan it @agent ",
      roots: over.roots ?? new Set(),
      threads: new Set(),
      opens: { state: null, workflow: SPIN_WORKFLOW },
      now: 5,
    })

  test("the thread opens spun from the card, its first message the card's text, trimmed, naming no agent", () => {
    const planned = plan()
    expect(planned).toMatchObject({
      kind: "spin",
      root: THREAD,
      thread: STARTS,
      text: "plan it @agent",
      mentions: [],
      step: {
        kind: "write",
        record: { ...card(), place: { ...spun, left: card().place } },
      },
    })
    const opened = planned.kind === "spin" ? planned.open : null
    expect(opened?.records.map(r => r.namespace)).toEqual(["pinetrie.thread"])
    expect(opened?.steps[0]).toMatchObject({
      record: { kind: "canvas", id: NEW_CANVAS, place: { kind: "board" } },
    })
    expect(
      opened?.records.find(r => r.namespace === "pinetrie.thread"),
    ).toMatchObject({ value: { origin: { kind: "spun", card: C1 } } })
    expect(opened?.steps.at(-1)).toMatchObject({
      kind: "write",
      record: { id: STARTS, place: { kind: "canvas", canvas: NEW_CANVAS } },
    })
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

describe("planLiftRoot", () => {
  const gone = card({
    place: { ...spun, left: { kind: "inventory", holder: ADA } },
  })
  const thread = (
    writers: SpunThread["writers"],
    known = true,
  ): SpunThread => ({
    thread: STARTS,
    root: THREAD,
    known,
    writers,
  })
  /** The spun thread's card, alone on the canvas the spin-off made. */
  const spunCard = landedThreadCard({
    thread: STARTS,
    canvas: NEW_CANVAS,
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
      spun: [t],
      cards: over.cards ?? [gone, spunCard],
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
      "its thread's card taken into an inventory: refused",
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
      "its thread's card moved since it was made: refused",
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
                  from: { kind: "canvas", canvas: TEST_CANVAS },
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
      "another card on its canvas: refused",
      thread([ADA]),
      {
        cards: [
          gone,
          spunCard,
          {
            kind: "note-column",
            id: cardIdOfKind(
              "note-column",
              "01a0ffd2-0000-7000-8000-0000000000a9",
            ),
            owner: BEA,
            placer: BEA,
            place: { kind: "canvas", canvas: NEW_CANVAS, order: "9", width: 1 },
            content: UNTICKED,
          },
        ],
      },
      { kind: "replied", by: null },
    ],
    [
      "a card pinned to its canvas: refused",
      thread([ADA]),
      {
        cards: [
          gone,
          spunCard,
          card({
            id: cardIdFor("c3"),
            place: { kind: "canvas-pinned", canvas: NEW_CANVAS, order: "a" },
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
            history: "jj",
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
        spun: [],
        cards: [card()],
        lanes: [],
        rootOfThread: new Map(),
        histories: new Map(),
      }),
    ).toEqual({ kind: "lift", delete: [] })
  })
})

test("planRootDelete: the root's records, its canvas's cards and title, its document and stacks", () => {
  const inThread = card({
    id: cardIdFor("c2"),
    place: { ...note, thread: STARTS },
  })
  const onCanvas = landedThreadCard({
    thread: STARTS,
    canvas: TEST_CANVAS,
    by: ADA,
    cards: [],
  })
  const plan = planRootDelete(
    THREAD,
    STARTS,
    TEST_CANVAS,
    [card(), inThread, onCanvas, canvasCard(TEST_CANVAS)],
    new Map([[STARTS, THREAD]]),
  )
  expect(plan.values.map(v => v.namespace)).toEqual([
    "pinetrie.root",
    "pinetrie.thread",
    "pinetrie.mark",
  ])
  expect(plan.cards).toEqual([
    { kind: "remove", id: cardIdFor("c2") },
    { kind: "remove", id: STARTS },
    { kind: "remove", id: TEST_CANVAS },
  ])
  expect(plan.doc).toBe(`root:${THREAD}`)
  expect(plan.histories).toBe(TEST_CANVAS)
})
