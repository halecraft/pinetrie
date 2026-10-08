import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  laneNameForThread,
  PLAIN,
  rootIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import type { QueuedCard } from "./card.ts"
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
const L = laneNameForThread("1")
const ROOT_A = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const ROOT_B = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
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
  const card = (kind: "message" | "fact"): QueuedCard =>
    ({
      id: "c-1",
      owner: ADA,
      placer: ADA,
      place: {
        kind: "queued",
        root: ROOT_A,
        at: { kind: "entry", id: "e1" },
        lane: L,
        order: "a",
        by: ADA,
        seen: "",
      },
      carries:
        kind === "message"
          ? { kind: "message", command: null }
          : {
              kind: "fact",
              fact: { kind: "described", lane: L, by: ADA },
            },
      unsent: null,
    }) as QueuedCard
  const base = { holds: new Map(), lane: L, by: BEA, now: 3 }
  test("a message card queued: the stopper holds the queue", () => {
    expect(holdOnStop({ ...base, queue: [card("message")] })).toEqual({
      lane: L,
      by: BEA,
      at: 3,
    })
  })
  test("nothing queued, only facts, or already held: no hold", () => {
    expect(holdOnStop({ ...base, queue: [] })).toBeNull()
    expect(holdOnStop({ ...base, queue: [card("fact")] })).toBeNull()
    expect(
      holdOnStop({ ...base, holds: held, queue: [card("message")] }),
    ).toBeNull()
  })
})

test("planHoldSweep: a hold whose lane no root holds, or whose root is archived, goes; a live one stays", () => {
  const L2 = laneNameForThread("2")
  const L3 = laneNameForThread("3")
  const holds = new Map([
    [L, { lane: L, by: ADA, at: 1 }],
    [L2, { lane: L2, by: ADA, at: 1 }],
    [L3, { lane: L3, by: ADA, at: 1 }],
  ])
  expect(
    planHoldSweep({
      holds,
      rootOf: lane => (lane === L ? ROOT_A : lane === L2 ? ROOT_B : null),
      archived: root => root === ROOT_B,
    }),
  ).toEqual([L2, L3])
})

describe("planQueueCard (ADR-0113)", () => {
  const at = atEntry(entryId("e1"))
  const atEnd = { kind: "composing", root: ROOT_A, at, lane: L } as const
  const card: CardRecord = {
    id: cardId("c-1"),
    owner: ADA,
    placer: ADA,
    place: atEnd,
    carries: PLAIN,
    unsent: null,
  }
  const move = {
    card: card.id,
    from: atEnd,
    to: { kind: "queued", root: ROOT_A, at, lane: L, seen: "" },
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
  test("a move the host refuses changes no hold", () => {
    expect(plan("release", { holds: held, cards: [] })).toMatchObject({
      step: { kind: "refused", code: "gone" },
      holds: [],
    })
  })
})
