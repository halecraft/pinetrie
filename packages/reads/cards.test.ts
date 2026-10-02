import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  writerId,
} from "@pineta/core"
import { encodeCard } from "@pineta/marginalia"
import { newCardsDoc } from "@pineta/schema"
import { expect, test } from "vitest"
import { readCards } from "./index.ts"

const card = (id: string, owner = "p-ada"): CardRecord => ({
  id: cardId(id),
  owner: writerId(owner),
  place: { kind: "drafting", at: atEntry(entryId("e1")), lane: null },
  command: null,
  unsent: null,
})

test("readCards: oldest first, malformed ones left out, an unchanged card the same object", () => {
  const doc = newCardsDoc()
  doc.cards.set("c-2", encodeCard(card("c-2")))
  doc.cards.set("c-1", encodeCard(card("c-1")))
  doc.cards.set("c-3", { ...encodeCard(card("c-3")), kind: "pinned" })
  const first = readCards(doc)
  expect(first.map(c => c.id)).toEqual(["c-1", "c-2"])
  doc.cards.set("c-4", encodeCard(card("c-4")))
  const second = readCards(doc)
  expect(second.map(c => c.id)).toEqual(["c-1", "c-2", "c-4"])
  expect(second[0]).toBe(first[0])
  doc.cards.at("c-1")?.lane.set("elsewhere")
  expect(readCards(doc)[0]).not.toBe(first[0])
})
