import { entryId, threadIdFor, writerId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type BudgetRecord,
  DEFAULT_BUDGET,
  decodeAgentsConfig,
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
  test("no request past it", () => {
    expect(mayRequest(budget)).toBe(true)
    expect(mayRequest({ ...budget, over: true })).toBe(false)
    expect(mayRequest(undefined)).toBe(true)
  })
  test("the user config's budget, or the default", () => {
    expect(decodeAgentsConfig({ agents: { budget: 50_000 } })).toBe(50_000)
    expect(decodeAgentsConfig({ agents: { budget: -1 } })).toBe(DEFAULT_BUDGET)
    expect(decodeAgentsConfig(null)).toBe(DEFAULT_BUDGET)
  })
})
