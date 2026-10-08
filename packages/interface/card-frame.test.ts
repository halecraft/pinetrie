import {
  atEntry,
  type CardPlace,
  type CardRecord,
  cardId,
  entryId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type CardFrameFacts,
  type CardTone,
  cardFace,
  cardFaceWords,
  cardFrame,
  cardFrameWords,
  moveWords,
} from "./card-frame.ts"
import { TEST_ROOT } from "./fixtures.ts"

const ME = writerId("ada@x.test")
const BEA = writerId("bea@x.test")
const READER = { me: ME, nameOf: new Map([[BEA, "Bea"]]) }
const CATCH_UPS = { base: { kind: "accepted" }, parent: null } as const
const LANE = threadIdFor("x")
const at = atEntry(entryId("e-1"))
const C1 = cardId("c-1")

const card = (
  place: CardPlace,
  over: Partial<CardRecord> = {},
): CardRecord => ({
  id: C1,
  owner: ME,
  placer: ME,
  place,
  carries: { kind: "message", command: null },
  unsent: null,
  ...over,
})
const FACTS: CardFrameFacts = {
  me: ME,
  queueOn: { lane: LANE, at },
  readOnly: false,
}

const composing: CardPlace = {
  kind: "composing",
  root: TEST_ROOT,
  at,
  lane: LANE,
}
const note: CardPlace = {
  kind: "note",
  root: TEST_ROOT,
  at,
  lane: LANE,
  cell: 0,
}
const queued: CardPlace = {
  kind: "queued",
  root: TEST_ROOT,
  at,
  lane: LANE,
  order: "a",
  by: BEA,
  seen: "",
}
const pinned: CardPlace = {
  kind: "pinned",
  root: TEST_ROOT,
  at,
  lane: LANE,
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
const take = { kind: "takeIntoInventory", card: C1 } as const

describe("cardFrame (ADR-0111)", () => {
  test.each<[string, CardPlace, CardTone, readonly unknown[]]>([
    [
      "your message: the notes, the queue, pinned, your inventory",
      composing,
      "composing",
      [
        { to: "note", act: { kind: "toNote", card: C1 } },
        { to: "queue", act: queue },
        { to: "pinned", act: pin },
        { to: "inventory", act: take },
      ],
    ],
    [
      "a note: your message, the queue, pinned, your inventory",
      note,
      "note",
      [
        { to: "message", act: { kind: "toMessage", card: C1 } },
        { to: "queue", act: queue },
        { to: "pinned", act: pin },
        { to: "inventory", act: take },
      ],
    ],
    [
      "queued: the notes, pinned, your inventory",
      queued,
      "queued",
      [
        {
          to: "note",
          act: { kind: "unqueue", card: C1, lane: LANE, by: BEA },
        },
        { to: "pinned", act: pin },
        { to: "inventory", act: take },
      ],
    ],
    [
      "pinned: the notes, the queue, your inventory",
      pinned,
      "pinned",
      [
        { to: "note", act: { kind: "unpin", card: C1 } },
        { to: "queue", act: queue },
        { to: "inventory", act: take },
      ],
    ],
    [
      "in a fresh column: your inventory",
      { kind: "fresh", column: "k", root: TEST_ROOT, at },
      "composing",
      [{ to: "inventory", act: take }],
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
      "message",
      "pinned",
      "inventory",
    ])
    expect(
      cardFrame(card(pinned), "pinned", facts).moves.map(m => m.to),
    ).toEqual(["note", "inventory"])
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
    expect(cardFrameWords(view, READER, CATCH_UPS, [])).toMatchObject({
      icon: "⚑",
      place: "pinned",
      state: null,
      who: null,
    })
  })

  test("a read-only column, or a fact, moves and discards nothing", () => {
    const read = cardFrame(card(queued), "queued", { ...FACTS, readOnly: true })
    expect(read).toMatchObject({ moves: [], tools: [], discards: false })
    const fact = card(queued, {
      carries: {
        kind: "fact",
        fact: {
          kind: "accepted",
          lane: LANE,
          by: ME,
          as: "kabcdefg",
          bookmark: "pinetrie-accepted",
          to: { kind: "accepted" },
        },
      },
    })
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
    const other = { ...card(queued), id: cardId("c-2") }
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
      CATCH_UPS,
      [],
    )
  const second = { ...card(queued), id: cardId("c-0") }

  test.each([
    ["the top of the queue is next", [card(queued)], false, "next", "1"],
    [
      "then its place in line",
      [second, card(queued)],
      false,
      "2nd in line",
      "2",
    ],
    ["held, it says so", [card(queued)], true, "held · next", "1"],
  ])("a queued card's state: %s", (_, among, held, state, icon) => {
    expect(words(card(queued), "queued", { among, held })).toMatchObject({
      state,
      icon,
      place: "queued",
      who: "queued by Bea",
    })
  })

  test("a pinned card says who pinned it and how the agent read it", () => {
    expect(
      words(card(pinned, { placer: BEA }), "pinned", { pinned: "changed" }),
    ).toMatchObject({
      who: "pinned by Bea",
      state: "changed since the agent last read it",
    })
  })

  test("a note: yours names nobody, another's its owner and who else wrote; not sent says why", () => {
    expect(
      words(card(note, { unsent: "no such image" }), "note"),
    ).toMatchObject({
      icon: "▭",
      place: "note",
      who: null,
      state: "not sent: no such image",
    })
    expect(words(card(note, { owner: BEA }), "note").who).toBe("Bea's note")
    expect(
      cardFrameWords(
        cardFrame(card(note, { owner: BEA }), "note", FACTS),
        READER,
        CATCH_UPS,
        [BEA, ME],
      ).who,
    ).toBe("Bea's note · with ada")
  })

  test("your message names nobody: only you see it", () => {
    expect(words(card(composing), "composing")).toMatchObject({
      icon: "✎",
      place: "your message",
      who: null,
    })
  })

  test("in your inventory, a command has no thread to name: no chip", () => {
    const c = card(
      { kind: "inventory", holder: ME },
      { carries: { kind: "message", command: "bring-up-to-date" } },
    )
    expect(
      cardFrameWords(cardFrame(c, "inventory", FACTS), READER, null, [])
        .command,
    ).toBeNull()
  })

  test("a command is a chip, what it does its title", () => {
    const c = card(queued, {
      carries: { kind: "message", command: "bring-up-to-date" },
    })
    expect(words(c, "queued").command).toEqual({
      label: "catch up with accepted work",
      title: "↓ catches up with accepted work first, then sends what you write",
    })
  })

  test("each move has its words", () => {
    expect(moveWords("inventory").label).toBe("Move to your inventory")
    expect(moveWords("note").label).toBe("Move to notes")
    expect(moveWords("message").label).toBe("Move to your message")
  })
})

describe("cardFace (ADR-0113)", () => {
  test("its first three lines, leading blank lines left out; a short command chip; whose", () => {
    const c = card(note, {
      owner: BEA,
      carries: { kind: "message", command: "bring-up-to-date" },
    })
    const face = cardFace(c, "\n\none\ntwo\nthree\nfour", {
      tone: "note",
      key: null,
    })
    expect(face).toEqual({
      tone: "note",
      owner: BEA,
      command: "bring-up-to-date",
      lines: "one\ntwo\nthree",
      key: null,
    })
    expect(cardFaceWords(face, READER)).toEqual({
      icon: "▭",
      command: "catch up",
      owner: "Bea",
    })
  })
})
