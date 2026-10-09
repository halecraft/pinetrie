import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { batch, createDocAs, exportEntirety, merge } from "@kyneta/schema"
import {
  atEntry,
  entryId,
  type TextCard,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardDocId, TextDoc, textVersion } from "@pinetrie/schema"
import { newSessionDoc } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { startCards } from "./cards.ts"

const ADA = writerId("ada@x.io")

function setUp() {
  const store = createInMemoryStore()
  const exchange = new Exchange({ principal: "pinetrie-host", store })
  const cards = startCards({ exchange, store, session: newSessionDoc() })
  const id = textCardId("c-1")
  const ada = createDocAs("0f3c9a2b7d1e4f60a8b9c0d1e2f3a4b5", TextDoc)
  batch(ada, d => d.text.insert(0, "ship it"))
  const arrive = () =>
    merge(exchange.get(cardDocId(id), TextDoc), exportEntirety(ada))
  return { cards, id, seen: textVersion(ada), arrive }
}

const settled = async (p: Promise<void>) => {
  let done = false
  void p.then(() => {
    done = true
  })
  await new Promise(resolve => setImmediate(resolve))
  return done
}

test("whenHolds resolves once the text arrives", async () => {
  const { cards, id, seen, arrive } = setUp()
  const wait = cards.whenHolds(id, seen)
  expect(await settled(wait)).toBe(false)
  arrive()
  expect(await settled(wait)).toBe(true)
})

test("an aborted whenHolds resolves, and a signal aborted first resolves at once", async () => {
  const { cards, id, seen } = setUp()
  const giveUp = new AbortController()
  const wait = cards.whenHolds(id, seen, giveUp.signal)
  expect(await settled(wait)).toBe(false)
  giveUp.abort()
  expect(await settled(wait)).toBe(true)
  expect(await settled(cards.whenHolds(id, seen, giveUp.signal))).toBe(true)
})

test("blankQueued: a queued card made empty is blank; one queued with text is not, before its text arrives or after (ADR-0113)", async () => {
  const { cards, id, seen, arrive } = setUp()
  const queuedAs = (card: string, s: string): TextCard => ({
    kind: "text",
    id: textCardId(card),
    owner: ADA,
    placer: ADA,
    place: {
      kind: "queued",
      at: atEntry(entryId("e-1")),
      thread: threadIdFor("x"),
      order: "a",
      by: ADA,
      seen: s,
    },
    carries: { kind: "message", command: null },
    unsent: null,
  })
  const queue = [queuedAs("c-0", ""), queuedAs(id, seen)]
  expect([...(await cards.blankQueued(queue))]).toEqual([textCardId("c-0")])
  arrive()
  expect([...(await cards.blankQueued(queue))]).toEqual([textCardId("c-0")])
})
