import { cardId, type NoteState, noteId } from "@pineta/core"
import {
  CARDS_DOC_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { cardDocId, noteDocId } from "@pineta/schema"
import { expect, test } from "vitest"
import { acceptsWrite, resolveDoc, writePolicy } from "./policy.ts"

const none = () => undefined
const CARD = cardDocId(cardId("c-1"))
const UNDO = "undo:seat-a"

test("acceptsWrite: the session is the host's; presence is each client's", () => {
  expect(acceptsWrite(SESSION_DOC_ID, none)).toBe(false)
  expect(acceptsWrite(PRESENCE_DOC_ID, none)).toBe(true)
  expect(acceptsWrite("line:pineta.control:a→host", none)).toBeUndefined()
})

test("acceptsWrite: a note's text while it is open; not done, not unrecorded", () => {
  const id = noteId("n-1")
  const at = (state: NoteState | undefined) =>
    acceptsWrite(noteDocId(id), n => (n === id ? state : undefined))
  expect(at("open")).toBe(true)
  expect(at("done")).toBe(false)
  expect(at(undefined)).toBe(false)
})

test("acceptsWrite: cards are written by clients; an undo stack is refused (ADR-0048)", () => {
  expect(acceptsWrite(CARDS_DOC_ID, none)).toBe(true)
  expect(acceptsWrite(CARD, none)).toBe(true)
  expect(acceptsWrite(UNDO, none)).toBe(false)
})

test("resolveDoc: the cards document, a card's text, a tab's undo stack, and nothing else", () => {
  expect(resolveDoc(CARDS_DOC_ID)).toBe("cards")
  expect(resolveDoc(CARD)).toBe("text")
  expect(resolveDoc(UNDO)).toBe("reject")
  for (const other of [
    SESSION_DOC_ID,
    PRESENCE_DOC_ID,
    noteDocId(noteId("n-1")),
    "line:pineta.control:a→host",
    "card:",
  ])
    expect(resolveDoc(other)).toBeUndefined()
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

test("a tab's undo stack is shared with no one and taken from no one; cards with everyone", () => {
  const policy = writePolicy(none)
  const peer = { peerId: "seat-a", principal: "x@y.io", type: "user" } as const
  expect([
    policy.canShare?.(UNDO, peer),
    policy.canAccept?.(UNDO, peer),
    policy.canShare?.(CARDS_DOC_ID, peer),
    policy.canShare?.(CARD, peer),
  ]).toEqual([false, false, undefined, undefined])
})
