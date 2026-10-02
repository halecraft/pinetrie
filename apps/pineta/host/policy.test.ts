import { cardId, writerId } from "@pineta/core"
import {
  PLACES_DOC_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { cardDocId, inventoryDocId } from "@pineta/schema"
import { expect, test } from "vitest"
import { acceptsWrite, resolveDoc, writePolicy } from "./policy.ts"

const CARD = cardDocId(cardId("c-1"))
const UNDO = "undo:seat-a"
const INVENTORY = inventoryDocId(writerId("ada@x.io"))

test("acceptsWrite: the session and the places are the host's; presence is each client's", () => {
  expect(acceptsWrite(SESSION_DOC_ID)).toBe(false)
  expect(acceptsWrite(PLACES_DOC_ID)).toBe(false)
  expect(acceptsWrite(PRESENCE_DOC_ID)).toBe(true)
  expect(acceptsWrite("line:pineta.control:a→host")).toBeUndefined()
})

test("acceptsWrite: cards' texts are written by clients; an undo stack is refused (ADR-0048)", () => {
  expect(acceptsWrite(CARD)).toBe(true)
  expect(acceptsWrite(UNDO)).toBe(false)
})

test("resolveDoc: a card's text, an inventory, a tab's undo stack, and nothing else", () => {
  expect(resolveDoc(CARD)).toBe("text")
  expect(resolveDoc(INVENTORY)).toBe("inventory")
  expect(resolveDoc(UNDO)).toBe("reject")
  for (const other of [
    SESSION_DOC_ID,
    PLACES_DOC_ID,
    "pineta:cards",
    PRESENCE_DOC_ID,
    "note:n-1",
    "line:pineta.control:a→host",
    "card:",
    "inventory:ada@x.io",
  ])
    expect(resolveDoc(other)).toBeUndefined()
})

test("a command Line's documents are shared with, and taken from, its two ends only (ADR-0037)", () => {
  const policy = writePolicy
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

test("a tab's undo stack is shared with no one and taken from no one; places and texts with everyone", () => {
  const policy = writePolicy
  const peer = { peerId: "seat-a", principal: "x@y.io", type: "user" } as const
  expect([
    policy.canShare?.(UNDO, peer),
    policy.canAccept?.(UNDO, peer),
    policy.canShare?.(PLACES_DOC_ID, peer),
    policy.canShare?.(CARD, peer),
    policy.canAccept?.(PLACES_DOC_ID, peer),
    policy.canAccept?.(CARD, peer),
  ]).toEqual([false, false, undefined, undefined, false, true])
})

test("an inventory is shared with, and taken from, its person only (ADR-0059)", () => {
  const policy = writePolicy
  const peer = (principal: string) =>
    ({ peerId: `seat-${principal}`, principal, type: "user" }) as const
  expect([
    policy.canShare?.(INVENTORY, peer("Ada@X.io")),
    policy.canAccept?.(INVENTORY, peer("ada@x.io")),
    policy.canShare?.(INVENTORY, peer("bea@x.io")),
    policy.canAccept?.(INVENTORY, peer("bea@x.io")),
    policy.canShare?.(INVENTORY, peer("pineta-host")),
  ]).toEqual([true, true, false, false, false])
})
