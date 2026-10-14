import { entryId, threadIdFor, writerId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  addedTokens,
  type BudgetRecord,
  mayRequest,
  planSpend,
} from "./budget.ts"

const budget: BudgetRecord = {
  message: entryId("m"),
  thread: threadIdFor("a"),
  by: writerId("ada@example.com"),
  limit: 100,
  spent: 0,
  over: false,
}

describe("a budget for agents talking", () => {
  test("a spend counts live, and only the one that crosses the limit writes", () => {
    expect(planSpend(budget, 40, 50)).toEqual({ spent: 90, over: null })
    expect(planSpend(budget, 90, 20)).toEqual({
      spent: 110,
      over: { ...budget, spent: 110, over: true },
    })
    const over = { ...budget, over: true }
    expect(planSpend(over, 110, 5)).toEqual({ spent: 115, over: null })
  })
  test("a run's first request adds its output alone", () => {
    expect(addedTokens(null, { context: 120_000, output: 300 })).toBe(300)
  })
  test("a later request adds its output and the context new since the last, never what it re-reads", () => {
    const first = { context: 120_000, output: 300 }
    expect(addedTokens(first, { context: 122_300, output: 50 })).toBe(2_050)
  })
  test("a context compacted smaller adds nothing but the output", () => {
    const first = { context: 120_000, output: 300 }
    expect(addedTokens(first, { context: 30_000, output: 50 })).toBe(50)
  })
  test("no request past it", () => {
    expect(mayRequest(budget)).toBe(true)
    expect(mayRequest({ ...budget, over: true })).toBe(false)
    expect(mayRequest(undefined)).toBe(true)
  })
})
