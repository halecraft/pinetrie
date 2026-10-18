import { expect, test } from "vitest"
import { turnDiskPrivate } from "./0008-turn-disk-private.ts"

const DISK = {
  derived: { paths: [], more: 0 },
  unignored: [],
  leftovers: [],
  shared: { read: [], wrote: [] },
}

test("a turn's disk in the old shape lists its private paths under their new name", () => {
  expect(
    turnDiskPrivate({
      point: "p",
      disk: { ...DISK, local: { paths: [".env"], more: 1 } },
    }),
  ).toEqual({
    point: "p",
    disk: { ...DISK, private: { paths: [".env"], more: 1 } },
  })
})

test("a turn with no disk, or one already renamed, needs nothing", () => {
  expect(turnDiskPrivate({ point: "p", disk: null })).toBeNull()
  expect(
    turnDiskPrivate({
      point: "p",
      disk: { ...DISK, private: { paths: [], more: 0 } },
    }),
  ).toBeNull()
})
