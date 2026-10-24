import {
  canvasIdFor,
  entryId,
  rootIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  type AgentMessageLike,
  type CardRecord,
  cardIdOfKind,
  type EntryLike,
  indexTree,
  makeCard,
  type PlaceOf,
  type Reach,
  type RelayDetails,
  type ThreadLane,
} from "@pinetrie/threads"
import { FIXTURE_THREAD, personMessage } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import { indexCanvases } from "./canvas-index.ts"
import { DIGEST_EVERY } from "./digest.ts"
import { setRecord } from "./records.ts"
import { RUN_END_REPORT } from "./run-end-report.ts"
import {
  canvasContextCards,
  planCanvasContext,
  planHeldAnswer,
  planLiveDigest,
  planPendingRunEndReport,
  planPinnedContext,
  planQueuedPop,
  planRelayAnswer,
  planRelayDelivery,
  planRoundAsk,
  planRoundNext,
  planRunEndReport,
} from "./told.ts"

const ADA = writerId("ada@x.io")
const HERE = FIXTURE_THREAD
const FOX = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f0")
const OWL = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const OPEN: Reach = { kind: "open", canvas: canvasIdFor("t") }
const ARCHIVED: Reach = {
  kind: "archived",
  canvas: canvasIdFor("t"),
  record: { canvas: canvasIdFor("t"), by: ADA, at: 1 },
}
const at = (
  id: string,
  parentId: string | null,
  message: AgentMessageLike,
): EntryLike => ({
  id: entryId(id),
  parentId: parentId === null ? null : entryId(parentId),
  thread: HERE,
  type: "message",
  message,
})
const tree = (...entries: EntryLike[]) =>
  indexTree(Object.fromEntries(entries.map(e => [e.id, e])))
// A short ask, then a long one: p-1, its work w-1 and w-2, its last word w-3.
const index = tree(
  at("p-0", null, personMessage("first", { author: "Ada" })),
  at("w-0", "p-0", { role: "assistant", content: "did first" }),
  at("p-1", "w-0", personMessage("second", { author: "Bea" })),
  at("w-1", "p-1", { role: "assistant", content: "reading" }),
  at("w-2", "w-1", { role: "assistant", content: "editing" }),
  at("w-3", "w-2", { role: "assistant", content: "did second" }),
)
const RELAY: RelayDetails = {
  from: FOX,
  fromName: "amber-fox",
  source: entryId("s-1"),
  asker: { kind: "agent", thread: FOX },
  askerName: "amber-fox",
  text: "what next?",
  allowance: entryId("s-1"),
  by: ADA,
}

describe("planRelayDelivery", () => {
  const lane = (over: Partial<Extract<ThreadLane, { kind: "lane" }>> = {}) =>
    ({
      kind: "lane",
      name: OWL,
      tip: entryId("t"),
      running: false,
      waiting: 0,
      askedBy: null,
      lastWaiting: null,
      heldBy: null,
      ...over,
    }) as const
  // The asking thread invited OWL.
  const asking = {
    index: tree(at("i", null, personMessage("hi", { invites: [OWL] }))),
    end: entryId("i"),
    lane: { kind: "none" } as const,
  }
  const deliver = (
    asked: ThreadLane,
    runnable: Parameters<typeof planRelayDelivery>[0]["runnable"] = OWL,
  ) =>
    planRelayDelivery({
      from: HERE,
      fromName: "sable-meadow",
      fromReach: OPEN,
      to: OWL,
      toName: "quiet-owl",
      toReach: OPEN,
      asking,
      asked: { index: tree(), end: null, lane: asked },
      runnable,
      relay: {
        source: entryId("i"),
        asker: { kind: "agent", thread: HERE },
        askerName: "sable-meadow",
        text: "what next?",
        allowance: entryId("i"),
        by: ADA,
      },
      spent: false,
      cards: [],
      askCard: cardIdOfKind("ask", "01a0ffd2-0000-7000-8000-0000000000a1"),
    })

  test("an idle asked lane runs the relay; a busy one queues its ask card, held when its queue is", () => {
    expect(deliver(lane())).toMatchObject({ kind: "run", lane: OWL })
    const queued = deliver(lane({ running: true }))
    expect(queued).toMatchObject({ kind: "queue", held: false })
    if (queued.kind !== "queue") throw new Error("queued")
    expect(queued.card).not.toBeNull()
    expect(deliver(lane({ running: true, heldBy: ADA }))).toMatchObject({
      kind: "queue",
      held: true,
    })
  })

  test("a lane of another kind is refused, and nothing runs there", () => {
    expect(
      deliver(lane(), { kind: "folder", lane: OWL } as never),
    ).toMatchObject({ kind: "refused", why: { kind: "foreign" } })
  })
})

