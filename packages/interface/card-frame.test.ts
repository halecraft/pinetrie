import {
  atEntry,
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  entryId,
  entryMargin,
  type Sha256,
  type TextCard,
  type TextPlace,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  type CardFrameFacts,
  type CardTone,
  cardFrame,
  cardFrameWords,
  moveWords,
} from "./card-frame.ts"

const TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const ME = writerId("ada@x.test")
const BEA = writerId("bea@x.test")
const READER = { me: ME, nameOf: new Map([[BEA, "Bea"]]) }
const GET_LATESTS = { base: { kind: "accepted" }, parent: null } as const
const LANE = threadIdFor("x")
const at = atEntry(entryId("e-1"))
const C1 = cardIdFor("c1")

const card = (place: TextPlace, over: Partial<TextCard> = {}): TextCard => ({
  kind: "text",
  id: C1,
  owner: ME,
  placer: ME,
  place,
  content: { command: null, unsent: null, origin: null },
  ...over,
})
const FACTS: CardFrameFacts = {
  me: ME,
  queueOn: { lane: LANE, at },
  readOnly: false,
}

const composing: TextPlace = {
  kind: "composing",
  thread: LANE,
}
const note: TextPlace = {
  kind: "note",
  column: cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a1"),
  order: "a",
}
const queued: TextPlace = {
  kind: "queued",
  thread: LANE,
  order: "a",
  by: BEA,
  seen: "",
}
const pinned: TextPlace = {
  kind: "pinned",
  thread: LANE,
  order: "a",
}
const queue = {
  kind: "queue",
  card: C1,
  lane: LANE,
  at,
  hold: "keep",
} as const
const pin = { kind: "pin", card: C1 } as const
const take = { kind: "putAway", card: C1 } as const
const pinCanvas = { kind: "pinToCanvas", card: C1 } as const

describe("cardFrame", () => {
  test.each<[string, TextPlace, CardTone, readonly unknown[]]>([
    [
      "your message: the notes, the queue, pinned, the canvas, your inventory",
      composing,
      "composing",
      [
        { to: "note", act: { kind: "toNote", card: C1 } },
        { to: "queue", act: queue },
        { to: "pinned", act: pin },
        { to: "canvas", act: pinCanvas },
        { to: "inventory", act: take },
      ],
    ],
    [
      "a note: the canvas, your inventory, its note column being no thread's",
      note,
      "note",
      [
        { to: "canvas", act: pinCanvas },
        { to: "inventory", act: take },
      ],
    ],
    [
      "queued: the notes, pinned, the canvas, your inventory",
      queued,
      "queued",
      [
        {
          to: "note",
          act: { kind: "unqueue", card: C1, lane: LANE, by: BEA },
        },
        { to: "pinned", act: pin },
        { to: "canvas", act: pinCanvas },
        { to: "inventory", act: take },
      ],
    ],
    [
      "pinned: the notes, the queue, the canvas, your inventory",
      pinned,
      "pinned",
      [
        { to: "note", act: { kind: "unpin", card: C1 } },
        { to: "queue", act: queue },
        { to: "canvas", act: pinCanvas },
        { to: "inventory", act: take },
      ],
    ],
    [
      "pinned to the canvas: the notes, your inventory",
      { kind: "canvas-pinned", canvas: TEST_CANVAS, order: "a" },
      "pinned",
      [
        { to: "note", act: { kind: "unpin", card: C1 } },
        { to: "inventory", act: take },
      ],
    ],
    [
      "a comment: a reference queued on its thread, which leaves it where it is; your inventory",
      {
        kind: "margin",
        on: entryMargin(LANE, entryId("e-1")),
        order: "a",
        seen: "",
      },
      "note",
      [
        {
          to: "reference",
          act: {
            kind: "queueReference",
            card: C1,
            entry: entryId("e-1"),
            thread: LANE,
          },
        },
        { to: "inventory", act: take },
      ],
    ],
    [
      "in your inventory: none, put is its primary",
      { kind: "inventory", holder: ME },
      "inventory",
      [],
    ],
  ])("Move to ▸ %s", (_, place, tone, moves) => {
    expect(cardFrame(card(place), tone, FACTS).moves).toEqual(moves)
  })

  test("no queue where the column has none to queue on", () => {
    const facts = { ...FACTS, queueOn: null }
    expect(cardFrame(card(note), "note", facts).moves.map(m => m.to)).toEqual([
      "canvas",
      "inventory",
    ])
    expect(
      cardFrame(card(pinned), "pinned", facts).moves.map(m => m.to),
    ).toEqual(["note", "canvas", "inventory"])
  })

  test.each<[string, CardTone, "put" | "send" | null]>([
    ["your inventory puts", "inventory", "put"],
    ["your message sends", "composing", "send"],
    ["a note has none: it is for people", "note", null],
    ["a queued card has none: the queue's controls send it", "queued", null],
    ["a pinned card has none", "pinned", null],
  ])("the primary: %s", (_, tone, primary) => {
    expect(cardFrame(null, tone, FACTS).primary).toBe(primary)
  })

  test("with no card yet: its tone and place, nothing to move or discard", () => {
    const view = cardFrame(null, "pinned", FACTS)
    expect(view).toMatchObject({
      tone: "pinned",
      state: { kind: "none" },
      moves: [],
      tools: [],
      discards: false,
    })
    expect(cardFrameWords(view, READER, GET_LATESTS, [])).toMatchObject({
      place: "pinned",
      state: null,
      who: null,
    })
  })

  test("a queued reference's ⋯ offers only the moves its kind may make, never a pin", () => {
    const id = cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e1")
    const reference: CardRecord = {
      kind: "reference",
      id,
      owner: ME,
      placer: ME,
      place: queued as Extract<TextPlace, { kind: "queued" }>,
      content: {
        address: { kind: "thread", thread: LANE },
        quote: "0".repeat(64) as Sha256,
      },
    }
    const view = cardFrame(reference, "queued", {
      ...FACTS,
      among: [reference, card(queued)],
    })
    expect(view.moves).toEqual([
      { to: "note", act: { kind: "unqueue", card: id, lane: LANE, by: BEA } },
      { to: "inventory", act: { kind: "putAway", card: id } },
    ])
    expect(view.discards).toBe(true)
    expect(view.tools.map(t => t.act?.kind ?? null)).toEqual([null, "reorder"])
  })

  test("a read-only column, or a fact, moves and discards nothing", () => {
    const read = cardFrame(card(queued), "queued", { ...FACTS, readOnly: true })
    expect(read).toMatchObject({ moves: [], tools: [], discards: false })
    const fact: CardRecord = {
      kind: "fact",
      id: cardIdOfKind("fact", "01a0ffd2-0000-7000-8000-0000000000f1"),
      owner: ME,
      placer: ME,
      place: { kind: "queued", thread: LANE, order: "a", by: ME, seen: "" },
      content: {
        fact: {
          kind: "accepted",
          lane: LANE,
          by: ME,
          as: "kabcdefg",
          bookmark: "pinetrie-accepted",
          to: { kind: "accepted" },
        },
      },
    }
    expect(cardFrame(fact, "queued", FACTS)).toMatchObject({
      moves: [],
      discards: false,
    })
  })

  test("someone else's inventory card is not yours to discard", () => {
    const theirs = card({ kind: "inventory", holder: BEA })
    expect(cardFrame(theirs, "inventory", FACTS).discards).toBe(false)
    const mine = card({ kind: "inventory", holder: ME }, { owner: BEA })
    expect(cardFrame(mine, "inventory", FACTS).discards).toBe(true)
  })

  test("↑ and ↓ in a list, each off at its edge", () => {
    const other = {
      ...card(queued),
      id: cardIdFor("c2"),
    }
    const view = cardFrame(card(queued), "queued", {
      ...FACTS,
      among: [card(queued), other],
    })
    expect(view.tools).toEqual([
      { step: -1, act: null },
      {
        step: 1,
        act: { kind: "reorder", card: C1, among: [C1, other.id], step: 1 },
      },
    ])
  })
})

