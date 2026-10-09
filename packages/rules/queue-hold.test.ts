import {
  atEntry,
  type CardRecord,
  entryId,
  PLAIN,
  rootIdFor,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
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
const L = threadIdFor("1")
const _ROOT_A = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const _ROOT_B = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const TASK_A = taskIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const TASK_B = taskIdFor("01a0ffd2-0000-7000-8000-00000000000b")
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
      id: cardIdFor("c1"),
      owner: ADA,
      placer: ADA,
      place: {
        kind: "queued",
        at: { kind: "entry", id: "e1" },
        thread: L,
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

test("planHoldSweep: a hold whose thread has no card, or whose task is archived, goes; a live one, or one in an inventory, stays", () => {
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
          ? TASK_A
          : lane === L2
            ? TASK_B
            : lane === L4
              ? "inventory"
              : null,
      archived: task => task === TASK_B,
    }),
  ).toEqual([L2, L3])
})

describe("planQueueCard (ADR-0113)", () => {
  const at = atEntry(entryId("e1"))
  const atEnd = { kind: "composing", at, thread: L } as const
  const card: CardRecord = {
    kind: "text",
    id: cardIdFor("c1"),
    owner: ADA,
    placer: ADA,
    place: atEnd,
    carries: PLAIN,
    unsent: null,
  }
  const move = {
    card: card.id,
    from: atEnd,
    to: { kind: "queued", at, thread: L, seen: "" },
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
                at,
                thread: L,
                order: expect.any(String),
                by: BEA,
                seen: "",
              },
              carries: { kind: "message", command: "split" },
              unsent: null,
            },
          },
        ],
      },
      drain: [L],
      holds: [setRecord(QUEUE_HOLD, { lane: L, by: BEA, at: 7 })],
    })
    expect(made(null, true)).toMatchObject({
      step: { steps: [{ record: { carries: PLAIN } }] },
      drain: [],
      holds: [],
    })
  })
  test("a command names only a card made in the queue: one that exists keeps its own", () => {
    const planned = planQueueCard({
      cards: [card],
      holds: new Map(),
      move,
      hold: "keep",
      command: "split",
      by: BEA,
      now: 7,
      running: () => false,
    })
    expect(planned.step).toMatchObject({
      steps: [{ record: { carries: PLAIN } }],
    })
  })
  test("a move the host refuses changes no hold", () => {
    expect(plan("release", { holds: held, cards: [] })).toMatchObject({
      step: { kind: "refused", code: "gone" },
      holds: [],
    })
  })
})
