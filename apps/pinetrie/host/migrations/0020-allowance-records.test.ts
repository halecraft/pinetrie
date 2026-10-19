import { SESSION_TARGET } from "@pinetrie/core"
import { expect, test } from "vitest"
import { planAllowanceMove } from "./0020-allowance-records.ts"

test("each stored budget moves to the allowance namespace under its message, the old deleted", () => {
  const value = { thread: "t", by: "w", limit: 10, spent: 2, over: false }
  expect(planAllowanceMove({ m: value })).toEqual([
    {
      kind: "set",
      target: SESSION_TARGET,
      namespace: "pinetrie.allowance",
      key: "m",
      value,
    },
    {
      kind: "delete",
      target: SESSION_TARGET,
      namespace: "pinetrie.budget",
      key: "m",
    },
  ])
  expect(planAllowanceMove({})).toEqual([])
})
