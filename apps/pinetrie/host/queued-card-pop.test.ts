import {
  atEntry,
  type CardCommand,
  type CardId,
  commitId,
  ERR,
  entryId,
  isTextCard,
  rootIdFor,
  runId,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import type { ThreadLaneHandle } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import { readCardHistories, readPlaces, readPlacesRev } from "@pinetrie/reads"
import {
  CARD_HISTORY,
  decodeFact,
  deleteRecord,
  encodeCard,
  planStack,
  QUEUE_HOLD,
  setRecord,
} from "@pinetrie/rules"
import { newPlacesDoc, newPresenceDoc, seatKey } from "@pinetrie/schema"
import { beginRun } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import type { CardPort } from "./cards.ts"
import {
  applyWrites,
  basics,
  putTask,
  putValue,
  ROOT_ID,
  record,
} from "./fakes.ts"
import { createProvenance } from "./provenance.ts"
import {
  chatOfPoppedQueuedCard,
  createWaits,
  drain,
  givenUp,
  type NextQueuedCardPop,
  type PoppedQueuedCard,
  popNextQueuedCard,
  type QueuedCardPopDeps,
  untilNotTyped,
} from "./queued-card-pop.ts"

const _TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const LANE = threadIdFor("0123456789abcdef")
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const E1 = entryId("e-1")

const queue = (
  cards: ReturnType<typeof newPlacesDoc>,
  id: string,
  order: string,
  command: CardCommand | null = null,
) =>
  cards.cards.set(
    id,
    encodeCard({
      kind: "text" as const,
      id: textCardId(id),
      owner: ADA,
      placer: ADA,
      place: {
        kind: "queued",
        at: atEntry(E1),
        thread: LANE,
        order,
        by: BEA,
        seen: "",
      },
      carries: { kind: "message", command },
      unsent: null,
    }),
  )

/** Texts as the host holds them, all whole unless named in `behind`. */
const held = (
  textOf: (id: CardId) => string,
  behind: readonly string[] = [],
): Pick<CardPort, "textNow" | "holds"> => ({
  textNow: textOf,
  holds: id => !behind.includes(id),
})
/** An idle lane, its queue not held, nobody typing. */
const IDLE = { running: false, held: false, typing: new Set<CardId>() }
const poppedOf = (top: NextQueuedCardPop): PoppedQueuedCard | null =>
  top.kind === "popped" ? top.popped : null

describe("popNextQueuedCard", () => {
  test("reads the top queued card and deletes its record before it returns", () => {
    const cards = newPlacesDoc()
    queue(cards, "c0000000-0000-7000-8000-000000000002", "b")
    queue(cards, "c0000000-0000-7000-8000-000000000001", "a")
    const popped = poppedOf(
      popNextQueuedCard(
        cards,
        LANE,
        IDLE,
        held(id => `text of ${id}`),
      ),
    )
    expect(popped?.card.id).toBe("c0000000-0000-7000-8000-000000000001")
    expect(popped?.text).toBe("text of c0000000-0000-7000-8000-000000000001")
    expect(readPlaces(cards).map(c => c.id)).toEqual([
      "c0000000-0000-7000-8000-000000000002",
    ])
  })

  test("its removal raises the places document's rev, so a client whose unqueue it beat settles (ADR-0059)", () => {
    const cards = newPlacesDoc()
    queue(cards, "c0000000-0000-7000-8000-000000000001", "a")
    popNextQueuedCard(
      cards,
      LANE,
      IDLE,
      held(() => "x"),
    )
    expect(readPlacesRev(cards)).toBe(1)
  })

  test("pops nothing while the lane runs, or when nothing is queued", () => {
    const cards = newPlacesDoc()
    queue(cards, "c0000000-0000-7000-8000-000000000001", "a")
    expect(
      popNextQueuedCard(
        cards,
        LANE,
        { ...IDLE, running: true },
        held(() => "x"),
      ),
    ).toEqual({
      kind: "idle",
    })
    expect(readPlaces(cards)).toHaveLength(1)
    expect(
      popNextQueuedCard(
        newPlacesDoc(),
        LANE,
        IDLE,
        held(() => "x"),
      ),
    ).toEqual({
      kind: "idle",
    })
  })

  test("an unqueued card is not popped", () => {
    const cards = newPlacesDoc()
    queue(cards, "c0000000-0000-7000-8000-000000000001", "a")
    const row = cards.cards()["c0000000-0000-7000-8000-000000000001"]
    if (row !== undefined)
      cards.cards.set("c0000000-0000-7000-8000-000000000001", {
        ...row,
        kind: "note",
        order: "",
      })
    expect(
      popNextQueuedCard(
        cards,
        LANE,
        IDLE,
        held(() => "x"),
      ).kind,
    ).toBe("idle")
  })

  test("a top card whose text the host does not yet hold is behind, and stays: the next waits behind it (S96)", () => {
    const cards = newPlacesDoc()
    queue(cards, "c0000000-0000-7000-8000-000000000001", "a")
    queue(cards, "c0000000-0000-7000-8000-000000000002", "b")
    const top = popNextQueuedCard(
      cards,
      LANE,
      IDLE,
      held(() => "x", ["c0000000-0000-7000-8000-000000000001"]),
    )
    expect(top.kind === "behind" ? top.card.id : top.kind).toBe(
      "c0000000-0000-7000-8000-000000000001",
    )
    expect(readPlaces(cards).map(c => c.id)).toEqual([
      "c0000000-0000-7000-8000-000000000001",
      "c0000000-0000-7000-8000-000000000002",
    ])
  })
})

test("chatOfPoppedQueuedCard: the queuer's message, in the queue's mode, from the card", () => {
  const cards = newPlacesDoc()
  queue(cards, "c0000000-0000-7000-8000-000000000001", "a")
  const popped = poppedOf(
    popNextQueuedCard(
      cards,
      LANE,
      IDLE,
      held(() => "@agent go"),
    ),
  )
  expect(
    popped === null ? null : chatOfPoppedQueuedCard(popped, ROOT_ID),
  ).toMatchObject({
    root: ROOT_ID,
    text: "@agent go",
    at: { kind: "queue", thread: LANE },
    card: { id: "c0000000-0000-7000-8000-000000000001", seen: "" },
    mentions: [{ kind: "agent" }],
  })
})

/** The places' text cards: the lane's thread card is the fixture's (`putTask`). */
const textsIn = (places: Parameters<typeof readPlaces>[0]) =>
  readPlaces(places).filter(isTextCard)

function setUp(
  texts: Record<string, string>,
  answers: readonly Outcome[],
  prepared: Awaited<ReturnType<QueuedCardPopDeps["work"]["prepareUpdate"]>> = {
    kind: "nothing",
  },
  behind: readonly string[] = [],
) {
  const b = basics()
  // The lane's thread on a task's canvas: an unsent card goes to its notes.
  putTask(b, LANE)
  const presence = newPresenceDoc()
  const events: string[] = []
  const appended: unknown[] = []
  const sends = [...answers]
  const deps: QueuedCardPopDeps = {
    basics: b,
    records: { writeValues: async writes => applyWrites(b, writes) },
    agent: record<QueuedCardPopDeps["agent"]>({
      lane: () =>
        record<ThreadLaneHandle>({
          append: async message => {
            events.push(`append ${message.customType}`)
            appended.push(message)
            return { kind: "appended", id: entryId("f-1") }
          },
        }).port,
    }).port,
    texts: record<QueuedCardPopDeps["texts"]>({
      hydrate: async ids => {
        events.push(`hydrate ${ids.join(",")}`)
      },
      textNow: (id: CardId) => texts[id] ?? "",
      holds: id => !behind.includes(id),
      destroy: async id => {
        events.push(`destroy ${id}`)
      },
    }).port,
    work: record<QueuedCardPopDeps["work"]>({
      prepareUpdate: async (_lane, by, intent) => {
        events.push(`update by ${by}: ${intent}`)
        return prepared
      },
      prepareSplit: async (lane, by, intent) => {
        events.push(`split by ${by}: ${intent}`)
        return intent === "refuse"
          ? { refused: "nothing to split" }
          : planStack({
              skill: null,
              bookmark: "pinetrie-stack/x",
              details: { lane, start: [], tip: commitId("t"), by },
              intent,
              timestamp: 1,
            })
      },
    }).port,
    start: (_lane, s) => {
      events.push(`start ${s.kind === "prompt" ? s.message.customType : ""}`)
      return runId("r-1")
    },
    send: async (popped: PoppedQueuedCard) => {
      events.push(`send ${popped.card.id}: ${popped.text}`)
      return sends.shift() ?? { kind: "appended", id: entryId("e-9") }
    },
    presence,
    behind: card => {
      events.push(`behind ${card.id}`)
    },
    typing: card => {
      events.push(`typing ${card.id}`)
    },
    blank: card => {
      events.push(`blank ${card.id}`)
    },
    provenance: createProvenance({
      basics: b,
      presence,
      records: { writeValues: async w => applyWrites(b, w) },
    }),
  }
  return { b, events, deps, appended, presence }
}

describe("drain", () => {
  test("a held queue pops no message; a card someone types in on top waits for them, and the cards behind it wait too (ADR-0048 step 7)", async () => {
    const { b, events, deps, presence } = setUp(
      {
        "c0000000-0000-7000-8000-000000000001": "a",
        "c0000000-0000-7000-8000-000000000002": "b",
      },
      [],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a")
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    applyWrites(b, [setRecord(QUEUE_HOLD, { lane: LANE, by: ADA, at: 1 })])
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001,c0000000-0000-7000-8000-000000000002",
    ])
    expect(textsIn(b.places)).toHaveLength(2)
    applyWrites(b, [deleteRecord(QUEUE_HOLD, LANE)])
    presence.typingIn.set(
      seatKey(BEA, "s1"),
      "c0000000-0000-7000-8000-000000000001",
    )
    events.length = 0
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001,c0000000-0000-7000-8000-000000000002",
      "typing c0000000-0000-7000-8000-000000000001",
    ])
    expect(textsIn(b.places)).toHaveLength(2)
  })

  test("a blank message is passed over and stays queued; with only blank cards left, the drain waits for one to be written in (ADR-0113)", async () => {
    const { b, events, deps } = setUp(
      {
        "c0000000-0000-7000-8000-000000000001": " ",
        "c0000000-0000-7000-8000-000000000002": "go",
      },
      [],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a")
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001,c0000000-0000-7000-8000-000000000002",
      "send c0000000-0000-7000-8000-000000000002: go",
      "destroy c0000000-0000-7000-8000-000000000002",
      "blank c0000000-0000-7000-8000-000000000001",
    ])
    expect(textsIn(b.places).map(c => c.id)).toEqual([
      "c0000000-0000-7000-8000-000000000001",
    ])
  })

  test("a card whose text is behind is not blank: the cards behind it wait for it", async () => {
    const { b, events, deps } = setUp(
      { "c0000000-0000-7000-8000-000000000002": "go" },
      [],
      undefined,
      ["c0000000-0000-7000-8000-000000000001"],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a")
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001,c0000000-0000-7000-8000-000000000002",
      "behind c0000000-0000-7000-8000-000000000001",
    ])
  })

  test("a top card whose text is behind stops the drain and asks to be drained again; the cards behind it wait", async () => {
    const { b, events, deps } = setUp(
      {
        "c0000000-0000-7000-8000-000000000001": "first",
        "c0000000-0000-7000-8000-000000000002": "second",
      },
      [],
      undefined,
      ["c0000000-0000-7000-8000-000000000001"],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a")
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001,c0000000-0000-7000-8000-000000000002",
      "behind c0000000-0000-7000-8000-000000000001",
    ])
    expect(textsIn(b.places)).toHaveLength(2)
  })

  test("loads every queued text first, then sends in order until one starts a run", async () => {
    const { b, events, deps } = setUp(
      {
        "c0000000-0000-7000-8000-000000000001": "first",
        "c0000000-0000-7000-8000-000000000002": "@agent second",
        "c0000000-0000-7000-8000-000000000003": "third",
      },
      [
        { kind: "appended", id: entryId("e-2") },
        { kind: "started", runId: runId("r-1") },
      ],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a")
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    queue(b.places, "c0000000-0000-7000-8000-000000000003", "c")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001,c0000000-0000-7000-8000-000000000002,c0000000-0000-7000-8000-000000000003",
      "send c0000000-0000-7000-8000-000000000001: first",
      "destroy c0000000-0000-7000-8000-000000000001",
      "send c0000000-0000-7000-8000-000000000002: @agent second",
      "destroy c0000000-0000-7000-8000-000000000002",
    ])
    expect(textsIn(b.places).map(c => c.id)).toEqual([
      "c0000000-0000-7000-8000-000000000003",
    ])
  })

  test("a card popped and sent leaves no history (ADR-0048 step 6)", async () => {
    const { b, deps } = setUp(
      { "c0000000-0000-7000-8000-000000000001": "first" },
      [],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a")
    putValue(
      b,
      setRecord(CARD_HISTORY, {
        card: textCardId("c0000000-0000-7000-8000-000000000001"),
        events: [],
      }),
    )
    await drain(deps, LANE)
    expect(readCardHistories(b.session).size).toBe(0)
  })

  test("pops nothing while the lane runs", async () => {
    const { b, events, deps } = setUp(
      { "c0000000-0000-7000-8000-000000000001": "first" },
      [],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a")
    beginRun(b.live, LANE, runId("r-0"))
    await drain(deps, LANE)
    expect(events).toEqual(["hydrate c0000000-0000-7000-8000-000000000001"])
    expect(textsIn(b.places)).toHaveLength(1)
  })

  test("a card queued while texts load is loaded before it is popped", async () => {
    const { b, events, deps } = setUp(
      {
        "c0000000-0000-7000-8000-000000000001": "first",
        "c0000000-0000-7000-8000-000000000002": "second",
      },
      [],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a")
    const hydrate = deps.texts.hydrate
    let once = false
    const late: QueuedCardPopDeps = {
      ...deps,
      texts: {
        hydrate: async ids => {
          await hydrate(ids)
          if (!once)
            queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
          once = true
        },
        textNow: id => deps.texts.textNow(id),
        holds: () => true,
        destroy: id => deps.texts.destroy(id),
      },
    }
    await drain(late, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001",
      "hydrate c0000000-0000-7000-8000-000000000002",
      "send c0000000-0000-7000-8000-000000000001: first",
      "destroy c0000000-0000-7000-8000-000000000001",
      "send c0000000-0000-7000-8000-000000000002: second",
      "destroy c0000000-0000-7000-8000-000000000002",
    ])
  })

  test("a refused send goes back below the line, whole, saying why; its text is kept", async () => {
    const { b, events, deps } = setUp(
      {
        "c0000000-0000-7000-8000-000000000001": "look",
        "c0000000-0000-7000-8000-000000000002": "next",
      },
      [{ kind: "refused", code: ERR.IMAGE_MISSING, message: "no such image" }],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a")
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001,c0000000-0000-7000-8000-000000000002",
      "send c0000000-0000-7000-8000-000000000001: look",
      "send c0000000-0000-7000-8000-000000000002: next",
      "destroy c0000000-0000-7000-8000-000000000002",
    ])
    expect(textsIn(b.places)).toEqual([
      expect.objectContaining({
        id: "c0000000-0000-7000-8000-000000000001",
        place: expect.objectContaining({ kind: "note" }),
        unsent: "no such image",
      }),
    ])
    expect(b.lines.some(l => l.includes("no such image"))).toBe(true)
  })

  test("busy under the pop: the card goes back on top as it was, and the drain stops", async () => {
    const { b, deps } = setUp({ "c0000000-0000-7000-8000-000000000001": "x" }, [
      { kind: "busy" },
    ])
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a")
    await drain(deps, LANE)
    expect(textsIn(b.places)[0]?.place.kind).toBe("queued")
  })

  test("a send that throws writes the card back below the line, saying the host failed, and the next is popped", async () => {
    const { b, events, deps } = setUp(
      {
        "c0000000-0000-7000-8000-000000000001": "first",
        "c0000000-0000-7000-8000-000000000002": "second",
      },
      [],
    )
    const throwing: QueuedCardPopDeps = {
      ...deps,
      send: async popped => {
        if (popped.card.id === "c0000000-0000-7000-8000-000000000001")
          throw new Error("store closed")
        return deps.send(popped)
      },
    }
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a")
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    await drain(throwing, LANE)
    expect(textsIn(b.places)).toEqual([
      expect.objectContaining({
        id: "c0000000-0000-7000-8000-000000000001",
        place: expect.objectContaining({ kind: "note" }),
        unsent: "the host failed: store closed",
      }),
    ])
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001,c0000000-0000-7000-8000-000000000002",
      "send c0000000-0000-7000-8000-000000000002: second",
      "destroy c0000000-0000-7000-8000-000000000002",
    ])
  })
})

