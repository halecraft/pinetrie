import { entryId, snapshotId, threadIdFor } from "@pinetrie/core"
import { entrySnapshotId } from "@pinetrie/core/fixtures"
import { expect, test } from "vitest"
import { recordedSnapshots } from "./records.ts"

const LANE = threadIdFor("1")
const record = (snapshot: string | null, paths: readonly string[] = []) => ({
  entry: entryId("e"),
  lane: LANE,
  point: null,
  snapshot: snapshot === null ? null : snapshotId(snapshot),
  paths,
  conflicts: [],
  disk: null,
})

test("the index's fill takes each record's entry snapshot, costed by the paths its turn changed, and no other name", () => {
  const A = entrySnapshotId(1)
  expect(
    recordedSnapshots([
      record(A, ["a", "b"]),
      record("base"),
      record(`turn-${A}`),
      record(null),
    ]),
  ).toEqual([{ snapshot: A, lane: LANE, changed: 2 }])
})
