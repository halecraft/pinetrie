// What the types make impossible to write. Each `@ts-expect-error` fails
// `npx tsc --noEmit` if the line below it ever compiles.

import { expect, test } from "vitest"
import { type DiskOp, snapshotId } from "./disks.ts"
import { type Deletable, deletableSnapshot } from "./snapshots.ts"

test("no rule can delete the base or a name no owner holds", () => {
  // @ts-expect-error: the base is no owner's to delete
  const base: Deletable<"base"> = snapshotId("base") as never
  // @ts-expect-error: nor is a name no owner holds
  const unknown: Deletable<"unknown"> = snapshotId("x") as never
  expect([base, unknown]).toHaveLength(2)
})

test("delete-snapshots refuses a bare snapshot id", () => {
  const ops: DiskOp[] = [
    // @ts-expect-error: a deletion needs its owner's proof
    { kind: "delete-snapshots", ids: [snapshotId("turn-a")] },
    {
      kind: "delete-snapshots",
      ids: [deletableSnapshot("folder-state", snapshotId("turn-a"))],
    },
  ]
  expect(ops).toHaveLength(2)
})
