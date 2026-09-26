import { batch, createDocAs, unwrap } from "@kyneta/schema"
import { noteId, writerId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  clientIdOf,
  NoteDoc,
  noteAuthors,
  noteDocId,
  noteIdOfDoc,
} from "./note.ts"

describe("clientIdOf", () => {
  test("is the clientID a Kyneta Yjs document gives its peer", () => {
    for (const peer of ["host", "p-ada", "p-bea", "client-x4bu9k2m", "日本"]) {
      const doc = createDocAs(peer, NoteDoc)
      batch(doc, d => d.text.insert(0, "x"))
      expect(unwrap(doc).clientID, peer).toBe(clientIdOf(peer))
    }
  })
})

test("noteAuthors: each writer by the clientID of its peer", () => {
  const ada = writerId("p-ada")
  expect(noteAuthors([ada]).get(clientIdOf("p-ada"))).toBe(ada)
})

test("a note's document id names its note, and no other document does", () => {
  const id = noteId("0199-note")
  expect(noteIdOfDoc(noteDocId(id))).toBe(id)
  expect(noteIdOfDoc("note:")).toBeUndefined()
  expect(noteIdOfDoc("pineta:session")).toBeUndefined()
})
