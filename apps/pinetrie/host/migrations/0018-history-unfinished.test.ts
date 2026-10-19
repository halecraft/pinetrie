import { expect, test } from "vitest"
import { historyUnfinished } from "./0018-history-unfinished.ts"

test("a message naming a WIP names unfinished work, the rest kept", () => {
  expect(
    historyUnfinished("to")({
      kind: "accepted",
      to: { kind: "wip", bookmark: "wip/a" },
      as: "k",
    }),
  ).toEqual({
    kind: "accepted",
    to: { kind: "unfinished", bookmark: "wip/a" },
    as: "k",
  })
})

test("one naming accepted work or a parent, or with no such field, needs nothing", () => {
  const from = historyUnfinished("from")
  expect(from({ from: { kind: "accepted" } })).toBeNull()
  expect(from({ from: { kind: "parent", lane: "t", name: "x" } })).toBeNull()
  expect(from({ files: [] })).toBeNull()
})
