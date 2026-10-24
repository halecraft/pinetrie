import { threadIdFor } from "@pinetrie/core"
import { entrySnapshotId } from "@pinetrie/core/fixtures"
import { expect, test } from "vitest"
import {
  type SnapshotRow,
  snapshotCost,
  snapshotsByLane,
} from "./snapshot-index.ts"

const [a, b] = [threadIdFor("t-a"), threadIdFor("t-b")]
const row = (n: number, more: Partial<SnapshotRow>): SnapshotRow => ({
  snapshot: entrySnapshotId(n),
  lane: a,
  changed: 0,
  used: n,
  branched: false,
  state: "kept",
  ...more,
})

test("a lane's snapshots are its kept rows alone, each at its estimated cost", () => {
  const by = snapshotsByLane([
    row(1, { changed: 4 }),
    row(2, {}),
    row(3, { state: "to-delete" }),
    row(4, { state: "reserved" }),
    row(5, { lane: b, state: "deleted" }),
  ])
  expect([...by]).toEqual([
    [
      a,
      {
        count: 2,
        bytes: snapshotCost({ changed: 4 }) + snapshotCost({ changed: 0 }),
      },
    ],
  ])
})
