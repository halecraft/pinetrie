import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  type LaneRecord,
  laneNameForThread,
  rootIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { planRootDelete } from "./root.ts"
import { planLiftRoot, planSpinOff, type SpunThread } from "./spin-off.ts"

const ROOT_A = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const THREAD = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const C1 = cardId("c-1")
const note = {
  kind: "note",
  root: ROOT_A,
  at: atEntry(entryId("e1")),
  lane: null,
  cell: 0,
} as const
const spun = {
  kind: "gone",
  root: ROOT_A,
  why: { kind: "spun", thread: THREAD },
} as const
const card = (over: Partial<CardRecord> = {}): CardRecord => ({
  id: C1,
  owner: ADA,
  placer: ADA,
  place: note,
  carries: { kind: "message", command: null },
  unsent: null,
  ...over,
})

describe("planSpinOff (ADR-0111)", () => {
  const plan = (
    over: {
      cards?: CardRecord[]
      text?: string
      roots?: Set<typeof THREAD>
      sender?: typeof ADA
    } = {},
  ) =>
    planSpinOff({
      cards: over.cards ?? [card()],
      request: { move: { card: C1, from: note, to: spun }, state: null },
      sender: over.sender ?? ADA,
      text: over.text ?? " plan it @agent ",
      roots: over.roots ?? new Set(),
    })

  test("the thread's first message is the card's text, trimmed, naming no agent; the card goes gone, spun into it", () => {
    expect(plan()).toEqual({
      kind: "spin",
      thread: THREAD,
      text: "plan it @agent",
      mentions: [],
      step: {
        kind: "write",
        record: { ...card(), place: { ...spun, by: ADA } },
      },
    })
  })

  test.each([
    ["a blank card", { text: " \n" }, { kind: "blank" }],
    ["a root id in use", { roots: new Set([THREAD]) }, { kind: "root-in-use" }],
    [
      "a card someone moved first",
      { cards: [card({ place: { ...note, cell: 3 } })] },
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
  const gone = card({ place: { ...spun, by: ADA } })
  const thread = (
    writers: SpunThread["writers"],
    known = true,
  ): SpunThread => ({
    thread: THREAD,
    known,
    writers,
  })
  const lift = (
    t: SpunThread,
    over: { cards?: CardRecord[]; lanes?: LaneRecord[] } = {},
  ) =>
    planLiftRoot({
      lifting: [C1],
      cards: over.cards ?? [gone],
      threads: new Map([[THREAD, t]]),
      lanes: over.lanes ?? [],
    })

  test.each([
    [
      "its first message alone: lifted, and deleted",
      thread([ADA]),
      {},
      {
        kind: "lift",
        delete: [THREAD],
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
          card({
            id: cardId("c-2"),
            place: { ...note, root: THREAD },
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
            lane: laneNameForThread("x"),
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
      }),
    ).toEqual({ kind: "lift", delete: [] })
  })
})

test("planRootDelete: its directory record and board place, the cards in it, its document and its stacks", () => {
  const inThread = card({ id: cardId("c-2"), place: { ...note, root: THREAD } })
  const plan = planRootDelete(THREAD, [card(), inThread])
  expect(plan.values.map(v => v.kind)).toEqual(["delete", "delete"])
  expect(plan.cards).toEqual([{ kind: "remove", id: cardId("c-2") }])
  expect(plan.doc).toBe(`root:${THREAD}`)
  expect(plan.histories).toBe(THREAD)
})
