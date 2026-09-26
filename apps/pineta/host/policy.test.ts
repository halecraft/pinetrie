import { type NoteState, noteId } from "@pineta/core"
import { PRESENCE_DOC_ID, SESSION_DOC_ID } from "@pineta/protocol/messages"
import { noteDocId } from "@pineta/schema"
import { expect, test } from "vitest"
import { acceptsWrite } from "./policy.ts"

const none = () => undefined

test("acceptsWrite: the session is the host's; presence is each client's", () => {
  expect(acceptsWrite(SESSION_DOC_ID, none)).toBe(false)
  expect(acceptsWrite(PRESENCE_DOC_ID, none)).toBe(true)
  expect(acceptsWrite("line:pineta.control:a→host", none)).toBeUndefined()
})

test("acceptsWrite: a note's text while it is a draft or open; not done, not unrecorded", () => {
  const id = noteId("n-1")
  const at = (state: NoteState | undefined) =>
    acceptsWrite(noteDocId(id), n => (n === id ? state : undefined))
  expect(at("draft")).toBe(true)
  expect(at("open")).toBe(true)
  expect(at("done")).toBe(false)
  expect(at(undefined)).toBe(false)
})
