import {
  cardId,
  movesDocId,
  rootDocId,
  rootIdFor,
  writerId,
} from "@pinetrie/core"
import {
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pinetrie/protocol/messages"
import { personDocId } from "@pinetrie/protocol/writers"
import {
  AttentionDoc,
  cardDocId,
  InventoryDoc,
  LiveDoc,
  OpenDoc,
  PlacesDoc,
  RootDoc,
  SessionDoc,
  TextDoc,
} from "@pinetrie/schema"
import { expect, test } from "vitest"
import {
  acceptsWrite,
  hostPolicy,
  resolveDoc,
  SCHEMA_OF,
  storedKind,
} from "./policy.ts"

const CARD = cardDocId(cardId("c-1"))
const UNDO = "undo:seat-a"
const INVENTORY = personDocId("inventory", writerId("ada@x.io"))
const ATTENTION = personDocId("attention", writerId("ada@x.io"))

const KNOWN = rootIdFor("known")

test("acceptsWrite: presence is each client's; the session and the places are left to who may write them (`writersPolicy`)", () => {
  expect(acceptsWrite(SESSION_DOC_ID)).toBeUndefined()
  expect(acceptsWrite(PLACES_DOC_ID)).toBeUndefined()
  expect(acceptsWrite(PRESENCE_DOC_ID)).toBe(true)
  expect(acceptsWrite("line:pinetrie.control:a→host")).toBeUndefined()
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
    "pinetrie:cards",
    PRESENCE_DOC_ID,
    "note:n-1",
    "line:pinetrie.control:a→host",
    "card:",
    "inventory:ada@x.io",
    "attention:ada@x.io",
  ])
    expect(resolveDoc(other, known)).toBeUndefined()
})

test("a command Line's documents are shared with, and taken from, its two ends only (ADR-0037)", () => {
  const policy = hostPolicy
  const line = "line:pinetrie.control:seat-a→seat-host"
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
    policy.canShare?.(doc, peer("pinetrie-host")),
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

test("storedKind: each stored document's kind, by which its schema is checked at start (ADR-0096)", () => {
  const OPEN = personDocId("open", writerId("ada@x.io"))
  const kinds = [
    [SESSION_DOC_ID, "session", SessionDoc],
    [LIVE_DOC_ID, "live", LiveDoc],
    [PLACES_DOC_ID, "places", PlacesDoc],
    [rootDocId(KNOWN), "root", RootDoc],
    [CARD, "text", TextDoc],
    [INVENTORY, "inventory", InventoryDoc],
    [ATTENTION, "attention", AttentionDoc],
    [OPEN, "open", OpenDoc],
  ] as const
  for (const [id, kind, schema] of kinds) {
    expect(storedKind(id)).toBe(kind)
    expect(SCHEMA_OF[kind]).toBe(schema)
  }
  expect(storedKind(movesDocId(writerId("ada@x.io"), KNOWN))).toBe("kyneta")
  for (const other of [
    "pinetrie:cards",
    "line:pinetrie.control:a→host",
    PRESENCE_DOC_ID,
  ])
    expect(storedKind(other)).toBeUndefined()
})
