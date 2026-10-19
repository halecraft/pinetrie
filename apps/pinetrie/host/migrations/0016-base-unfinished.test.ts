import { expect, test } from "vitest"
import { baseUnfinished } from "./0016-base-unfinished.ts"

test("a base on a WIP reads as one on unfinished work, its bookmark kept", () => {
  expect(
    baseUnfinished({
      kind: "jj",
      base: { kind: "wip", bookmark: "wip/a" },
      start: "c",
    }),
  ).toEqual({
    kind: "jj",
    base: { kind: "unfinished", bookmark: "wip/a" },
    start: "c",
  })
})

test("a base on accepted work, or a folder's, needs nothing", () => {
  expect(baseUnfinished({ kind: "jj", base: { kind: "accepted" } })).toBeNull()
  expect(baseUnfinished({ kind: "folder", start: "p" })).toBeNull()
})
