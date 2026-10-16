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
import { createRecords, createStepRecords } from "./records.ts"

const LANE_1 = threadIdFor("0190a0a0-0000-7000-8000-000000000001")
const DIGESTED = (prompt: EntryId) => ({
  prompt,
  headline: "Done",
  points: [],
  at: 1,
  final: true,
})

test("a step's records: sets and deletes, each in the document its target names", async () => {
  const b = basics()
  const records = createStepRecords({
    session: b.session,
    root: async () => b.root,
  })
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

test("the session's records take a session record, and no root's", async () => {
  const b = basics()
  const records = createRecords(b.session)
  await records.writeValues([
    setRecord(NAME, { lane: LANE_1, name: "amber-fox" as ThreadName, at: 1 }),
  ])
  expect(Object.keys(readNamespace(b.session, "pinetrie.name"))).toEqual([
    LANE_1,
  ])
  await records
    .writeValues([
      // @ts-expect-error: a root's record is written only through a step's documents
      setRecord(DIGEST, DIGESTED(entryId("e-1")), ROOT_ID),
    ])
    .catch(() => {})
})