describe("drain: bring up to date (ADR-0108)", () => {
  const CMD = "bring-up-to-date" as const

  test("clean: the update, then the card's text as a message", async () => {
    const { b, events, deps } = setUp(
      { "c0000000-0000-7000-8000-000000000001": "check yours" },
      [],
      {
        kind: "clean",
      },
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a", CMD)
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001",
      `update by ${BEA}: check yours`,
      "send c0000000-0000-7000-8000-000000000001: check yours",
      "destroy c0000000-0000-7000-8000-000000000001",
    ])
  })

  test("clean with no text: the update alone, and no run", async () => {
    const { b, events, deps } = setUp(
      { "c0000000-0000-7000-8000-000000000001": "" },
      [],
      { kind: "clean" },
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a", CMD)
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001",
      `update by ${BEA}: `,
      "destroy c0000000-0000-7000-8000-000000000001",
    ])
  })

  test("nothing new: the text alone", async () => {
    const { b, events, deps } = setUp(
      { "c0000000-0000-7000-8000-000000000001": "go on" },
      [],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a", CMD)
    await drain(deps, LANE)
    expect(events.slice(2)).toEqual([
      "send c0000000-0000-7000-8000-000000000001: go on",
      "destroy c0000000-0000-7000-8000-000000000001",
    ])
  })

  test("conflicted: the resolution runs, carrying the text, and ends the drain", async () => {
    const message = { customType: "pinetrie.land" } as never
    const { b, events, deps } = setUp(
      {
        "c0000000-0000-7000-8000-000000000001": "keep both",
        "c0000000-0000-7000-8000-000000000002": "later",
      },
      [],
      {
        kind: "conflicted",
        message,
      },
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a", CMD)
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001,c0000000-0000-7000-8000-000000000002",
      `update by ${BEA}: keep both`,
      "destroy c0000000-0000-7000-8000-000000000001",
      "start pinetrie.land",
    ])
    expect(textsIn(b.places).map(c => c.id)).toEqual([
      "c0000000-0000-7000-8000-000000000002",
    ])
  })

  test("refused: back below the line with its command, saying why, and the next card is popped", async () => {
    const { b, events, deps } = setUp(
      {
        "c0000000-0000-7000-8000-000000000001": "x",
        "c0000000-0000-7000-8000-000000000002": "next",
      },
      [],
      {
        kind: "refused",
        reason: "the lane has no copy of its own",
      },
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a", CMD)
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    await drain(deps, LANE)
    expect(textsIn(b.places)).toEqual([
      expect.objectContaining({
        kind: "text" as const,
        id: "c0000000-0000-7000-8000-000000000001",
        carries: { kind: "message", command: CMD },
        unsent: "the lane has no copy of its own",
        place: expect.objectContaining({ kind: "note" }),
      }),
    ])
    expect(events).toContain("send c0000000-0000-7000-8000-000000000002: next")
  })

  test("an update that throws writes the card back with its command, saying the host failed", async () => {
    const { b, deps } = setUp(
      { "c0000000-0000-7000-8000-000000000001": "x" },
      [],
    )
    const throwing: QueuedCardPopDeps = {
      ...deps,
      work: record<QueuedCardPopDeps["work"]>({
        prepareUpdate: async () => {
          throw new Error("jj broke")
        },
      }).port,
    }
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a", CMD)
    await drain(throwing, LANE)
    expect(textsIn(b.places)[0]).toMatchObject({
      carries: { kind: "message", command: CMD },
      unsent: "the host failed: jj broke",
    })
  })

  test("its text refused after a clean update: back below the line without the command, which was carried out", async () => {
    const { b, deps } = setUp(
      { "c0000000-0000-7000-8000-000000000001": "x" },
      [{ kind: "refused", code: ERR.REFUSED, message: "pi refused" }],
      { kind: "clean" },
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a", CMD)
    await drain(deps, LANE)
    expect(textsIn(b.places)[0]).toMatchObject({
      carries: { kind: "message", command: null },
      unsent: "pi refused",
    })
  })
})

