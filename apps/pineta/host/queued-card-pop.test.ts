import {
  atEntry,
  type CardCommand,
  type CardId,
  cardId,
  ERR,
  entryId,
  laneNameForThread,
  rootIdFor,
  runId,
  writerId,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import { readCardHistories, readPlaces, readPlacesRev } from "@pineta/reads"
import { CARD_HISTORY, encodeCard, setRecord } from "@pineta/rules"
import { beginRun, newPlacesDoc, newPresenceDoc } from "@pineta/schema"
import { describe, expect, test } from "vitest"
import type { CardPort } from "./cards.ts"
import { applyWrites, basics, putValue, record } from "./fakes.ts"
import { createProvenance } from "./provenance.ts"
import {
  chatOfPoppedQueuedCard,
  createBehind,
  drain,
  givenUp,
  type NextQueuedCardPop,
  type PoppedQueuedCard,
  popNextQueuedCard,
  type QueuedCardPopDeps,
} from "./queued-card-pop.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const LANE = laneNameForThread("0123456789abcdef")
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
      id: cardId(id),
      owner: ADA,
      placer: ADA,
      place: {
        kind: "queued",
        root: TEST_ROOT,
        at: atEntry(E1),
        lane: LANE,
        order,
        by: BEA,
        seen: "",
      },
      command,
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
const poppedOf = (top: NextQueuedCardPop): PoppedQueuedCard | null =>
  top.kind === "popped" ? top.popped : null

describe("popNextQueuedCard", () => {
  test("reads the top queued card and deletes its record before it returns", () => {
    const cards = newPlacesDoc()
    queue(cards, "c-2", "b")
    queue(cards, "c-1", "a")
    const popped = poppedOf(
      popNextQueuedCard(
        cards,
        LANE,
        false,
        held(id => `text of ${id}`),
      ),
    )
    expect(popped?.card.id).toBe("c-1")
    expect(popped?.text).toBe("text of c-1")
    expect(readPlaces(cards).map(c => c.id)).toEqual(["c-2"])
  })

  test("its removal raises the places document's rev, so a client whose unqueue it beat settles (ADR-0059)", () => {
    const cards = newPlacesDoc()
    queue(cards, "c-1", "a")
    popNextQueuedCard(
      cards,
      LANE,
      false,
      held(() => "x"),
    )
    expect(readPlacesRev(cards)).toBe(1)
  })

  test("pops nothing while the lane runs, or when nothing is queued", () => {
    const cards = newPlacesDoc()
    queue(cards, "c-1", "a")
    expect(
      popNextQueuedCard(
        cards,
        LANE,
        true,
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
        false,
        held(() => "x"),
      ),
    ).toEqual({
      kind: "idle",
    })
  })

  test("an unqueued card is not popped", () => {
    const cards = newPlacesDoc()
    queue(cards, "c-1", "a")
    const row = cards.cards()["c-1"]
    if (row !== undefined) cards.cards.set("c-1", { ...row, kind: "drafting" })
    expect(
      popNextQueuedCard(
        cards,
        LANE,
        false,
        held(() => "x"),
      ).kind,
    ).toBe("idle")
  })

  test("a top card whose text the host does not yet hold is behind, and stays: the next waits behind it (S96)", () => {
    const cards = newPlacesDoc()
    queue(cards, "c-1", "a")
    queue(cards, "c-2", "b")
    const top = popNextQueuedCard(
      cards,
      LANE,
      false,
      held(() => "x", ["c-1"]),
    )
    expect(top.kind === "behind" ? top.card.id : top.kind).toBe("c-1")
    expect(readPlaces(cards).map(c => c.id)).toEqual(["c-1", "c-2"])
  })
})

test("chatOfPoppedQueuedCard: the queuer's message, in the queue's mode, from the card", () => {
  const cards = newPlacesDoc()
  queue(cards, "c-1", "a")
  const popped = poppedOf(
    popNextQueuedCard(
      cards,
      LANE,
      false,
      held(() => "@agent go"),
    ),
  )
  expect(popped === null ? null : chatOfPoppedQueuedCard(popped)).toMatchObject(
    {
      text: "@agent go",
      at: atEntry(E1),
      mode: "queue",
      lane: LANE,
      card: { id: "c-1", seen: "" },
      mentions: [{ kind: "agent" }],
    },
  )
})

function setUp(
  texts: Record<string, string>,
  answers: readonly Outcome[],
  prepared: Awaited<ReturnType<QueuedCardPopDeps["work"]["prepareUpdate"]>> = {
    kind: "nothing",
  },
  behind: readonly string[] = [],
) {
  const b = basics()
  const events: string[] = []
  const sends = [...answers]
  const deps: QueuedCardPopDeps = {
    basics: b,
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
    }).port,
    start: (_lane, s) => {
      events.push(`start ${s.kind === "prompt" ? s.message.customType : ""}`)
      return runId("r-1")
    },
    send: async (popped: PoppedQueuedCard) => {
      events.push(`send ${popped.card.id}: ${popped.text}`)
      return sends.shift() ?? { kind: "appended", id: entryId("e-9") }
    },
    behind: card => {
      events.push(`behind ${card.id}`)
    },
    provenance: createProvenance({
      basics: b,
      presence: newPresenceDoc(),
      agent: () => ({ writeValues: async w => applyWrites(b, w) }),
    }),
  }
  return { b, events, deps }
}