describe("cardFrameWords", () => {
  const words = (
    c: CardRecord,
    tone: CardTone,
    facts: Partial<CardFrameFacts> = {},
  ) =>
    cardFrameWords(
      cardFrame(c, tone, { ...FACTS, ...facts }),
      READER,
      GET_LATESTS,
      [],
    )
  const second = {
    ...card(queued),
    id: cardIdFor("c0"),
  }

  test.each([
    ["the top of the queue is next", [card(queued)], false, "next"],
    ["then its place in line", [second, card(queued)], false, "2nd in line"],
    ["held, it says so", [card(queued)], true, "held · next"],
  ])("a queued card's state: %s", (_, among, held, state) => {
    expect(words(card(queued), "queued", { among, held })).toMatchObject({
      state,
      place: "queued",
      who: "by Bea",
    })
  })

  test("a pinned card says who pinned it and how the agent read it", () => {
    expect(
      words(card(pinned, { placer: BEA }), "pinned", { pinned: "changed" }),
    ).toMatchObject({
      who: "by Bea",
      state: "changed since the agent last read it",
    })
  })

  test("a note: yours names nobody, another's its owner and who else wrote; not sent says why", () => {
    expect(
      words(
        card(note, {
          content: { command: null, unsent: "no such image", origin: null },
        }),
        "note",
      ),
    ).toMatchObject({
      place: "note",
      who: null,
      state: "not sent: no such image",
    })
    expect(words(card(note, { owner: BEA }), "note").who).toBe("Bea's note")
    expect(
      cardFrameWords(
        cardFrame(card(note, { owner: BEA }), "note", FACTS),
        READER,
        GET_LATESTS,
        [BEA, ME],
      ).who,
    ).toBe("Bea's note · with ada")
  })

  test("your message names nobody: only you see it", () => {
    expect(words(card(composing), "composing")).toMatchObject({
      place: "your message",
      who: null,
    })
  })

  test("in your inventory, a command has no thread to name: no chip", () => {
    const c = card(
      { kind: "inventory", holder: ME },
      { content: { command: "get-latest", unsent: null, origin: null } },
    )
    expect(
      cardFrameWords(cardFrame(c, "inventory", FACTS), READER, null, [])
        .command,
    ).toBeNull()
  })

  test("a command is a chip, what it does its title", () => {
    const c = card(queued, {
      content: { command: "get-latest", unsent: null, origin: null },
    })
    expect(words(c, "queued").command).toEqual({
      label: "get the latest",
      title:
        "↓ gets the latest from accepted work first, then sends what you write",
    })
  })

  test("each move has its words", () => {
    expect(moveWords("inventory").label).toBe("Move to your inventory")
    expect(moveWords("note").label).toBe("Move to notes")
    expect(moveWords("message").label).toBe("Move to your message")
  })
})