describe("the drain's waits for its top card", () => {
  const queuedCard = (places: ReturnType<typeof newPlacesDoc>, id: string) => {
    const card = readPlaces(places).find(c => c.id === id)
    if (card?.kind !== "text" || card.place.kind !== "queued")
      throw new Error("not queued")
    return { ...card, place: card.place }
  }

  test("givenUp: the awaited cards no longer queued, and no other", () => {
    const places = newPlacesDoc()
    queue(places, "c0000000-0000-7000-8000-000000000001", "a")
    expect(
      givenUp(
        [
          textCardId("c0000000-0000-7000-8000-000000000001"),
          textCardId("c0000000-0000-7000-8000-000000000002"),
        ],
        readPlaces(places),
      ),
    ).toEqual(["c0000000-0000-7000-8000-000000000002"])
  })

  test("a card that leaves the queue gives its wait up, and drains nothing; one whose wait ends drains its lane", async () => {
    const places = newPlacesDoc()
    queue(places, "c0000000-0000-7000-8000-000000000001", "a")
    queue(places, "c0000000-0000-7000-8000-000000000002", "b")
    const waits = new Map<
      string,
      { arrive: () => void; signal?: AbortSignal }
    >()
    const until = (id: string) => (signal: AbortSignal) =>
      new Promise<void>(resolve => {
        waits.set(id, { arrive: resolve, signal })
        signal.addEventListener("abort", () => resolve())
      })
    const drained: string[] = []
    const wait = createWaits({ places, drain: l => drained.push(l) })
    wait(
      queuedCard(places, "c0000000-0000-7000-8000-000000000001"),
      until("c0000000-0000-7000-8000-000000000001"),
    )
    wait(
      queuedCard(places, "c0000000-0000-7000-8000-000000000002"),
      until("c0000000-0000-7000-8000-000000000002"),
    )
    // Asked twice, a card is waited for once.
    wait(
      queuedCard(places, "c0000000-0000-7000-8000-000000000001"),
      until("c0000000-0000-7000-8000-000000000102"),
    )
    expect([...waits.keys()]).toEqual([
      "c0000000-0000-7000-8000-000000000001",
      "c0000000-0000-7000-8000-000000000002",
    ])
    // c-1 leaves the queue: its wait is given up.
    places.cards.delete("c0000000-0000-7000-8000-000000000001")
    await Promise.resolve()
    expect(
      waits.get("c0000000-0000-7000-8000-000000000001")?.signal?.aborted,
    ).toBe(true)
    expect(drained).toEqual([])
    waits.get("c0000000-0000-7000-8000-000000000002")?.arrive()
    await Promise.resolve()
    await Promise.resolve()
    expect(drained).toEqual([LANE])
  })

  test("untilNotTyped: resolves once the typing in the card is gone, or at once when there is none", async () => {
    const presence = newPresenceDoc()
    const seat = seatKey(BEA, "s1")
    presence.typingIn.set(seat, "c0000000-0000-7000-8000-000000000001")
    let done = false
    void untilNotTyped(
      presence,
      textCardId("c0000000-0000-7000-8000-000000000001"),
      new AbortController().signal,
    ).then(() => {
      done = true
    })
    presence.typingIn.set(seat, "c0000000-0000-7000-8000-000000000002")
    await Promise.resolve()
    expect(done).toBe(true)
    await untilNotTyped(
      presence,
      textCardId("c0000000-0000-7000-8000-000000000009"),
      new AbortController().signal,
    )
  })
})