describe("drain", () => {
  test("a top card whose text is behind stops the drain and asks to be drained again; the cards behind it wait", async () => {
    const { b, events, deps } = setUp(
      { "c-1": "first", "c-2": "second" },
      [],
      undefined,
      ["c-1"],
    )
    queue(b.places, "c-1", "a")
    queue(b.places, "c-2", "b")
    await drain(deps, LANE)
    expect(events).toEqual(["hydrate c-1,c-2", "behind c-1"])
    expect(readPlaces(b.places)).toHaveLength(2)
  })

  test("loads every queued text first, then sends in order until one starts a run", async () => {
    const { b, events, deps } = setUp(
      { "c-1": "first", "c-2": "@agent second", "c-3": "third" },
      [
        { kind: "appended", id: entryId("e-2") },
        { kind: "started", runId: runId("r-1") },
      ],
    )
    queue(b.places, "c-1", "a")
    queue(b.places, "c-2", "b")
    queue(b.places, "c-3", "c")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c-1,c-2,c-3",
      "send c-1: first",
      "destroy c-1",
      "send c-2: @agent second",
      "destroy c-2",
    ])
    expect(readPlaces(b.places).map(c => c.id)).toEqual(["c-3"])
  })

  test("a card popped and sent leaves no history (ADR-0048 step 6)", async () => {
    const { b, deps } = setUp({ "c-1": "first" }, [])
    queue(b.places, "c-1", "a")
    putValue(b, setRecord(CARD_HISTORY, { card: cardId("c-1"), events: [] }))
    await drain(deps, LANE)
    expect(readCardHistories(b.session).size).toBe(0)
  })

  test("pops nothing while the lane runs", async () => {
    const { b, events, deps } = setUp({ "c-1": "first" }, [])
    queue(b.places, "c-1", "a")
    beginRun(b.live, LANE, runId("r-0"))
    await drain(deps, LANE)
    expect(events).toEqual(["hydrate c-1"])
    expect(readPlaces(b.places)).toHaveLength(1)
  })

  test("a card queued while texts load is loaded before it is popped", async () => {
    const { b, events, deps } = setUp({ "c-1": "first", "c-2": "second" }, [])
    queue(b.places, "c-1", "a")
    const hydrate = deps.texts.hydrate
    let once = false
    const late: QueuedCardPopDeps = {
      ...deps,
      texts: {
        hydrate: async ids => {
          await hydrate(ids)
          if (!once) queue(b.places, "c-2", "b")
          once = true
        },
        textNow: id => deps.texts.textNow(id),
        holds: () => true,
        destroy: id => deps.texts.destroy(id),
      },
    }
    await drain(late, LANE)
    expect(events).toEqual([
      "hydrate c-1",
      "hydrate c-2",
      "send c-1: first",
      "destroy c-1",
      "send c-2: second",
      "destroy c-2",
    ])
  })

  test("a refused send goes back below the line, whole, saying why; its text is kept", async () => {
    const { b, events, deps } = setUp({ "c-1": "look", "c-2": "next" }, [
      { kind: "refused", code: ERR.IMAGE_MISSING, message: "no such image" },
    ])
    queue(b.places, "c-1", "a")
    queue(b.places, "c-2", "b")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c-1,c-2",
      "send c-1: look",
      "send c-2: next",
      "destroy c-2",
    ])
    expect(readPlaces(b.places)).toEqual([
      expect.objectContaining({
        id: "c-1",
        place: {
          kind: "drafting",
          root: TEST_ROOT,
          at: atEntry(E1),
          lane: LANE,
        },
        unsent: "no such image",
      }),
    ])
    expect(b.lines.some(l => l.includes("no such image"))).toBe(true)
  })

  test("busy under the pop: the card goes back on top as it was, and the drain stops", async () => {
    const { b, deps } = setUp({ "c-1": "x" }, [{ kind: "busy" }])
    queue(b.places, "c-1", "a")
    await drain(deps, LANE)
    expect(readPlaces(b.places)[0]?.place.kind).toBe("queued")
  })

  test("a send that throws writes the card back below the line, saying the host failed, and the next is popped", async () => {
    const { b, events, deps } = setUp({ "c-1": "first", "c-2": "second" }, [])
    const throwing: QueuedCardPopDeps = {
      ...deps,
      send: async popped => {
        if (popped.card.id === "c-1") throw new Error("store closed")
        return deps.send(popped)
      },
    }
    queue(b.places, "c-1", "a")
    queue(b.places, "c-2", "b")
    await drain(throwing, LANE)
    expect(readPlaces(b.places)).toEqual([
      expect.objectContaining({
        id: "c-1",
        place: {
          kind: "drafting",
          root: TEST_ROOT,
          at: atEntry(E1),
          lane: LANE,
        },
        unsent: "the host failed: store closed",
      }),
    ])
    expect(events).toEqual([
      "hydrate c-1,c-2",
      "send c-2: second",
      "destroy c-2",
    ])
  })

  test("an empty plain card starts nothing and is spent", async () => {
    const { b, events, deps } = setUp({ "c-1": "  " }, [])
    queue(b.places, "c-1", "a")
    await drain(deps, LANE)
    expect(events).toEqual(["hydrate c-1", "destroy c-1"])
  })
})

