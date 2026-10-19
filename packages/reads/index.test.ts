import {
  entryId,
  rootIdFor,
  runId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { encodePinned } from "@pinetrie/rules"
import type { StoredEntryRow } from "@pinetrie/schema"
import {
  beginRun,
  newLiveDoc,
  newRootDoc,
  writeEntry,
  writeLaneTip,
} from "@pinetrie/schema/fixtures"
import { type CardRecord, type TextCard, textCardId } from "@pinetrie/threads"
import { cardIdFor } from "@pinetrie/threads/fixtures"
import { expect, test } from "vitest"
import { readLanes, readTreeIndex } from "./index.ts"

const _TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const row = (
  id: string,
  parentId: string | null,
  message: unknown = { role: "user", content: id },
): StoredEntryRow => ({
  id,
  parentId,
  type: "message",
  timestamp: 0,
  fromId: null,
  thread: threadIdFor("row"),
  payload: { message },
})

test("readTreeIndex keeps the index, and each unchanged entry, until entries change", () => {
  const doc = newRootDoc()
  writeEntry(doc, row("e1", null))
  writeEntry(doc, row("e2", "e1"))
  const before = readTreeIndex(doc)

  doc.values.set("k", { namespace: "n", key: "k", value: 1 })
  expect(readTreeIndex(doc)).toBe(before)

  writeEntry(doc, row("e3", "e2"))
  const after = readTreeIndex(doc)
  expect(after).not.toBe(before)
  const [e1, e2] = [entryId("e1"), entryId("e2")]
  expect(after.entries[e1]).toBe(before.entries[e1])
  expect(after.entries[e2]).toBe(before.entries[e2])
  expect(after.childrenOf.get(entryId("e2"))).toEqual(["e3"])
})

test("each entry is in the thread its row names; a row whose thread is no thread's id is left out", () => {
  const doc = newRootDoc()
  writeEntry(doc, row("e1", null))
  writeEntry(doc, { ...row("e2", "e1"), thread: "" })
  const index = readTreeIndex(doc)
  expect(index.entries[entryId("e1")]?.thread).toBe(threadIdFor("row"))
  expect(index.entries[entryId("e2")]).toBeUndefined()
  expect(index.endOf.get(threadIdFor("row"))).toBe("e1")
})

test("a row of a type pi does not write is left out; a message row with a role the reads do not take has no message", () => {
  const doc = newRootDoc()
  writeEntry(doc, row("e1", null))
  writeEntry(doc, { ...row("e2", "e1"), type: "custom_message" })
  writeEntry(doc, row("e3", "e1", { role: "bashExecution", command: "ls" }))
  const index = readTreeIndex(doc)
  expect(index.entries[entryId("e1")]?.message?.role).toBe("user")
  expect(index.entries[entryId("e2")]).toBeUndefined()
  expect(index.entries[entryId("e3")]?.type).toBe("message")
  expect(index.entries[entryId("e3")]?.message).toBeUndefined()
})

test("a compaction carries the newest cards entry of its retained tail; one with none carries nothing", () => {
  const doc = newRootDoc()
  const lane = threadIdFor("0123456789abcdef")
  const view = (text: string) => ({
    lane,
    cards: [
      {
        id: cardIdFor("c1"),
        text,
        by: writerId("ada@x.io"),
      },
    ],
    retired: [],
  })
  const compaction = (id: string, retainedTail: unknown[]): StoredEntryRow => ({
    id,
    parentId: "e1",
    type: "compaction",
    timestamp: 0,
    fromId: null,
    thread: threadIdFor("row"),
    payload: { summary: "s", tokensBefore: 1, retainedTail, fromHook: true },
  })
  writeEntry(doc, row("e1", null))
  writeEntry(
    doc,
    compaction("c1", [
      encodePinned(view("old"), w => w, 1),
      { role: "user", content: "x" },
      encodePinned(view("new"), w => w, 2),
    ]),
  )
  writeEntry(doc, compaction("c2", [{ role: "user", content: "x" }]))
  const index = readTreeIndex(doc)
  expect(index.entries[entryId("c1")]?.carried).toEqual({ pinned: view("new") })
  expect(index.entries[entryId("c2")]?.carried).toBeUndefined()
  expect(index.entries[entryId("e1")]?.carried).toBeUndefined()
})

test("readLanes: a lane's queued cards are what waits; askedBy is who queued the first, lastWaiting the last", () => {
  const doc = newRootDoc()
  const live = newLiveDoc()
  const view = { doc, live }
  const lane = threadIdFor("0123456789abcdef")
  writeEntry(doc, row("e1", null))
  writeLaneTip(doc, lane, entryId("e1"))
  const queued = (id: string, order: string, email: string): TextCard => ({
    kind: "text",
    id: textCardId(id),
    owner: writerId("ada@x.io"),
    placer: writerId("ada@x.io"),
    place: {
      kind: "queued",
      thread: lane,
      order,
      by: writerId(email),
      seen: "",
    },
    content: { command: null, unsent: null, origin: null },
  })
  const atEnd: CardRecord = {
    kind: "text" as const,
    id: cardIdFor("c0"),
    owner: writerId("cy@x.io"),
    placer: writerId("cy@x.io"),
    place: {
      kind: "composing",
      thread: lane,
    },
    content: { command: null, unsent: null, origin: null },
  }
  const cards = [
    queued(cardIdFor("c2"), "b", "bea@x.io"),
    queued(cardIdFor("c1"), "a", "ada@x.io"),
    atEnd,
  ]
  const found = readLanes(
    view,
    readTreeIndex(doc),
    cards,
    new Map(),
    new Set(),
  ).find(l => l.name === lane)
  expect(found).toMatchObject({
    running: false,
    waiting: 2,
    askedBy: writerId("ada@x.io"),
    lastWaiting: writerId("bea@x.io"),
    heldBy: null,
  })
  expect(
    readLanes(view, readTreeIndex(doc), [], new Map(), new Set())[0],
  ).toMatchObject({
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
    heldBy: null,
  })
  // A blank queued card does not wait: the drain passes over it, so a queue
  // of blank cards alone leaves its lane idle.
  expect(
    readLanes(
      view,
      readTreeIndex(doc),
      cards,
      new Map(),
      new Set([cardIdFor("c2")]),
    ).find(l => l.name === lane),
  ).toMatchObject({ waiting: 1, lastWaiting: writerId("ada@x.io") })
  expect(
    readLanes(
      view,
      readTreeIndex(doc),
      cards,
      new Map(),
      new Set([cardIdFor("c1"), cardIdFor("c2")]),
    ).find(l => l.name === lane),
  ).toMatchObject({ waiting: 0, askedBy: null, lastWaiting: null })
  // A held queue names who holds it.
  const holds = new Map([[lane, { lane, by: writerId("cy@x.io"), at: 1 }]])
  expect(
    readLanes(view, readTreeIndex(doc), [], holds, new Set())[0]?.heldBy,
  ).toBe(writerId("cy@x.io"))
  beginRun(live, lane, runId("r-1"))
  expect(
    readLanes(view, readTreeIndex(doc), cards, new Map(), new Set())[0]
      ?.running,
  ).toBe(true)
})