describe("drain: a fact (ADR-0080)", () => {
  test("a queued fact is appended as the fact, its card gone, and the drain goes on", async () => {
    const { b, events, deps, appended } = setUp(
      { "c0000000-0000-7000-8000-000000000002": "next" },
      [],
    )
    const fact = {
      kind: "accepted",
      lane: LANE,
      by: ADA,
      as: "kabcdefgh",
      bookmark: "pinetrie-accepted",
      to: { kind: "accepted" },
    } as const
    b.places.cards.set(
      "c0000000-0000-7000-8000-000000000001",
      encodeCard({
        kind: "text" as const,
        id: textCardId("c0000000-0000-7000-8000-000000000001"),
        owner: ADA,
        placer: ADA,
        place: {
          kind: "queued",
          at: atEntry(E1),
          thread: LANE,
          order: "a",
          by: ADA,
          seen: "",
        },
        carries: { kind: "fact", fact },
        unsent: null,
      }),
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001,c0000000-0000-7000-8000-000000000002",
      "destroy c0000000-0000-7000-8000-000000000001",
      "append pinetrie.fact",
      "send c0000000-0000-7000-8000-000000000002: next",
      "destroy c0000000-0000-7000-8000-000000000002",
    ])
    expect(appended.map(decodeFact)).toEqual([fact])
    expect(textsIn(b.places)).toEqual([])
  })
})