describe("drain: bring up to date (ADR-0055)", () => {
  const CMD = "bring-up-to-date" as const

  test("clean: the update, then the card's text as a message", async () => {
    const { b, events, deps } = setUp({ "c-1": "check yours" }, [], {
      kind: "clean",
    })
    queue(b.places, "c-1", "a", CMD)
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c-1",
      `update by ${BEA}: check yours`,
      "send c-1: check yours",
      "destroy c-1",
    ])
  })

  test("clean with no text: the update alone, and no run", async () => {
    const { b, events, deps } = setUp({ "c-1": "" }, [], { kind: "clean" })
    queue(b.places, "c-1", "a", CMD)
    await drain(deps, LANE)
    expect(events).toEqual(["hydrate c-1", `update by ${BEA}: `, "destroy c-1"])
  })

  test("nothing new: the text alone", async () => {
    const { b, events, deps } = setUp({ "c-1": "go on" }, [])
    queue(b.places, "c-1", "a", CMD)
    await drain(deps, LANE)
    expect(events.slice(2)).toEqual(["send c-1: go on", "destroy c-1"])
  })

  test("conflicted: the resolution runs, carrying the text, and ends the drain", async () => {
    const message = { customType: "pineta.land" } as never
    const { b, events, deps } = setUp(
      { "c-1": "keep both", "c-2": "later" },
      [],
      {
        kind: "conflicted",
        message,
      },
    )
    queue(b.places, "c-1", "a", CMD)
    queue(b.places, "c-2", "b")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c-1,c-2",
      `update by ${BEA}: keep both`,
      "destroy c-1",
      "start pineta.land",
    ])
    expect(readPlaces(b.places).map(c => c.id)).toEqual(["c-2"])
  })

  test("refused: back below the line with its command, saying why, and the next card is popped", async () => {
    const { b, events, deps } = setUp({ "c-1": "x", "c-2": "next" }, [], {
      kind: "refused",
      reason: "the lane has no copy of its own",
    })
    queue(b.places, "c-1", "a", CMD)
    queue(b.places, "c-2", "b")
    await drain(deps, LANE)
    expect(readPlaces(b.places)).toEqual([
      expect.objectContaining({
        id: "c-1",
        command: CMD,
        unsent: "the lane has no copy of its own",
        place: {
          kind: "drafting",
          root: TEST_ROOT,
          at: atEntry(E1),
          lane: LANE,
        },
      }),
    ])
    expect(events).toContain("send c-2: next")
  })

  test("an update that throws writes the card back with its command, saying the host failed", async () => {
    const { b, deps } = setUp({ "c-1": "x" }, [])
    const throwing: QueuedCardPopDeps = {
      ...deps,
      work: {
        prepareUpdate: async () => {
          throw new Error("jj broke")
        },
      },
    }
    queue(b.places, "c-1", "a", CMD)
    await drain(throwing, LANE)
    expect(readPlaces(b.places)[0]).toMatchObject({
      command: CMD,
      unsent: "the host failed: jj broke",
    })
  })

  test("its text refused after a clean update: back below the line without the command, which was carried out", async () => {
    const { b, deps } = setUp(
      { "c-1": "x" },
      [{ kind: "refused", code: ERR.REFUSED, message: "pi refused" }],
      { kind: "clean" },
    )
    queue(b.places, "c-1", "a", CMD)
    await drain(deps, LANE)
    expect(readPlaces(b.places)[0]).toMatchObject({
      command: null,
      unsent: "pi refused",
    })
  })
})

