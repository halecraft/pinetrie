import {
  entryId,
  type Reach,
  type ThreadName,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
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

const owl = threadIdFor("owl")
const bea = writerId("bea@example.com")
const reach = {
  inReach: new Set([fox]),
  threadReach: (): Reach => ({ kind: "held", by: bea }),
  nameOf: () => "Bea",
}

describe("other threads' agents in a column's header", () => {
  test("a member out of reach is named away, with why", () => {
    const row = agentsRow({
      ...reach,
      thread: here,
      members: [fox, owl],
      names: new Map([...names, [owl, "slate-owl" as ThreadName]]),
      allowances: new Map(),
    })
    expect(row === null ? "" : agentsWords(row)).toBe(
      "with amber-fox, slate-owl (Bea has it)",
    )
  })
  test("its members, and what agents talking from it spent", () => {
    const row = agentsRow({
      ...reach,
      thread: here,
      members: [fox],
      names,
      allowances: budget(38_000),
    })
    expect(row === null ? "" : agentsWords(row)).toBe(
      "with amber-fox · agents used 38k of their 200k-token allowance",
    )
  })
  test("a spent budget says so; no member and no budget is no row", () => {
    const row = agentsRow({
      ...reach,
      thread: here,
      members: [],
      names,
      allowances: budget(210_000, true),
    })
    expect(row === null ? "" : agentsWords(row)).toBe(
      "agents used up their 200k-token allowance",
    )
    expect(
      agentsRow({
        ...reach,
        thread: fox,
        members: [],
        names,
        allowances: budget(1),
      }),
    ).toBeNull()
  })
})
