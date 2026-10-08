import { entryId, type ThreadName, threadIdFor, writerId } from "@pinetrie/core"
import { deleteRecord, MARK, NAME, setRecord } from "@pinetrie/rules"
import { readNamespace } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { basics, ROOT_ID } from "./fakes.ts"
import { createRecords } from "./records.ts"

const LANE_1 = threadIdFor("0190a0a0-0000-7000-8000-000000000001")

test("writes sets and deletes, each in the document its target names (ADR-0063, ADR-0095)", async () => {
  const b = basics()
  const records = createRecords(b.docs)
  const entry = entryId("e-1")
  await records.writeValues([
    setRecord(
      MARK,
      { entry, title: "Plans", by: writerId("ada"), at: 1 },
      ROOT_ID,
    ),
    setRecord(NAME, { lane: LANE_1, name: "amber-fox" as ThreadName, at: 1 }),
  ])
  expect([
    readNamespace(b.root, "pinetrie.mark"),
    readNamespace(b.session, "pinetrie.mark"),
    Object.keys(readNamespace(b.session, "pinetrie.name")),
    readNamespace(b.root, "pinetrie.name"),
  ]).toEqual([
    { [entry]: { title: "Plans", by: writerId("ada"), at: 1 } },
    {},
    [LANE_1],
    {},
  ])
  await records.writeValues([deleteRecord(MARK, entry, ROOT_ID)])
  expect(readNamespace(b.root, "pinetrie.mark")).toEqual({})
})
