// What the types make impossible to write. Each `@ts-expect-error` fails
// `npx tsc --noEmit` if the line below it ever compiles.

import { entryId, type IndexedSnapshot, threadIdFor } from "@pinetrie/core"
import { entrySnapshotId } from "@pinetrie/core/fixtures"
import type { Reservation } from "@pinetrie/machine"
import { expect, test } from "vitest"
import type { RevisionToWrite } from "./turns.ts"

const record = {
  entry: entryId("e"),
  lane: threadIdFor("1"),
  point: null,
  paths: [],
  conflicts: [],
  disk: null,
}

test("a revision is written only with a snapshot the index holds, taken", () => {
  const written: RevisionToWrite[] = [
    // @ts-expect-error: a bare snapshot id is not indexed
    { ...record, snapshot: entrySnapshotId(1) },
    { ...record, snapshot: null },
  ]
  expect(written).toHaveLength(2)
})

test("a reservation is not an indexed snapshot", () => {
  const reserved = entrySnapshotId(1) as Reservation
  // @ts-expect-error: only marking it taken makes one
  const indexed: IndexedSnapshot = reserved
  expect(indexed).toBe(reserved)
})
