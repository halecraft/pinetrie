import {
  atEntry,
  type CardId,
  type CardRecord,
  cardId,
  entryId,
  laneNameForThread,
  type SentCard,
  writerId,
} from "@pineta/core"
import {
  decodePinned,
  encodePinned,
  PARTICIPANT,
  setRecord,
} from "@pineta/rules"
import { writeEntry } from "@pineta/schema"
import { describe, expect, test } from "vitest"
import type { CardPort } from "./cards.ts"
import { basics, putLane, putValue, ROOT_ID, record, row } from "./fakes.ts"
import { createPinned, waitFor } from "./pinned.ts"
import { applyPlaceSteps } from "./places.ts"

const LANE = laneNameForThread("0123456789abcdef")
const ADA = writerId("ada@x.io")
const pinnedCard = (id: string, order: string): CardRecord => ({
  id: cardId(id),
  owner: ADA,
  placer: ADA,
  place: {
    kind: "pinned",
    root: ROOT_ID,
    at: atEntry(entryId("e-1")),
    lane: LANE,
    order,
  },
  command: null,
  unsent: null,
})

function setUp(texts: Record<string, string>, port: Partial<CardPort> = {}) {
  const b = basics()
  writeEntry(b.root, row("e-1", null, { role: "user", content: "hi" }))
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
    applyPlaceSteps(
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
      "c-1": "ship it",
      "c-2": "no schema changes",
    })
    pin(pinnedCard("c-2", "b"), pinnedCard("c-1", "a"))
    const message = await readPinned(LANE, [], signal())
    expect(decodePinned(message)).toEqual({
      lane: LANE,
      cards: [
        { id: "c-1", text: "ship it", by: ADA },
        { id: "c-2", text: "no schema changes", by: ADA },
      ],
      retired: [],
    })
    expect(message?.content).toContain('<card by="Ada">\nship it\n</card>')
  })

  test("nothing when the model already reads them as they are on the lane's path", async () => {
    const { b, pin, readPinned } = setUp({ "c-1": "ship it" })
    pin(pinnedCard("c-1", "a"))
    const read = encodePinned(
      {
        lane: LANE,
        cards: [{ id: cardId("c-1"), text: "ship it", by: ADA }],
        retired: [],
      },
      () => "Ada",
      1,
    )
    writeEntry(b.root, row("e-2", "e-1", read))
    writeEntry(b.root, row("e-3", "e-2", { role: "user", content: "go" }))
    putLane(b, LANE, entryId("e-3"))
    // The card still resolves to the lane's tip, now e-3.
    expect(await readPinned(LANE, [], signal())).toBeNull()
  })

  test("a card with no text yet is left out", async () => {
    const { pin, readPinned } = setUp({ "c-1": "  " })
    pin(pinnedCard("c-1", "a"))
    expect(await readPinned(LANE, [], signal())).toBeNull()
  })

  test("it waits for each pinned card as the sender had it, and no other card", async () => {
    const { pin, readPinned, waits } = setUp({ "c-1": "ship it" })
    pin(pinnedCard("c-1", "a"))
    const seen: SentCard[] = [
      { id: cardId("c-1"), seen: "v-1" },
      { id: cardId("c-9"), seen: "v-9" },
    ]
    await readPinned(LANE, seen, signal())
    expect(waits).toEqual([["c-1", "v-1"]])
  })

  test("a text that never arrives is waited for `waitMs`, then read as the host holds it", async () => {
    const { pin, readPinned } = setUp(
      { "c-1": "ship it" },
      {
        whenHolds: (_, __, giveUp) =>
          new Promise(resolve =>
            giveUp?.addEventListener("abort", () => resolve()),
          ),
      },
    )
    pin(pinnedCard("c-1", "a"))
    const message = await readPinned(
      LANE,
      [{ id: cardId("c-1"), seen: "v-1" }],
      signal(),
    )
    expect(decodePinned(message)?.cards.map(c => c.text)).toEqual(["ship it"])
  })
})

test("waitFor: an aborted signal ends the wait at once, whatever is left", async () => {
  const stop = new AbortController()
  stop.abort()
  const started = Date.now()
  await waitFor(
    {
      whenHolds: (_, __, giveUp) =>
        new Promise(resolve => {
          if (giveUp?.aborted === true) resolve()
          giveUp?.addEventListener("abort", () => resolve())
        }),
    },
    [{ id: cardId("c-1"), seen: "v-1" }],
    60_000,
    stop.signal,
  )
  expect(Date.now() - started).toBeLessThan(1_000)
})
