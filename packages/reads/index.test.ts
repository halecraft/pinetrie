import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  laneNameForThread,
  rootIdFor,
  runId,
  writerId,
} from "@pineta/core"
import {
  beginRun,
  newLiveDoc,
  newRootDoc,
  type StoredEntryRow,
  writeEntry,
  writeLaneTip,
} from "@pineta/schema"
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

test("readLanes: a lane's queued cards are what waits; askedBy is who queued the first, lastWaiting the last", () => {
  const doc = newRootDoc()
  const live = newLiveDoc()
  const view = { doc, live }
  const lane = laneNameForThread("0123456789abcdef")
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
    command: null,
    unsent: null,
  })
  const drafting: CardRecord = {
    id: cardId("c-0"),
    owner: writerId("cy@x.io"),
    placer: writerId("cy@x.io"),
    place: {
      kind: "drafting",
      root: TEST_ROOT,
      at: atEntry(entryId("e1")),
      lane,
    },
    command: null,
    unsent: null,
  }
  const cards = [
    queued("c-2", "b", "bea@x.io"),
    queued("c-1", "a", "ada@x.io"),
    drafting,
  ]
  const found = readLanes(view, readTreeIndex(doc), cards).find(
    l => l.name === lane,
  )
  expect(found).toMatchObject({
    running: false,
    waiting: 2,
    askedBy: writerId("ada@x.io"),
    lastWaiting: writerId("bea@x.io"),
  })
  expect(readLanes(view, readTreeIndex(doc), [])[0]).toMatchObject({
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
  })
  beginRun(live, lane, runId("r-1"))
  expect(readLanes(view, readTreeIndex(doc), cards)[0]?.running).toBe(true)
})
