import { laneNameForThread, NOBODY, writerId } from "@pineta/core"
import { encodeHeld, type Held, OUTBOX_NAMESPACE } from "@pineta/marginalia"
import {
  newSessionDoc,
  physicalKey,
  type StoredEntryRow,
  writeEntry,
  writeLaneTip,
} from "@pineta/schema"
import { expect, test } from "vitest"
import { readLanes, readTreeIndex } from "./index.ts"

const row = (id: string, parentId: string | null): StoredEntryRow => ({
  id,
  parentId,
  type: "message",
  timestamp: 0,
  fromId: null,
  payload: { message: { role: "user", content: id } },
})

test("readTreeIndex keeps the index, and each unchanged entry, until entries change", () => {
  const doc = newSessionDoc()
  writeEntry(doc, row("e1", null))
  writeEntry(doc, row("e2", "e1"))
  const before = readTreeIndex(doc)

  doc.values.set("k", { namespace: "n", key: "k", value: 1 })
  expect(readTreeIndex(doc)).toBe(before)

  writeEntry(doc, row("e3", "e2"))
  const after = readTreeIndex(doc)
  expect(after).not.toBe(before)
  expect(after.entries.e1).toBe(before.entries.e1)
  expect(after.entries.e2).toBe(before.entries.e2)
  expect(after.childrenOf.get("e2")).toEqual(["e3"])
})

test("readLanes: lastWaiting is the writer of the newest item waiting, whom a message queued now follows", () => {
  const doc = newSessionDoc()
  const lane = laneNameForThread("0123456789abcdef")
  writeEntry(doc, row("e1", null))
  writeLaneTip(doc, lane, "e1")
  const held = (id: string, email: string): Held => ({
    kind: "chat",
    id,
    lane,
    details: {
      author: writerId(email),
      authorName: email,
      text: id,
      compels: NOBODY,
      sendId: id,
    },
    timestamp: 1,
  })
  for (const h of [held("1-a", "ada@x.io"), held("2-b", "bea@x.io")])
    doc.values.set(physicalKey(OUTBOX_NAMESPACE, h.id), {
      namespace: OUTBOX_NAMESPACE,
      key: h.id,
      value: encodeHeld(h),
    })
  const view = readLanes(doc, readTreeIndex(doc)).find(l => l.name === lane)
  expect(view).toMatchObject({ waiting: 2, lastWaiting: writerId("bea@x.io") })
})
