import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { batch, createDocAs, exportEntirety, merge } from "@kyneta/schema"
import { cardId } from "@pinetrie/core"
import {
  cardDocId,
  newSessionDoc,
  TextDoc,
  textVersion,
} from "@pinetrie/schema"
import { expect, test } from "vitest"
import { startCards } from "./cards.ts"

function setUp() {
  const store = createInMemoryStore()
  const exchange = new Exchange({ principal: "pinetrie-host", store })
  const cards = startCards({ exchange, store, session: newSessionDoc() })
  const id = cardId("c-1")
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
