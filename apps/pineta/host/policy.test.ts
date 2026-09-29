import { type NoteState, noteId } from "@pineta/core"
import { PRESENCE_DOC_ID, SESSION_DOC_ID } from "@pineta/protocol/messages"
import { noteDocId } from "@pineta/schema"
import { expect, test } from "vitest"
import { acceptsWrite, writePolicy } from "./policy.ts"

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

test("a command Line's documents are shared with, and taken from, its two ends only (ADR-0037)", () => {
  const policy = writePolicy(none)
  const line = "line:pineta.control:seat-a→seat-host"
  const peer = (peerId: string) =>
    ({ peerId, principal: "x@y.io", type: "user" }) as const
  expect([
    policy.canShare?.(line, peer("seat-a")),
    policy.canShare?.(line, peer("seat-b")),
    policy.canAccept?.(line, peer("seat-b")),
    policy.canShare?.(SESSION_DOC_ID, peer("seat-b")),
  ]).toEqual([true, false, false, undefined])
})
