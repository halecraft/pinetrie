import {
  type EntryId,
  entryId,
  type ThreadName,
  threadIdFor,
} from "@pinetrie/core"
import { DIGEST, deleteRecord, NAME, setRecord } from "@pinetrie/rules"
import { readNamespace } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { basics, ROOT_ID } from "./fakes.ts"
import { createRecords } from "./records.ts"

const LANE_1 = threadIdFor("0190a0a0-0000-7000-8000-000000000001")
const DIGESTED = (prompt: EntryId) => ({
  prompt,
  headline: "Done",
  points: [],
  at: 1,
  final: true,
})

test("writes sets and deletes, each in the document its target names", async () => {
  const b = basics()
  const records = createRecords(b.docs)
  const entry = entryId("e-1")
  await records.writeValues([
    setRecord(DIGEST, DIGESTED(entry), ROOT_ID),
    setRecord(NAME, { lane: LANE_1, name: "amber-fox" as ThreadName, at: 1 }),
  ])
  expect([
    Object.keys(readNamespace(b.root, "pinetrie.digest")),
    readNamespace(b.session, "pinetrie.digest"),
    Object.keys(readNamespace(b.session, "pinetrie.name")),
    readNamespace(b.root, "pinetrie.name"),
  ]).toEqual([[entry], {}, [LANE_1], {}])
  await records.writeValues([deleteRecord(DIGEST, entry, ROOT_ID)])
  expect(readNamespace(b.root, "pinetrie.digest")).toEqual({})
})
