import {
  type AgentMessageLike,
  type CardId,
  type CardRecord,
  entryId,
  indexAsks,
  type LaneView,
  type TextCard,
  textCardId,
  threadIdFor,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import { cardIdFor, personMessage } from "@pinetrie/core/fixtures"
import type { QueuedText } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { entry, indexEntries } from "./fixtures.ts"
import {
  laneNext,
  type Next,
  type NextFacts,
  nextButtonWords,
  nextWords,
  type QueueHead,
  queuedCardsDrawn,
  queueHead,
  queueHeadPlan,
} from "./next.ts"

const A = threadIdFor("a")
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")

/** A prompt and its reply, stopped or answered; stopped, its stop's fact names `by`. */
const index = (stopped: boolean, by: WriterId | null = null) =>
  indexEntries([
    entry("1", null, personMessage("go")),
    entry("2", "1", {
      role: "assistant",
      content: [{ type: "text", text: "half" }],
      stopReason: stopped ? "aborted" : "stop",
    } as AgentMessageLike),
    ...(by === null
      ? []
      : [
          entry("3", "2", {
            role: "fact",
            content: "■ the run was stopped",
            stopped: { prompt: entryId("1"), by },
          }),
        ]),
  ])

const lane = (over: Partial<LaneView> = {}): LaneView => ({
  name: A,
  tip: entryId("2"),
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
  ...over,
})

const queued = (id: string, order: string): QueuedText => ({
  kind: "text",
  id: textCardId(id),
  owner: ADA,
  placer: ADA,
  place: {
    kind: "queued",
    thread: A,
    order,
    by: ADA,
    seen: "",
  },
  content: { command: null, unsent: null, origin: null },
})
const C1 = cardIdFor("c1")
const C2 = cardIdFor("c2")
const two = [queued(cardIdFor("c1"), "a"), queued(cardIdFor("c2"), "b")]

const facts = (
  over: {
    stopped?: boolean
    cards?: readonly CardRecord[]
    typing?: readonly CardId[]
    blank?: readonly string[]
    stoppedBy?: WriterId
  } = {},
): NextFacts => {
  const i = index(over.stopped ?? false, over.stoppedBy ?? null)
  return {
    cards: over.cards ?? [],
    typing: new Set(over.typing ?? []),
    blank: new Set((over.blank ?? []).map(textCardId)),
    index: i,
    asks: indexAsks(i),
  }
}

describe("laneNext: what the thread does next, as the host decides it", () => {
  test.each<[string, Partial<LaneView>, Parameters<typeof facts>[0], Next]>([
    [
      "running",
      { running: true, waiting: 2 },
      { cards: two },
      { kind: "running" },
    ],
    [
      "held with cards: the top card goes first when sent",
      { waiting: 2, heldBy: BEA },
      { cards: two },
      { kind: "held", by: BEA, top: C1, count: 2, resumable: false },
    ],
    [
      "held and stopped: resumable too",
      { waiting: 2, heldBy: BEA },
      { cards: two, stopped: true },
      { kind: "held", by: BEA, top: C1, count: 2, resumable: true },
    ],
    [
      "held with only a blank card: nothing to send",
      { waiting: 1, heldBy: BEA },
      {
        cards: [queued(cardIdFor("c1"), "a")],
        blank: [cardIdFor("c1")],
      },
      { kind: "held", by: BEA, top: null, count: 0, resumable: false },
    ],
    [
      "stopped, nothing queued: who stopped it",
      {},
      { stopped: true, stoppedBy: BEA },
      { kind: "stopped", by: BEA },
    ],
    ["answered, nothing queued", {}, {}, { kind: "idle" }],
    [
      "a card due: sending",
      { waiting: 2 },
      { cards: two },
      { kind: "sending", top: C1, typing: false },
    ],
    [
      "a top card someone types in waits for them, as the drain does",
      { waiting: 2 },
      { cards: two, typing: [C1] },
      { kind: "sending", top: C1, typing: true },
    ],
    [
      "a blank top card is passed over, as the drain passes it",
      { waiting: 2 },
      { cards: two, blank: [cardIdFor("c1")] },
      { kind: "sending", top: C2, typing: false },
    ],
  ])("%s", (_, over, f, next) => {
    expect(laneNext(lane(over), facts(f))).toEqual(next)
  })
})

describe("queueHeadPlan: one button, the rest in ⋯", () => {
  const head = (next: Next, heldBy = null as typeof BEA | null, messages = 0) =>
    queueHeadPlan({ lane: A, next, heldBy, messages })
  test.each([
    [
      "running: stop, ▸ on the run",
      head({ kind: "running" }, null, 1),
      { button: "stop", items: ["hold", "unqueue-all"], mark: { kind: "run" } },
    ],
    [
      "held with cards: send queue, resume in ⋯, ▸ on the top card",
      head(
        { kind: "held", by: BEA, top: C1, count: 2, resumable: true },
        BEA,
        2,
      ),
      {
        button: "send-queue",
        items: ["resume", "unqueue-all"],
        mark: { kind: "card", card: C1 },
      },
    ],
    [
      "held and empty, stopped: resume, and release in ⋯",
      head(
        { kind: "held", by: BEA, top: null, count: 0, resumable: true },
        BEA,
      ),
      { button: "resume", items: ["release"], mark: { kind: "none" } },
    ],
    [
      "stopped: resume, ▸ on your message",
      head({ kind: "stopped", by: BEA }),
      { button: "resume", items: ["hold"], mark: { kind: "message" } },
    ],
    [
      "idle: no button, ▸ on your message",
      head({ kind: "idle" }),
      { button: null, items: ["hold"], mark: { kind: "message" } },
    ],
    [
      "sending: no button, ▸ on the card",
      head({ kind: "sending", top: C2, typing: false }, null, 1),
      {
        button: null,
        items: ["hold", "unqueue-all"],
        mark: { kind: "card", card: C2 },
      },
    ],
  ] as const)("%s", (_, plan, expected) => {
    expect(plan).toEqual(expected)
  })
})

test("queueHead counts the message cards unqueue all takes back", () => {
  const head: QueueHead = queueHead(lane({ waiting: 2 }), facts({ cards: two }))
  expect(head).toMatchObject({ lane: A, heldBy: null, messages: 2 })
})

test("words: who holds or stopped it, and send queue (n)", () => {
  const reader = { me: ADA, nameOf: new Map([[BEA, "Bea"]]) }
  expect(nextWords({ kind: "running" }, reader)).toBe("◉ running")
  expect(
    nextWords(
      { kind: "held", by: BEA, top: C1, count: 2, resumable: false },
      reader,
    ),
  ).toBe("held by Bea")
  expect(nextWords({ kind: "stopped", by: ADA }, reader)).toBe("stopped by you")
  expect(nextWords({ kind: "idle" }, reader)).toBe("waiting for you")
  const held: QueueHead = {
    lane: A,
    next: { kind: "held", by: BEA, top: C1, count: 3, resumable: false },
    heldBy: BEA,
    messages: 3,
  }
  expect(nextButtonWords("send-queue", held).label).toBe("send queue (3)")
  expect(nextButtonWords("stop", held).className).toBe("stop")
})

describe("queuedCardsDrawn: the dock leaves out a command card going now", () => {
  const getLatest: QueuedText = {
    ...queued(cardIdFor("c1"), "a"),
    content: { command: "get-latest", unsent: null, origin: null },
  }
  const message = queued(cardIdFor("c2"), "b")
  const ids = (next: Next | null, cards = [getLatest, message]) =>
    queuedCardsDrawn(cards, next).map(c => c.id)
  test("a command card going now is not drawn", () => {
    expect(ids({ kind: "sending", top: C1, typing: false })).toEqual([C2])
  })
  test("a command card someone types in is drawn", () => {
    expect(ids({ kind: "sending", top: C1, typing: true })).toEqual([C1, C2])
  })
  test("a command card behind a hold is drawn", () => {
    expect(
      ids({ kind: "held", by: BEA, top: C1, count: 1, resumable: false }),
    ).toEqual([C1, C2])
  })
  test("a message card going now is drawn", () => {
    expect(
      ids({ kind: "sending", top: C2, typing: false }, [message, getLatest]),
    ).toEqual([C2, C1])
  })
})
