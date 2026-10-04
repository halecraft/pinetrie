import {
  cardId,
  movesDocId,
  rootDocId,
  rootIdFor,
  writerId,
} from "@pineta/core"
import {
  PLACES_DOC_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { personDocId } from "@pineta/protocol/writers"
import { cardDocId } from "@pineta/schema"
import { expect, test } from "vitest"
import { acceptsWrite, hostPolicy, resolveDoc } from "./policy.ts"

const CARD = cardDocId(cardId("c-1"))
const UNDO = "undo:seat-a"
const INVENTORY = personDocId("inventory", writerId("ada@x.io"))
const ATTENTION = personDocId("attention", writerId("ada@x.io"))

const KNOWN = rootIdFor("known")

test("acceptsWrite: presence is each client's; the session and the places are left to who may write them (`writersPolicy`)", () => {
  expect(acceptsWrite(SESSION_DOC_ID)).toBeUndefined()
  expect(acceptsWrite(PLACES_DOC_ID)).toBeUndefined()
  expect(acceptsWrite(PRESENCE_DOC_ID)).toBe(true)
  expect(acceptsWrite("line:pineta.control:a→host")).toBeUndefined()
})

test("acceptsWrite: cards' texts are written by clients; an undo stack is refused (ADR-0048)", () => {
  expect(acceptsWrite(CARD)).toBe(true)
  expect(acceptsWrite(UNDO)).toBe(false)
})

test("resolveDoc: a card's text, a person's document by its kind, a known root, a tab's undo stack or an unknown root, and nothing else", () => {
  const known = (root: string) => root === KNOWN
  expect(resolveDoc(CARD, known)).toBe("text")
  expect(resolveDoc(INVENTORY, known)).toBe("inventory")
  expect(resolveDoc(ATTENTION, known)).toBe("attention")
  expect(resolveDoc(UNDO, known)).toBe("reject")
  // Only the host makes roots; one the directory names it loads (ADR-0063).
  expect(resolveDoc(rootDocId(KNOWN), known)).toBe("root")
  expect(resolveDoc(rootDocId(rootIdFor("other")), known)).toBe("reject")
  for (const other of [
    SESSION_DOC_ID,
    PLACES_DOC_ID,
    "pineta:cards",
    PRESENCE_DOC_ID,
    "note:n-1",
    "line:pineta.control:a→host",
    "card:",
    "inventory:ada@x.io",
    "attention:ada@x.io",
  ])
    expect(resolveDoc(other, known)).toBeUndefined()
})

test("a command Line's documents are shared with, and taken from, its two ends only (ADR-0037)", () => {
  const policy = hostPolicy
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

test("a tab's undo stack is shared with no one and taken from no one; places and texts shared with everyone", () => {
  const policy = hostPolicy
  const peer = { peerId: "seat-a", principal: "x@y.io", type: "user" } as const
  expect([
    policy.canShare?.(UNDO, peer),
    policy.canAccept?.(UNDO, peer),
    policy.canShare?.(PLACES_DOC_ID, peer),
    policy.canShare?.(CARD, peer),
    policy.canAccept?.(CARD, peer),
  ]).toEqual([false, false, undefined, undefined, true])
})

test.each([
  ["an inventory", INVENTORY],
  ["an attention document", ATTENTION],
])("%s is shared with its person only (ADR-0059, ADR-0077)", (_, doc) => {
  const policy = hostPolicy
  const peer = (principal: string) =>
    ({ peerId: `seat-${principal}`, principal, type: "user" }) as const
  expect([
    policy.canShare?.(doc, peer("Ada@X.io")),
    policy.canShare?.(doc, peer("bea@x.io")),
    policy.canShare?.(doc, peer("pineta-host")),
  ]).toEqual([true, false, false])
})

test("a stack of moves is the host's: shared with no one, taken from no one, and rejected when a client announces one (ADR-0066)", () => {
  const MOVES = movesDocId(writerId("ada@x.io"), KNOWN)
  const peer = {
    peerId: "seat-a",
    principal: "ada@x.io",
    type: "user",
  } as const
  expect([
    hostPolicy.canShare?.(MOVES, peer),
    hostPolicy.canAccept?.(MOVES, peer),
    resolveDoc(MOVES, () => true),
  ]).toEqual([false, false, "reject"])
})
