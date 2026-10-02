import {
  atEntry,
  type CardCommand,
  type CardId,
  cardId,
  ERR,
  entryId,
  laneNameForThread,
  runId,
  writerId,
} from "@pineta/core"
import { encodeCard } from "@pineta/marginalia"
import type { Outcome } from "@pineta/protocol/codec"
import { readCards } from "@pineta/reads"
import { beginRun, newCardsDoc } from "@pineta/schema"
import { describe, expect, test } from "vitest"
import type { CardPort } from "./cards.ts"
import { basics, record } from "./fakes.ts"
import {
  drain,
  type TakeDeps,
  type Taken,
  type TakeTop,
  takenChat,
  takeTop,
} from "./take.ts"

const LANE = laneNameForThread("0123456789abcdef")
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const E1 = entryId("e-1")

const queue = (
  cards: ReturnType<typeof newCardsDoc>,
  id: string,
  order: string,
  command: CardCommand | null = null,
) =>
  cards.cards.set(
    id,
    encodeCard({
      id: cardId(id),
      owner: ADA,
      place: {
        kind: "queued",
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
const takenOf = (top: TakeTop): Taken | null =>
  top.kind === "taken" ? top.taken : null

describe("takeTop", () => {
  test("reads the top queued card and deletes its record before it returns", () => {
    const cards = newCardsDoc()
    queue(cards, "c-2", "b")
    queue(cards, "c-1", "a")
    const taken = takenOf(
      takeTop(
        cards,
        LANE,
        false,
        held(id => `text of ${id}`),
      ),
    )
    expect(taken?.card.id).toBe("c-1")
    expect(taken?.text).toBe("text of c-1")
    expect(readCards(cards).map(c => c.id)).toEqual(["c-2"])
  })

  test("takes nothing while the lane runs, or when nothing is queued", () => {
    const cards = newCardsDoc()
    queue(cards, "c-1", "a")
    expect(
      takeTop(
        cards,
        LANE,
        true,
        held(() => "x"),
      ),
    ).toEqual({
      kind: "idle",
    })
    expect(readCards(cards)).toHaveLength(1)
    expect(
      takeTop(
        newCardsDoc(),
        LANE,
        false,
        held(() => "x"),
      ),
    ).toEqual({
      kind: "idle",
    })
  })

  test("an unqueued card is not taken", () => {
    const cards = newCardsDoc()
    queue(cards, "c-1", "a")
    cards.cards.at("c-1")?.kind.set("drafting")
    expect(
      takeTop(
        cards,
        LANE,
        false,
        held(() => "x"),
      ).kind,
    ).toBe("idle")
  })

  test("a top card whose text the host does not yet hold is behind, and stays: the next waits behind it (S72)", () => {
    const cards = newCardsDoc()
    queue(cards, "c-1", "a")
    queue(cards, "c-2", "b")
    const top = takeTop(
      cards,
      LANE,
      false,
      held(() => "x", ["c-1"]),
    )
    expect(top.kind === "behind" ? top.card.id : top.kind).toBe("c-1")
    expect(readCards(cards).map(c => c.id)).toEqual(["c-1", "c-2"])
  })
})

test("takenChat: the queuer's message, in the queue's mode, from the card", () => {
  const cards = newCardsDoc()
  queue(cards, "c-1", "a")
  const taken = takenOf(
    takeTop(
      cards,
      LANE,
      false,
      held(() => "@agent go"),
    ),
  )
  expect(taken === null ? null : takenChat(taken)).toMatchObject({
    text: "@agent go",
    at: atEntry(E1),
    mode: "queue",
    lane: LANE,
    card: "c-1",
    mentions: [{ kind: "agent" }],
  })
})

function setUp(
  texts: Record<string, string>,
  answers: readonly Outcome[],
  prepared: Awaited<ReturnType<TakeDeps["work"]["prepareUpdate"]>> = {
    kind: "nothing",
  },
  behind: readonly string[] = [],
) {
  const b = basics()
  const events: string[] = []
  const sends = [...answers]
  const deps: TakeDeps = {
    basics: b,
    texts: record<TakeDeps["texts"]>({
      hydrate: async ids => {
        events.push(`hydrate ${ids.join(",")}`)
      },
      textNow: (id: CardId) => texts[id] ?? "",
      holds: id => !behind.includes(id),
      destroy: async id => {
        events.push(`destroy ${id}`)
      },
    }).port,
    work: record<TakeDeps["work"]>({
      prepareUpdate: async (_lane, by, intent) => {
        events.push(`update by ${by}: ${intent}`)
        return prepared
      },
    }).port,
    start: (_lane, s) => {
      events.push(`start ${s.kind === "prompt" ? s.message.customType : ""}`)
      return runId("r-1")
    },
    send: async (taken: Taken) => {
      events.push(`send ${taken.card.id}: ${taken.text}`)
      return sends.shift() ?? { kind: "appended", id: entryId("e-9") }
    },
    behind: card => {
      events.push(`behind ${card.id}`)
    },
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
    queue(b.cards, "c-1", "a")
    queue(b.cards, "c-2", "b")
    await drain(deps, LANE)
    expect(events).toEqual(["hydrate c-1,c-2", "behind c-1"])
    expect(readCards(b.cards)).toHaveLength(2)
  })

  test("loads every queued text first, then sends in order until one starts a run", async () => {
    const { b, events, deps } = setUp(
      { "c-1": "first", "c-2": "@agent second", "c-3": "third" },
      [
        { kind: "appended", id: entryId("e-2") },
        { kind: "started", runId: runId("r-1") },
      ],
    )
    queue(b.cards, "c-1", "a")
    queue(b.cards, "c-2", "b")
    queue(b.cards, "c-3", "c")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c-1,c-2,c-3",
      "send c-1: first",
      "destroy c-1",
      "send c-2: @agent second",
      "destroy c-2",
    ])
    expect(readCards(b.cards).map(c => c.id)).toEqual(["c-3"])
  })

  test("takes nothing while the lane runs", async () => {
    const { b, events, deps } = setUp({ "c-1": "first" }, [])
    queue(b.cards, "c-1", "a")
    beginRun(b.doc, LANE, runId("r-0"))
    await drain(deps, LANE)
    expect(events).toEqual(["hydrate c-1"])
    expect(readCards(b.cards)).toHaveLength(1)
  })

  test("a card queued while texts load is loaded before it is taken", async () => {
    const { b, events, deps } = setUp({ "c-1": "first", "c-2": "second" }, [])
    queue(b.cards, "c-1", "a")
    const hydrate = deps.texts.hydrate
    let once = false
    const late: TakeDeps = {
      ...deps,
      texts: {
        hydrate: async ids => {
          await hydrate(ids)
          if (!once) queue(b.cards, "c-2", "b")
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
    queue(b.cards, "c-1", "a")
    queue(b.cards, "c-2", "b")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c-1,c-2",
      "send c-1: look",
      "send c-2: next",
      "destroy c-2",
    ])
    expect(readCards(b.cards)).toEqual([
      expect.objectContaining({
        id: "c-1",
        place: { kind: "drafting", at: atEntry(E1), lane: LANE },
        unsent: "no such image",
      }),
    ])
    expect(b.lines.some(l => l.includes("no such image"))).toBe(true)
  })

  test("busy under the take: the card goes back on top as it was, and the drain stops", async () => {
    const { b, deps } = setUp({ "c-1": "x" }, [{ kind: "busy" }])
    queue(b.cards, "c-1", "a")
    await drain(deps, LANE)
    expect(readCards(b.cards)[0]?.place.kind).toBe("queued")
  })

  test("a send that throws writes the card back below the line, saying the host failed, and the next is taken", async () => {
    const { b, events, deps } = setUp({ "c-1": "first", "c-2": "second" }, [])
    const throwing: TakeDeps = {
      ...deps,
      send: async taken => {
        if (taken.card.id === "c-1") throw new Error("store closed")
        return deps.send(taken)
      },
    }
    queue(b.cards, "c-1", "a")
    queue(b.cards, "c-2", "b")
    await drain(throwing, LANE)
    expect(readCards(b.cards)).toEqual([
      expect.objectContaining({
        id: "c-1",
        place: { kind: "drafting", at: atEntry(E1), lane: LANE },
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
    queue(b.cards, "c-1", "a")
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
    queue(b.cards, "c-1", "a", CMD)
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
    queue(b.cards, "c-1", "a", CMD)
    await drain(deps, LANE)
    expect(events).toEqual(["hydrate c-1", `update by ${BEA}: `, "destroy c-1"])
  })

  test("nothing new: the text alone", async () => {
    const { b, events, deps } = setUp({ "c-1": "go on" }, [])
    queue(b.cards, "c-1", "a", CMD)
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
    queue(b.cards, "c-1", "a", CMD)
    queue(b.cards, "c-2", "b")
    await drain(deps, LANE)
    expect(events).toEqual([
      "hydrate c-1,c-2",
      `update by ${BEA}: keep both`,
      "destroy c-1",
      "start pineta.land",
    ])
    expect(readCards(b.cards).map(c => c.id)).toEqual(["c-2"])
  })

  test("refused: back below the line with its command, saying why, and the next card is taken", async () => {
    const { b, events, deps } = setUp({ "c-1": "x", "c-2": "next" }, [], {
      refused: "the lane has no copy of its own",
    })
    queue(b.cards, "c-1", "a", CMD)
    queue(b.cards, "c-2", "b")
    await drain(deps, LANE)
    expect(readCards(b.cards)).toEqual([
      expect.objectContaining({
        id: "c-1",
        command: CMD,
        unsent: "the lane has no copy of its own",
        place: { kind: "drafting", at: atEntry(E1), lane: LANE },
      }),
    ])
    expect(events).toContain("send c-2: next")
  })

  test("an update that throws writes the card back with its command, saying the host failed", async () => {
    const { b, deps } = setUp({ "c-1": "x" }, [])
    const throwing: TakeDeps = {
      ...deps,
      work: {
        prepareUpdate: async () => {
          throw new Error("jj broke")
        },
      },
    }
    queue(b.cards, "c-1", "a", CMD)
    await drain(throwing, LANE)
    expect(readCards(b.cards)[0]).toMatchObject({
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
    queue(b.cards, "c-1", "a", CMD)
    await drain(deps, LANE)
    expect(readCards(b.cards)[0]).toMatchObject({
      command: null,
      unsent: "pi refused",
    })
  })
})
