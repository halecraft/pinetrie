import { expect, test } from "vitest"
import { factAllowance, queuedFactAllowance } from "./0022-fact-allowance.ts"

test("a stop by an allowance, and an allowance used up, read in the new words", () => {
  expect(factAllowance({ kind: "stopped", by: "w", budget: "m" })).toEqual({
    kind: "stopped",
    by: "w",
    allowance: "m",
  })
  expect(
    factAllowance({ kind: "budget-spent", lane: "t", budget: "m", limit: 5 }),
  ).toEqual({ kind: "allowance-spent", lane: "t", allowance: "m", limit: 5 })
})

test("a plain stop, another fact, or one already renamed needs nothing", () => {
  expect(factAllowance({ kind: "stopped", by: "w" })).toBeNull()
  expect(factAllowance({ kind: "squashed" })).toBeNull()
  expect(factAllowance({ kind: "allowance-spent", allowance: "m" })).toBeNull()
})

test("a queued fact's row is rewritten with its fact", () => {
  const row = queuedFactAllowance({
    fact: JSON.stringify({ kind: "budget-spent", budget: "m" }),
  })
  expect(JSON.parse((row as { fact: string }).fact)).toEqual({
    kind: "allowance-spent",
    allowance: "m",
  })
})
