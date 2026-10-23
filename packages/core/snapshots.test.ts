import fc from "fast-check"
import { describe, expect, test } from "vitest"
import { snapshotId } from "./disks.ts"
import { OWNED_SNAPSHOT_NAME } from "./fixtures.ts"
import {
  type DeletableOwner,
  deletableSnapshot,
  snapshotOwner,
} from "./snapshots.ts"

const UUID = "019a0b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b"

describe("snapshotOwner", () => {
  test.each([
    [UUID, "entry"],
    [`line-${UUID}`, "folder-state"],
    [`turn-${UUID}`, "folder-state"],
    [`start-${UUID}`, "folder-state"],
    [`get-latest-${UUID}`, "folder-state"],
    [`resolve-${UUID}`, "folder-state"],
    [`restore-${UUID}`, "folder-state"],
    [`concurrent-${UUID}`, "folder-state"],
    [`bases-${"a".repeat(32)}`, "folder-state"],
    [`shown-${"b".repeat(32)}`, "folder-state"],
    ["base", "base"],
    ["a".repeat(40), "unknown"],
    ["ro", "unknown"],
    [`${UUID}.tmp`, "unknown"],
    ["../x", "unknown"],
  ])("%s is %s's", (name, owner) => {
    expect(snapshotOwner(name)).toBe(owner)
  })

  test("a name made for an owner is that owner's", () => {
    fc.assert(
      fc.property(OWNED_SNAPSHOT_NAME, ({ owner, name }) => {
        expect(snapshotOwner(name)).toBe(owner)
      }),
    )
  })
})

describe("deletableSnapshot", () => {
  const DELETERS: readonly DeletableOwner[] = ["entry", "folder-state"]

  test("each rule takes its own owner's names and throws for every other", () => {
    fc.assert(
      fc.property(
        OWNED_SNAPSHOT_NAME,
        fc.constantFrom(...DELETERS),
        ({ owner, name }, rule) => {
          const id = snapshotId(name)
          if (owner === rule) expect(deletableSnapshot(rule, id)).toBe(id)
          else expect(() => deletableSnapshot(rule, id)).toThrow()
        },
      ),
    )
  })

  test("the base is no rule's to delete", () => {
    for (const rule of DELETERS)
      expect(() => deletableSnapshot(rule, snapshotId("base"))).toThrow()
  })
})
