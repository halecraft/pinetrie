import {
  rootIdFor,
  type TextCard,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { encodeCard } from "@pinetrie/rules"
import { newPlacesDoc } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { readPlaces, readPlacesRev } from "./index.ts"

const TEST_THREAD = threadIdFor("e")
const _TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const card = (id: string, owner = "p-ada"): TextCard => ({
  kind: "text",
  id: textCardId(id),
  owner: writerId(owner),
  placer: writerId(owner),
  place: {
    kind: "composing",
    thread: TEST_THREAD,
  },
  content: { command: null, unsent: null, origin: null },
})

test("readPlaces: oldest first, malformed ones left out, an unchanged card the same object", () => {
  const doc = newPlacesDoc()
  doc.cards.set(cardIdFor("c2"), encodeCard(card(cardIdFor("c2"))))
  doc.cards.set(cardIdFor("c1"), encodeCard(card(cardIdFor("c1"))))
  doc.cards.set(cardIdFor("c3"), {
    ...encodeCard(card(cardIdFor("c3"))),
    kind: "pinned",
  })
  const first = readPlaces(doc)
  expect(first.map(c => c.id)).toEqual([cardIdFor("c1"), cardIdFor("c2")])
  // A write to one card keeps every other card's object.
  doc.cards.set(cardIdFor("c4"), encodeCard(card(cardIdFor("c4"))))
  const second = readPlaces(doc)
  expect(second.map(c => c.id)).toEqual([
    cardIdFor("c1"),
    cardIdFor("c2"),
    cardIdFor("c4"),
  ])
  expect(second[0]).toBe(first[0])
  expect(second[1]).toBe(first[1])
  doc.cards.set(cardIdFor("c1"), {
    ...encodeCard(card(cardIdFor("c1"))),
    lane: threadIdFor("elsewhere"),
  })
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
