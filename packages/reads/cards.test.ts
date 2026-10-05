import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  rootIdFor,
  writerId,
} from "@pineta/core"
import { encodeCard } from "@pineta/rules"
import { newPlacesDoc } from "@pineta/schema"
import { expect, test } from "vitest"
import { readPlaces, readPlacesRev } from "./index.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const card = (id: string, owner = "p-ada"): CardRecord => ({
  id: cardId(id),
  owner: writerId(owner),
  placer: writerId(owner),
  place: {
    kind: "drafting",
    root: TEST_ROOT,
    at: atEntry(entryId("e1")),
    lane: null,
  },
  carries: { kind: "message", command: null },
  unsent: null,
})

test("readPlaces: oldest first, malformed ones left out, an unchanged card the same object", () => {
  const doc = newPlacesDoc()
  doc.cards.set("c-2", encodeCard(card("c-2")))
  doc.cards.set("c-1", encodeCard(card("c-1")))
  doc.cards.set("c-3", { ...encodeCard(card("c-3")), kind: "pinned" })
  const first = readPlaces(doc)
  expect(first.map(c => c.id)).toEqual(["c-1", "c-2"])
  // A write to one card keeps every other card's object.
  doc.cards.set("c-4", encodeCard(card("c-4")))
  const second = readPlaces(doc)
  expect(second.map(c => c.id)).toEqual(["c-1", "c-2", "c-4"])
  expect(second[0]).toBe(first[0])
  expect(second[1]).toBe(first[1])
  doc.cards.set("c-1", { ...encodeCard(card("c-1")), lane: "elsewhere" })
  const third = readPlaces(doc)
  expect(third[0]).not.toBe(first[0])
  expect(third[1]).toBe(first[1])
})

test("readPlacesRev: the places document's rev, 0 before any write", () => {
  const doc = newPlacesDoc()
  expect(readPlacesRev(doc)).toBe(0)
  doc.rev.set(3)
  expect(readPlacesRev(doc)).toBe(3)
})
