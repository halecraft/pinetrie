import {
  batch,
  createDocAs,
  exportEntirety,
  merge,
  unwrap,
} from "@kyneta/schema"
import { writerId } from "@pinetrie/core"
import { textCardId } from "@pinetrie/threads"
import { expect, test } from "vitest"
import { cardDocId, cardIdOfDoc } from "./places.ts"
import {
  seatIdentity,
  TextDoc,
  textClients,
  textHolds,
  textVersion,
} from "./text.ts"

test("seatIdentity: each seat's person, by the clientID its document carries", () => {
  // Pinned to real documents, so a change in how Kyneta derives a clientID
  // from a seat fails here.
  const seats = [
    { peerId: "0f3c9a2b7d1e4f60a8b9c0d1e2f3a4b5", principal: "Ada@X.io" },
    { peerId: "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b", principal: "bea@x.io" },
    { peerId: "a1b2c3d4e5f60718293a4b5c6d7e8f90", principal: "pinetrie-host" },
  ]
  const authors = new Map(
    seats.flatMap(s => {
      const seat = seatIdentity(s.peerId, s.principal)
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
  const id = textCardId("0199-card")
  expect(cardIdOfDoc(cardDocId(id))).toBe(id)
  expect(cardIdOfDoc("card:")).toBeUndefined()
  expect(cardIdOfDoc("note:0199-card")).toBeUndefined()
})

test("textHolds: a copy holds a version once every write in it has arrived, others' later writes included", () => {
  const ada = createDocAs("0f3c9a2b7d1e4f60a8b9c0d1e2f3a4b5", TextDoc)
  const host = createDocAs("a1b2c3d4e5f60718293a4b5c6d7e8f90", TextDoc)
  const bea = createDocAs("9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b", TextDoc)
  batch(ada, d => d.text.insert(0, "Ada."))
  const queued = textVersion(ada)
  expect(textHolds(host, queued)).toBe(false)
  // Bea's write arrives first: still not Ada's.
  batch(bea, d => d.text.insert(0, "Bea. "))
  merge(host, exportEntirety(bea))
  expect(textHolds(host, queued)).toBe(false)
  merge(host, exportEntirety(ada))
  expect(textHolds(host, queued)).toBe(true)
  expect(textHolds(host, "")).toBe(true)
})