describe("drain: a split (ADR-0080)", () => {
  test("a split card starts the split's own run, its text the brief, and ends the drain", async () => {
    const { b, events, deps } = setUp(
      {
        "c0000000-0000-7000-8000-000000000001": "tests apart",
        "c0000000-0000-7000-8000-000000000002": "next",
      },
      [],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a", "split")
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c0000000-0000-7000-8000-000000000001,c0000000-0000-7000-8000-000000000002",
      `split by ${BEA}: tests apart`,
      "destroy c0000000-0000-7000-8000-000000000001",
      "start pinetrie.stack",
    ])
    expect(textsIn(b.places).map(c => c.id)).toEqual([
      "c0000000-0000-7000-8000-000000000002",
    ])
  })

  test("refused: back below the line with its command, saying why, and the next card is popped", async () => {
    const { b, events, deps } = setUp(
      {
        "c0000000-0000-7000-8000-000000000001": "refuse",
        "c0000000-0000-7000-8000-000000000002": "next",
      },
      [],
    )
    queue(b.places, "c0000000-0000-7000-8000-000000000001", "a", "split")
    queue(b.places, "c0000000-0000-7000-8000-000000000002", "b")
    await drain(deps, LANE)
    expect(events).toContain("send c0000000-0000-7000-8000-000000000002: next")
    expect(textsIn(b.places)).toEqual([
      expect.objectContaining({
        kind: "text" as const,
        id: "c0000000-0000-7000-8000-000000000001",
        carries: { kind: "message", command: "split" },
        unsent: "nothing to split",
      }),
    ])
  })
})