describe("waiting for a queued card's text (behind)", () => {
  const queuedCard = (places: ReturnType<typeof newPlacesDoc>, id: string) => {
    const card = readPlaces(places).find(c => c.id === id)
    if (card?.place.kind !== "queued") throw new Error("not queued")
    return { ...card, place: card.place }
  }

  test("givenUp: the awaited cards no longer queued, and no other", () => {
    const places = newPlacesDoc()
    queue(places, "c-1", "a")
    expect(givenUp([cardId("c-1"), cardId("c-2")], readPlaces(places))).toEqual(
      ["c-2"],
    )
  })

  test("a card that leaves the queue gives its wait up, and drains nothing; one whose text arrives drains its lane", async () => {
    const places = newPlacesDoc()
    queue(places, "c-1", "a")
    queue(places, "c-2", "b")
    const waits = new Map<
      string,
      { arrive: () => void; signal?: AbortSignal }
    >()
    const texts: Pick<CardPort, "whenHolds"> = {
      whenHolds: (id, _seen, signal) =>
        new Promise(resolve => {
          waits.set(id, { arrive: resolve, signal })
          signal?.addEventListener("abort", () => resolve())
        }),
    }
    const drained: string[] = []
    const behind = createBehind({ places, texts, drain: l => drained.push(l) })
    behind(queuedCard(places, "c-1"))
    behind(queuedCard(places, "c-2"))
    // Asked twice, a card is waited for once.
    behind(queuedCard(places, "c-1"))
    expect([...waits.keys()]).toEqual(["c-1", "c-2"])
    // c-1 leaves the queue: its wait is given up.
    places.cards.delete("c-1")
    await Promise.resolve()
    expect(waits.get("c-1")?.signal?.aborted).toBe(true)
    expect(drained).toEqual([])
    waits.get("c-2")?.arrive()
    await Promise.resolve()
    await Promise.resolve()
    expect(drained).toEqual([LANE])
  })
})
