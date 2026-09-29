import { batch, createDocAs, unwrap } from "@kyneta/schema"
import { noteId, writerId } from "@pineta/core"
import { expect, test } from "vitest"
import { NoteDoc, noteAuthors, noteDocId, noteIdOfDoc } from "./note.ts"

test("noteAuthors: each seat's person, by the clientID its document carries (ADR-0037)", () => {
  // Pinned to real documents, so a change in how Kyneta derives a clientID
  // from a seat fails here.
  const seats = [
    { peerId: "0f3c9a2b7d1e4f60a8b9c0d1e2f3a4b5", principal: "Ada@X.io" },
    { peerId: "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b", principal: "bea@x.io" },
    { peerId: "a1b2c3d4e5f60718293a4b5c6d7e8f90", principal: "pineta-host" },
  ]
  const authors = noteAuthors(seats)
  const clientIdOf = (seat: string) => {
    const doc = createDocAs(seat, NoteDoc)
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
