import {
  type CardId,
  type CardRecord,
  entryId,
  type SentCard,
  type TextCard,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import {
  decodePinned,
  encodePinned,
  PARTICIPANT,
  setRecord,
} from "@pinetrie/rules"
import { writeEntry } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import type { CardPort } from "./cards.ts"
import {
  basics,
  putLane,
  putValue,
  record,
  row,
  seedPlaces,
  threadRow,
} from "./fakes.ts"
import { createPinned, waitFor } from "./pinned.ts"

const LANE = threadIdFor("0123456789abcdef")
const ADA = writerId("ada@x.io")
const pinnedCard = (id: string, order: string): TextCard => ({
  kind: "text",
  id: textCardId(id),
  owner: ADA,
  placer: ADA,
  place: {
    kind: "pinned",
    thread: LANE,
    order,
  },
  content: { command: null, unsent: null, origin: null },
})

function setUp(texts: Record<string, string>, port: Partial<CardPort> = {}) {
  const b = basics()
  writeEntry(b.root, threadRow("e-1", null, LANE))
  putLane(b, LANE, entryId("e-1"))
  putValue(b, setRecord(PARTICIPANT, { writer: ADA, name: "Ada" }))
  const waits: [CardId, string][] = []
  const cards = record<Pick<CardPort, "hydrate" | "textNow" | "whenHolds">>({
    hydrate: async () => {},
    textNow: id => texts[id] ?? "",
    whenHolds: async (id, seen) => {
      waits.push([id, seen])
    },
    ...port,
  })
  const pin = (...cs: CardRecord[]) =>
    seedPlaces(
      b.places,
      cs.map(record => ({ kind: "write", record })),
    )
  const { readPinned } = createPinned({
    basics: b,
    cards: cards.port,
    waitMs: 20,
  })
  return { b, pin, readPinned, waits }
}

const signal = () => new AbortController().signal

describe("readPinned: what a run reads of its pinned cards", () => {
  test("the thread's pinned cards in order, named by their owner, as one cards entry", async () => {
    const { pin, readPinned } = setUp({
      [cardIdFor("c1")]: "ship it",
      [cardIdFor("c2")]: "no schema changes",
    })
    pin(pinnedCard(cardIdFor("c2"), "b"), pinnedCard(cardIdFor("c1"), "a"))
    const message = await readPinned(LANE, [], signal())
    expect(decodePinned(message)).toEqual({
      lane: LANE,
      cards: [
        {
          id: cardIdFor("c1"),
          text: "ship it",
          by: ADA,
        },
        {
          id: cardIdFor("c2"),
          text: "no schema changes",
          by: ADA,
        },
      ],
      retired: [],
    })
    expect(message?.content).toContain('<card by="Ada">\nship it\n</card>')
  })

  test("nothing when the model already reads them as they are on the lane's path", async () => {
    const { b, pin, readPinned } = setUp({
      [cardIdFor("c1")]: "ship it",
    })
    pin(pinnedCard(cardIdFor("c1"), "a"))
    const read = encodePinned(
      {
        lane: LANE,
        cards: [
          {
            id: cardIdFor("c1"),
            text: "ship it",
            by: ADA,
          },
        ],
        retired: [],
      },
      () => "Ada",
      1,
    )
    writeEntry(b.root, row("e-2", "e-1", read, LANE))
    writeEntry(b.root, row("e-3", "e-2", { role: "user", content: "go" }, LANE))
    putLane(b, LANE, entryId("e-3"))
    // The card still resolves to the lane's tip, now e-3.
    expect(await readPinned(LANE, [], signal())).toBeNull()
  })

  test("a card with no text yet is left out", async () => {
    const { pin, readPinned } = setUp({
      [cardIdFor("c1")]: "  ",
    })
    pin(pinnedCard(cardIdFor("c1"), "a"))
    expect(await readPinned(LANE, [], signal())).toBeNull()
  })

  test("it waits for each pinned card as the sender had it, and no other card", async () => {
    const { pin, readPinned, waits } = setUp({
      [cardIdFor("c1")]: "ship it",
    })
    pin(pinnedCard(cardIdFor("c1"), "a"))
    const seen: SentCard[] = [
      { id: cardIdFor("c1"), seen: "v-1" },
      { id: cardIdFor("c9"), seen: "v-9" },
    ]
    await readPinned(LANE, seen, signal())
    expect(waits).toEqual([[cardIdFor("c1"), "v-1"]])
  })

  test("a text that never arrives is waited for `waitMs`, then read as the host holds it", async () => {
    const { pin, readPinned } = setUp(
      { [cardIdFor("c1")]: "ship it" },
      {
        whenHolds: (_, __, giveUp) =>
          new Promise(resolve =>
            giveUp?.addEventListener("abort", () => resolve()),
          ),
      },
    )
    pin(pinnedCard(cardIdFor("c1"), "a"))
    const message = await readPinned(
      LANE,
      [{ id: cardIdFor("c1"), seen: "v-1" }],
      signal(),
    )
    expect(decodePinned(message)?.cards.map(c => c.text)).toEqual(["ship it"])
  })
})

test("waitFor: an aborted signal hands whenHolds a signal already aborted", async () => {
  const stop = new AbortController()
  stop.abort()
  const given: boolean[] = []
  await waitFor(
    {
      whenHolds: (_, __, giveUp) => {
        given.push(giveUp?.aborted === true)
        return Promise.resolve()
      },
    },
    [{ id: cardIdFor("c1"), seen: "v-1" }],
    60_000,
    stop.signal,
  )
  expect(given).toEqual([true])
})
