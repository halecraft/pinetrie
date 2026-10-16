import {
  atEntry,
  type CardRecord,
  canvasIdFor,
  entryId,
  type MessageAt,
  ROOT,
  runId,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { expect, test } from "vitest"
import { IN_COLUMN, sendPendingOf } from "./card-moves.ts"
import { TEST_ROOT } from "./fixtures.ts"
import { columnMessageAt, planSendRequest, startsRoot } from "./send.ts"

const TEST_THREAD = threadIdFor("e")
const TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const at = atEntry(entryId("e-1"))
const END: MessageAt = {
  kind: "end",
  thread: threadIdFor("x"),
  seen: entryId("e-1"),
}
const ADA = writerId("ada@x.io")
const card: CardRecord = {
  kind: "text" as const,
  id: cardIdFor("c1"),
  owner: ADA,
  placer: ADA,
  place: { kind: "composing", thread: TEST_THREAD },
  content: { command: null, unsent: null, origin: null },
}

test("a chat fills in what its column left out, and carries each card's version as this client has it", () => {
  const thread = threadIdFor("x")
  const end: MessageAt = { kind: "end", thread, seen: entryId("e-1") }
  expect(
    planSendRequest({
      text: "hi @bea",
      at: end,
      how: {},
      root: TEST_ROOT,
      card: null,
      pinned: [],
      freshId: "f-1",
    }).intent,
  ).toMatchObject({
    kind: "send",
    root: TEST_ROOT,
    at: end,
    asksAgent: false,
    card: null,
    pinned: [],
    base: null,
  })
  const pinned = [
    { id: textCardId("p-1"), seen: "v-p-1" },
    { id: textCardId("p-2"), seen: "v-p-2" },
  ]
  const branch: MessageAt = {
    kind: "branch",
    thread,
    at: entryId("e-1"),
    canvas: TEST_CANVAS,
  }
  expect(
    planSendRequest({
      text: "go",
      at: branch,
      how: {
        asksAgent: true,
        base: "wip",
        pinned: pinned.map(p => p.id),
      },
      root: TEST_ROOT,
      card: { record: card, seen: "v-c-1" },
      pinned,
      freshId: "f-1",
    }).intent,
  ).toMatchObject({
    at: branch,
    asksAgent: true,
    card: { id: cardIdFor("c1"), seen: "v-c-1" },
    pinned,
    base: "wip",
  })
})

test("columnMessageAt: a reply continues its thread from the end it shows; a branch, or a send at the root, starts it", () => {
  const thread = threadIdFor("x")
  expect(columnMessageAt("reply", thread, at, TEST_CANVAS)).toEqual({
    kind: "end",
    thread,
    seen: "e-1",
  })
  expect(columnMessageAt("branch", thread, at, TEST_CANVAS)).toEqual({
    kind: "branch",
    thread,
    at: "e-1",
    canvas: TEST_CANVAS,
  })
  expect(columnMessageAt("reply", thread, ROOT, TEST_CANVAS)).toEqual({
    kind: "branch",
    thread,
    at: null,
    canvas: TEST_CANVAS,
  })
})

test("a send with no card is not drawn; one from a card draws the card out of its composer, under the send's id", () => {
  const plain = planSendRequest({
    text: "hi",
    at: END,
    how: { id: "s-1" },
    root: TEST_ROOT,
    card: null,
    pinned: [],
    freshId: "f-1",
  })
  expect([plain.id, plain.pending]).toEqual(["s-1", null])
  const fromCard = planSendRequest({
    text: "hi",
    at: END,
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

test("startsRoot: a thread at the root written, as a chat or a run; nothing else", () => {
  const atRoot: MessageAt = {
    kind: "branch",
    thread: threadIdFor("x"),
    at: null,
    canvas: TEST_CANVAS,
  }
  expect(startsRoot(atRoot, { kind: "appended", id: entryId("e-1") })).toBe(
    true,
  )
  expect(startsRoot(atRoot, { kind: "started", runId: runId("r-1") })).toBe(
    true,
  )
  expect(
    startsRoot(atRoot, { kind: "refused", code: "x", message: "" } as never),
  ).toBe(false)
  expect(startsRoot(END, { kind: "appended", id: entryId("e-2") })).toBe(false)
})
