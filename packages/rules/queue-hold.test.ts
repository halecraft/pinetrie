import {
  atEntry,
  canvasIdFor,
  entryId,
  rootIdFor,
  type Sha256,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { type CardRecord, cardIdOfKind } from "@pinetrie/threads"
import { cardIdFor } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import { planUnqueueAll, type QueuedCard } from "./queue.ts"
import {
  holdOnStop,
  planHoldSweep,
  planQueueCard,
  planQueueHold,
  QUEUE_HOLD,
} from "./queue-hold.ts"
import { deleteRecord, setRecord } from "./records.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const L = threadIdFor("1")
const _ROOT_A = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const _ROOT_B = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const CANVAS_A = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const CANVAS_B = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const held = new Map([[L, { lane: L, by: ADA, at: 1 }]])

describe("planQueueHold", () => {
  test("a hold is written where there is none; the first holder stays named", () => {
    expect(
      planQueueHold({ holds: new Map(), lane: L, by: BEA, now: 5, held: true }),
    ).toEqual([setRecord(QUEUE_HOLD, { lane: L, by: BEA, at: 5 })])
    expect(
      planQueueHold({ holds: held, lane: L, by: BEA, now: 5, held: true }),
    ).toEqual([])
  })
  test("a release deletes it; nothing to release writes nothing", () => {
    expect(
      planQueueHold({ holds: held, lane: L, by: BEA, now: 5, held: false }),
    ).toEqual([deleteRecord(QUEUE_HOLD, L)])
    expect(
      planQueueHold({
        holds: new Map(),
        lane: L,
        by: BEA,
        now: 5,
        held: false,
      }),
    ).toEqual([])
  })
})

describe("holdOnStop", () => {
  const place = {
    kind: "queued",
    thread: L,
    order: "a",
    by: ADA,
    seen: "",
  } as const
  const card = (kind: "message" | "fact"): QueuedCard =>
    kind === "message"
      ? {
          kind: "text",
          id: cardIdFor("c1"),
          owner: ADA,
          placer: ADA,
          place,
          content: { command: null, unsent: null, origin: null },
        }
      : {
          kind: "fact",
          id: cardIdOfKind("fact", "01a0ffd2-0000-7000-8000-0000000000f1"),
          owner: ADA,
          placer: ADA,
          place,
          content: { fact: { kind: "described", lane: L, by: ADA } },
        }
  const base = { holds: new Map(), lane: L, by: BEA, now: 3 }
  test("a message card queued: the stopper holds the queue", () => {
    expect(holdOnStop({ ...base, queue: [card("message")] })).toEqual({
      lane: L,
      by: BEA,
      at: 3,
    })
  })
  test("a reference queued is a message too: the stopper holds the queue", () => {
    const reference: QueuedCard = {
      kind: "reference",
      id: cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e1"),
      owner: ADA,
      placer: ADA,
      place,
      content: {
        address: { kind: "thread", thread: L },
        quote: "0".repeat(64) as Sha256,
      },
    }
    expect(holdOnStop({ ...base, queue: [reference] })).toEqual({
      lane: L,
      by: BEA,
      at: 3,
    })
    expect(planUnqueueAll([reference], L)).toEqual([
      {
        card: reference.id,
        from: { kind: "queued", thread: L, seen: "" },
        to: { kind: "notes", near: "thread", thread: L },
      },
    ])
  })
  test("nothing queued, only facts, or already held: no hold", () => {
    expect(holdOnStop({ ...base, queue: [] })).toBeNull()
    expect(holdOnStop({ ...base, queue: [card("fact")] })).toBeNull()
    expect(
      holdOnStop({ ...base, holds: held, queue: [card("message")] }),
    ).toBeNull()
  })
})

test("planHoldSweep: a hold whose thread has no card, or whose canvas is archived, goes", () => {
  const L2 = threadIdFor("2")
  const L3 = threadIdFor("3")
  const L4 = threadIdFor("4")
  const holds = new Map([
    [L4, { lane: L4, by: ADA, at: 1 }],
    [L, { lane: L, by: ADA, at: 1 }],
    [L2, { lane: L2, by: ADA, at: 1 }],
    [L3, { lane: L3, by: ADA, at: 1 }],
  ])
  expect(
    planHoldSweep({
      holds,
      whereIs: lane =>
        lane === L
          ? CANVAS_A
          : lane === L2
            ? CANVAS_B
            : lane === L4
              ? "inventory"
              : null,
      archived: canvas => canvas === CANVAS_B,
    }),
  ).toEqual([L2, L3])
})

describe("planQueueCard", () => {
  const _at = atEntry(entryId("e1"))
  const atEnd = { kind: "composing", thread: L } as const
  const card: CardRecord = {
    kind: "text",
    id: cardIdFor("c1"),
    owner: ADA,
    placer: ADA,
    place: atEnd,
    content: { command: null, unsent: null, origin: null },
  }
  const move = {
    card: card.id,
    from: atEnd,
    to: { kind: "queued", thread: L, seen: "" },
  } as const
  const plan = (
    hold: "keep" | "hold-if-idle" | "release",
    over: { holds?: typeof held; running?: boolean; cards?: CardRecord[] } = {},
  ) =>
    planQueueCard({
      cards: over.cards ?? [card],
      holds: over.holds ?? new Map(),
      move,
      hold,
      command: null,
      by: BEA,
      now: 7,
      running: () => over.running ?? false,
    })
  test.each([
    ["keep, held: the hold stays", "keep", { holds: held }, []],
    [
      "hold-if-idle, idle: held first, by the sender",
      "hold-if-idle",
      {},
      [setRecord(QUEUE_HOLD, { lane: L, by: BEA, at: 7 })],
    ],
    [
      "hold-if-idle, running: the run's end pops it after the others",
      "hold-if-idle",
      { running: true },
      [],
    ],
    [
      "release, held: released",
      "release",
      { holds: held },
      [deleteRecord(QUEUE_HOLD, L)],
    ],
    ["release, not held: nothing to release", "release", {}, []],
  ] as const)("%s", (_, hold, over, holds) => {
    const planned = plan(hold, over)
    expect(planned.step.kind).toBe("steps")
    expect(planned.holds).toEqual(holds)
    expect(planned.drain).toEqual("running" in over ? [] : [L])
  })
  test("a card made in the queue carries its command from its first write, and hold-if-idle holds an idle queue first", () => {
    const made = (command: "split" | null, running: boolean) =>
      planQueueCard({
        cards: [],
        holds: new Map(),
        move: { ...move, from: null },
        hold: "hold-if-idle",
        command,
        by: BEA,
        now: 7,
        running: () => running,
      })
    expect(made("split", false)).toEqual({
      step: {
        kind: "steps",
        steps: [
          {
            kind: "write",
            record: {
              kind: "text",
              id: card.id,
              owner: BEA,
              placer: BEA,
              place: {
                kind: "queued",
                thread: L,
                order: expect.any(String),
                by: BEA,
                seen: "",
              },
              content: { command: "split", unsent: null, origin: null },
            },
          },
        ],
      },
      drain: [L],
      holds: [setRecord(QUEUE_HOLD, { lane: L, by: BEA, at: 7 })],
    })
    expect(made(null, true)).toMatchObject({
      step: { steps: [{ record: { content: { command: null } } }] },
      drain: [],
      holds: [],
    })
  })
  test("a card that exists, queued with a command, carries it in the move's own write; queued with none, it keeps its own", () => {
    const queued = (command: "get-latest" | null) =>
      planQueueCard({
        cards: [card],
        holds: new Map(),
        move,
        hold: "keep",
        command,
        by: BEA,
        now: 7,
        running: () => false,
      }).step
    expect(queued("get-latest")).toMatchObject({
      steps: [{ record: { content: { command: "get-latest" } } }],
    })
    expect(queued(null)).toMatchObject({
      steps: [{ record: { content: { command: null } } }],
    })
  })
  test("a move the host refuses changes no hold", () => {
    expect(plan("release", { holds: held, cards: [] })).toMatchObject({
      step: { kind: "refused", code: "gone" },
      holds: [],
    })
  })
})