describe("planRelayAnswer", () => {
  const answer = (over: Partial<Parameters<typeof planRelayAnswer>[0]> = {}) =>
    planRelayAnswer({
      relay: RELAY,
      prompt: entryId("p-1"),
      thread: HERE,
      name: "sable-meadow",
      index,
      spent: false,
      fromReach: OPEN,
      fromName: "amber-fox",
      ...over,
    })

  test("a run's last word is its answer, which wakes an agent that asked", () => {
    expect(answer()).toMatchObject({
      kind: "answer",
      answer: { text: "did second", wakes: true, from: HERE },
    })
  })

  test("a run that wrote no word leaves the asker a fact that it went unanswered", () => {
    expect(
      answer({ index: tree(at("p-1", null, personMessage("ask"))) }),
    ).toEqual({
      kind: "facts",
      facts: [
        {
          kind: "unanswered",
          lane: FOX,
          member: HERE,
          why: "failed",
          by: ADA,
        },
      ],
    })
  })

  test("an asker gone out of reach gets nothing; the answering thread is told", () => {
    expect(answer({ fromReach: ARCHIVED })).toEqual({
      kind: "facts",
      facts: [
        {
          kind: "undelivered",
          lane: HERE,
          to: FOX,
          toName: "amber-fox",
          why: ARCHIVED,
          by: ADA,
        },
      ],
    })
  })
})

describe("planHeldAnswer", () => {
  test("a held answer is appended while its asker is in reach; otherwise its answerer is told", () => {
    const held = { lane: HERE, relay: RELAY, askerName: "amber-fox" }
    expect(planHeldAnswer({ ...held, askerReach: OPEN })).toEqual({
      kind: "append",
    })
    expect(planHeldAnswer({ ...held, askerReach: ARCHIVED })).toMatchObject({
      kind: "facts",
      facts: [{ kind: "undelivered", lane: HERE, to: FOX }],
    })
  })
})

describe("the round", () => {
  const answered = (id: string, parent: string, from: typeof FOX) =>
    at(id, parent, {
      role: "answer",
      content: "ok",
      answer: {
        from,
        fromName: "x",
        relay: entryId("r"),
        source: entryId("a"),
        text: "ok",
        wakes: false,
        allowance: entryId("a"),
        by: ADA,
      },
    })
  const asking = (asks: readonly (typeof FOX)[]) => {
    const entries = [
      at("a", null, personMessage("both?", { asks, invites: [FOX, OWL] })),
      ...asks.map((t, i) =>
        answered(`x-${i}`, i === 0 ? "a" : `x-${i - 1}`, t),
      ),
    ]
    return {
      index: tree(...entries),
      end: entries.at(-1)?.id ?? null,
    }
  }
  const round = (over: Partial<Parameters<typeof planRoundAsk>[0]> = {}) =>
    planRoundAsk({
      relay: { ...RELAY, source: entryId("a"), from: HERE },
      asking: asking([FOX, OWL]),
      reach: OPEN,
      spent: false,
      names: new Map([[FOX, "amber-fox"]]) as never,
      ...over,
    })

  test("once every member a message asked has answered, the round asks about them by name", () => {
    const ask = round()
    expect(ask?.members).toEqual(
      new Map([
        ["amber-fox", FOX],
        [OWL.slice(-8), OWL],
      ]),
    )
  })

  test("no round for one member asked, a spent budget, or a thread out of reach", () => {
    expect(round({ asking: asking([FOX]) })).toBeNull()
    expect(round({ spent: true })).toBeNull()
    expect(round({ reach: ARCHIVED })).toBeNull()
  })

  test("a reply for the people is a line in the asking thread; one that asks names a member", () => {
    const ask = round()
    if (ask === null) throw new Error("a round")
    const relay = { ...RELAY, from: HERE }
    expect(
      planRoundNext({ reply: "people: decide", round: ask, relay }),
    ).toEqual({
      kind: "facts",
      facts: [{ kind: "round", lane: HERE, line: "decide", by: ADA }],
    })
    expect(
      planRoundNext({ reply: "ask amber-fox: and?", round: ask, relay }),
    ).toEqual({ kind: "ask", thread: FOX, text: "and?" })
  })
})

describe("planLiveDigest", () => {
  test("a turn's ask is digested while someone reads the thread, and not otherwise", () => {
    const live = (reading: readonly ReturnType<typeof entryId>[]) =>
      planLiveDigest({
        index,
        at: entryId("w-2"),
        digests: new Map(),
        asking: new Set(),
        reading,
        now: DIGEST_EVERY,
      })
    expect(live([entryId("w-2")])?.ask).toBe(entryId("p-1"))
    expect(live([])).toBeNull()
  })
})

