import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  rootIdFor,
  runId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { encodePinned } from "@pinetrie/rules"
import { newLiveDoc, type StoredEntryRow } from "@pinetrie/schema"
import {
  beginRun,
  newRootDoc,
  writeEntry,
  writeLaneTip,
} from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { readLanes, readTreeIndex } from "./index.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const row = (id: string, parentId: string | null): StoredEntryRow => ({
  id,
  parentId,
  type: "message",
  timestamp: 0,
  fromId: null,
  payload: { message: { role: "user", content: id } },
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

test("a compaction carries the newest cards entry of its retained tail; one with none carries nothing", () => {
  const doc = newRootDoc()
  const lane = threadIdFor("0123456789abcdef")
  const view = (text: string) => ({
    lane,
    cards: [{ id: cardId("c-1"), text, by: writerId("ada@x.io") }],
    retired: [],
  })
  const compaction = (id: string, retainedTail: unknown[]): StoredEntryRow => ({
    id,
    parentId: "e1",
    type: "compaction",
    timestamp: 0,
    fromId: null,
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
  expect(index.entries[entryId("c1")]?.carried).toEqual(view("new"))
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
  const queued = (id: string, order: string, email: string): CardRecord => ({
    id: cardId(id),
    owner: writerId("ada@x.io"),
    placer: writerId("ada@x.io"),
    place: {
      kind: "queued",
      root: TEST_ROOT,
      at: atEntry(entryId("e1")),
      lane,
      order,
      by: writerId(email),
      seen: "",
    },
    carries: { kind: "message", command: null },
    unsent: null,
  })
  const atEnd: CardRecord = {
    id: cardId("c-0"),
    owner: writerId("cy@x.io"),
    placer: writerId("cy@x.io"),
    place: {
      kind: "composing",
      root: TEST_ROOT,
      at: atEntry(entryId("e1")),
      lane,
    },
    carries: { kind: "message", command: null },
    unsent: null,
  }
  const cards = [
    queued("c-2", "b", "bea@x.io"),
    queued("c-1", "a", "ada@x.io"),
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
  // of blank cards alone leaves its lane idle (ADR-0113).
  expect(
    readLanes(
      view,
      readTreeIndex(doc),
      cards,
      new Map(),
      new Set([cardId("c-2")]),
    ).find(l => l.name === lane),
  ).toMatchObject({ waiting: 1, lastWaiting: writerId("ada@x.io") })
  expect(
    readLanes(
      view,
      readTreeIndex(doc),
      cards,
      new Map(),
      new Set([cardId("c-1"), cardId("c-2")]),
    ).find(l => l.name === lane),
  ).toMatchObject({ waiting: 0, askedBy: null, lastWaiting: null })
  // A held queue names who holds it (ADR-0048 step 7).
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
