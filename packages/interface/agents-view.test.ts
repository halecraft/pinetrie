import { entryId, type ThreadName, threadIdFor, writerId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { agentsRow, agentsWords } from "./agents-view.ts"

const here = threadIdFor("here")
const fox = threadIdFor("fox")
const names = new Map([[fox, "amber-fox" as ThreadName]])
const budget = (spent: number, over = false) =>
  new Map([
    [
      entryId("m"),
      {
        message: entryId("m"),
        thread: here,
        by: writerId("ada@example.com"),
        limit: 200_000,
        spent,
        over,
      },
    ],
  ])

describe("other threads' agents in a column's header (ADR-0128)", () => {
  test("its members, and what agents talking from it spent", () => {
    const row = agentsRow({
      thread: here,
      members: [fox],
      names,
      budgets: budget(38_000),
    })
    expect(row === null ? "" : agentsWords(row)).toBe(
      "with amber-fox · agents spent 38k of 200k tokens",
    )
  })
  test("a spent budget says so; no member and no budget is no row", () => {
    const row = agentsRow({
      thread: here,
      members: [],
      names,
      budgets: budget(210_000, true),
    })
    expect(row === null ? "" : agentsWords(row)).toBe(
      "agents spent the budget of 200k tokens",
    )
    expect(
      agentsRow({ thread: fox, members: [], names, budgets: budget(1) }),
    ).toBeNull()
  })
})
