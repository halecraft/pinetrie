import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  laneNameForThread,
  ROOT,
  runId,
  writerId,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { IN_COLUMN, sendPendingOf } from "./card-moves.ts"
import { planChatRequest, startsRoot } from "./chat.ts"
import { TEST_ROOT } from "./fixtures.ts"

const at = atEntry(entryId("e-1"))
const ADA = writerId("ada@x.io")
const card: CardRecord = {
  id: cardId("c-1"),
  owner: ADA,
  placer: ADA,
  place: { kind: "drafting", root: TEST_ROOT, at, lane: null },
  carries: { kind: "message", command: null },
  unsent: null,
}

test("a chat fills in what its column left out, carries its column's reservation, and each card's version as this client has it", () => {
  const lane = laneNameForThread("x")
  expect(
    planChatRequest({
      text: "hi @bea",
      at,
      how: {},
      root: TEST_ROOT,
      card: null,
      pinned: [],
      freshId: "f-1",
    }).intent,
  ).toMatchObject({
    kind: "chat",
    root: TEST_ROOT,
    mode: "reply",
    lane: null,
    asksAgent: false,
    work: null,
    card: null,
    pinned: [],
    reserved: null,
    base: null,
  })
  const pinned = [
    { id: cardId("p-1"), seen: "v-p-1" },
    { id: cardId("p-2"), seen: "v-p-2" },
  ]
  expect(
    planChatRequest({
      text: "go",
      at,
      how: {
        mode: "branch",
        lane,
        asksAgent: true,
        reserved: lane,
        base: "wip",
        pinned: pinned.map(p => p.id),
      },
      root: TEST_ROOT,
      card: { record: card, seen: "v-c-1" },
      pinned,
      freshId: "f-1",
    }).intent,
  ).toMatchObject({
    mode: "branch",
    lane,
    asksAgent: true,
    card: { id: "c-1", seen: "v-c-1" },
    pinned,
    reserved: lane,
    base: "wip",
  })
})

test("a send with no card is not drawn; one from a card draws the card out of its composer, under the send's id", () => {
  const plain = planChatRequest({
    text: "hi",
    at,
    how: { id: "s-1" },
    root: TEST_ROOT,
    card: null,
    pinned: [],
    freshId: "f-1",
  })
  expect([plain.id, plain.pending]).toEqual(["s-1", null])
  const fromCard = planChatRequest({
    text: "hi",
    at,
    how: { card: card.id, column: "col-1" },
    root: TEST_ROOT,
    card: { record: card, seen: "v" },
    pinned: [],
    freshId: "f-1",
  })
  expect(fromCard.id).toBe("f-1")
  expect(fromCard.pending).toEqual(
    sendPendingOf("f-1", card.id, IN_COLUMN("col-1")),
  )
})

test("startsRoot: a thread at the root written, as a conversation or a run; nothing else", () => {
  const at = { kind: "entry", id: entryId("e-1") } as const
  expect(startsRoot(ROOT, { kind: "appended", id: entryId("e-1") })).toBe(true)
  expect(startsRoot(ROOT, { kind: "started", runId: runId("r-1") })).toBe(true)
  expect(
    startsRoot(ROOT, { kind: "refused", code: "x", message: "" } as never),
  ).toBe(false)
  expect(startsRoot(at, { kind: "appended", id: entryId("e-2") })).toBe(false)
})
