import {
  batch,
  createDocAs,
  exportEntirety,
  merge,
  unwrap,
} from "@kyneta/schema"
import { cardId, noteId, writerId } from "@pineta/core"
import { expect, test } from "vitest"
import { cardDocId, cardIdOfDoc } from "./card.ts"
import { noteDocId, noteIdOfDoc, seatOf, TextDoc, textClients } from "./text.ts"

test("seatOf: each seat's person, by the clientID its document carries (ADR-0037)", () => {
  // Pinned to real documents, so a change in how Kyneta derives a clientID
  // from a seat fails here.
  const seats = [
    { peerId: "0f3c9a2b7d1e4f60a8b9c0d1e2f3a4b5", principal: "Ada@X.io" },
    { peerId: "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b", principal: "bea@x.io" },
    { peerId: "a1b2c3d4e5f60718293a4b5c6d7e8f90", principal: "pineta-host" },
  ]
  const authors = new Map(
    seats.flatMap(s => {
      const seat = seatOf(s.peerId, s.principal)
      return seat === null ? [] : [[seat.clientId, seat.writer] as const]
    }),
  )
  const clientIdOf = (seat: string) => {
    const doc = createDocAs(seat, TextDoc)
    batch(doc, d => d.text.insert(0, "x"))
    return unwrap(doc).clientID
  }
  expect(seats.map(s => authors.get(clientIdOf(s.peerId)))).toEqual([
    writerId("ada@x.io"),
    writerId("bea@x.io"),
    undefined,
  ])
})

test("a note's document id names its note, and no other document does", () => {
  const id = noteId("0199-note")
  expect(noteIdOfDoc(noteDocId(id))).toBe(id)
  expect(noteIdOfDoc("note:")).toBeUndefined()
  expect(noteIdOfDoc("pineta:session")).toBeUndefined()
})

test("textClients: every seat that wrote in a text, never Kyneta's seed", () => {
  const ada = createDocAs("0f3c9a2b7d1e4f60a8b9c0d1e2f3a4b5", TextDoc)
  const bea = createDocAs("9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b", TextDoc)
  expect(textClients(ada)).toEqual([])
  batch(ada, d => d.text.insert(0, "Ada. "))
  merge(bea, exportEntirety(ada))
  batch(bea, d => d.text.insert(5, "Bea."))
  expect(bea.text()).toBe("Ada. Bea.")
  expect(textClients(bea).sort()).toEqual(
    [unwrap(ada).clientID, unwrap(bea).clientID].sort(),
  )
})

test("a card's document id names its card, and no other document does", () => {
  const id = cardId("0199-card")
  expect(cardIdOfDoc(cardDocId(id))).toBe(id)
  expect(cardIdOfDoc("card:")).toBeUndefined()
  expect(cardIdOfDoc(noteDocId(noteId("0199-card")))).toBeUndefined()
})