describe("a run's end report", () => {
  const LANE = HERE
  test("a run's end is its ask's newest entry, and its report is written only while the stored one is its own", () => {
    const report = (stored: ReturnType<typeof entryId>, ran: typeof index) =>
      planRunEndReport({
        lane: LANE,
        prompt: entryId("p-1"),
        index: ran,
        digests: new Map(),
        report: {
          lane: LANE,
          ask: stored,
          end: stored,
          report: { kind: "pending" },
        },
        cards: [],
        enabled: false,
        now: 0,
      })
    expect(report(entryId("p-1"), index).end).toBe(entryId("w-3"))
    // A run that wrote nothing failed: its report is the facts', written now.
    const failed = tree(at("p-1", null, personMessage("ask")))
    expect(report(entryId("p-1"), failed).writes).toHaveLength(1)
    expect(report(entryId("p-0"), failed).writes).toEqual([])
  })

  test("a stopping run's pending report names its ask's newest entry", () => {
    expect(
      planPendingRunEndReport({ lane: LANE, prompt: entryId("p-1"), index }),
    ).toEqual(
      setRecord(RUN_END_REPORT, {
        lane: LANE,
        ask: entryId("p-1"),
        end: entryId("w-3"),
        report: { kind: "pending" },
      }),
    )
  })
})

describe("planQueuedPop", () => {
  const LANE = threadIdFor("01a0ffd2-0000-7000-8000-0000000000c1")
  const queued = (n: number): CardRecord =>
    makeCard(
      "text",
      cardIdOfKind("text", `01a0ffd2-0000-7000-8000-00000000000${n}`),
      { kind: "queued", thread: LANE, order: `a${n}`, by: ADA, seen: "v" },
      { unsent: null, origin: null, command: null },
      ADA,
    )
  const pop = (
    cards: readonly CardRecord[],
    texts: ReadonlyMap<string, { text: string; current: boolean }>,
  ) =>
    planQueuedPop({
      cards,
      lane: LANE,
      running: false,
      away: false,
      held: false,
      typing: new Set(),
      isStartHeld: false,
      texts: texts as never,
      quotes: new Map(),
    })

  test("a queued card is popped with its text, and its record removed", () => {
    const card = queued(1)
    expect(
      pop([card], new Map([[card.id, { text: "do it", current: true }]])),
    ).toEqual({
      kind: "pop",
      card,
      text: "do it",
      step: { kind: "remove", id: card.id },
    })
  })

  test("a card whose text is not yet its queuer's stays, behind, and is not passed over as blank", () => {
    const card = queued(1)
    expect(
      pop([card], new Map([[card.id, { text: "", current: false }]])),
    ).toEqual({ kind: "behind", card })
  })

  test("a blank card is passed over for the one after it", () => {
    const [blank, next] = [queued(1), queued(2)]
    expect(
      pop(
        [blank, next],
        new Map([
          [blank.id, { text: "  ", current: true }],
          [next.id, { text: "then this", current: true }],
        ]),
      ),
    ).toMatchObject({ kind: "pop", card: next, text: "then this" })
  })
})

describe("what a run reads of its pinned cards and its canvas", () => {
  const pinned = (place: PlaceOf<"text">) =>
    makeCard(
      "text",
      cardIdOfKind("text", "01a0ffd2-0000-7000-8000-0000000000d1"),
      place,
      { unsent: null, origin: null, command: null },
      ADA,
    )

  test("a thread's pinned cards are read with the texts loaded for them", () => {
    const card = pinned({ kind: "pinned", thread: HERE, order: "a" })
    const read = (text: string) =>
      planPinnedContext({
        lane: HERE,
        index,
        tip: entryId("w-3"),
        cards: [card],
        texts: new Map([[card.id, text]]),
      })
    expect(read("keep it short")?.cards).toEqual([
      expect.objectContaining({ id: card.id, text: "keep it short" }),
    ])
    expect(read("  ")).toBeNull()
  })

  test("a canvas's pinned cards are read with the texts loaded for them, and an untitled canvas by its first root's first line", () => {
    const canvas = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000d2")
    const card = pinned({ kind: "canvas-pinned", canvas, order: "a" })
    const root = rootIdFor("01a0ffd2-0000-7000-8000-0000000000d3")
    const canvases = indexCanvases([card], new Map())
    const read = planCanvasContext({
      lane: HERE,
      canvas,
      index,
      tip: entryId("w-3"),
      cards: [card],
      canvases: { ...canvases, rootsOf: new Map([[canvas, [root]]]) },
      titles: new Map(),
      firstLines: new Map([[root, { firstLine: "fix the rail" }]]),
      names: new Map(),
      running: [],
      cardTitles: new Map(),
      texts: new Map([[card.id, "mind the rail"]]),
      nameOf: () => "Ada",
    })
    expect(read.listed?.title).toBe("fix the rail")
    expect(read.pinned?.cards).toEqual([
      expect.objectContaining({ id: card.id, text: "mind the rail" }),
    ])
    expect(canvasContextCards([card], canvas)).toEqual([card.id])
  })
})
