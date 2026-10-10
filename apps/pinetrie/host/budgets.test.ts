import { entryId, THE_AGENT, threadIdFor, writerId } from "@pinetrie/core"
import { encodeAnswer, encodeChat, encodeRelayMessage } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { promptBudget } from "./budgets.ts"

const ada = writerId("ada@example.com")
const here = threadIdFor("here")
const budget = entryId("m")
const relay = (asker: "person" | "agent") =>
  encodeRelayMessage(
    {
      from: here,
      fromName: "sable-meadow",
      source: entryId("s"),
      asker:
        asker === "agent"
          ? { kind: "agent", thread: here }
          : { kind: "person", writer: ada },
      askerName: "x",
      text: "what next?",
      budget,
      by: ada,
    },
    1,
  )

describe("the budget a run spends is read from its prompt (ADR-0128)", () => {
  test("an agent's ask spends its chain's budget; a person's ask names it, and spends nothing", () => {
    expect(promptBudget(entryId("p"), relay("agent"))).toEqual({
      key: budget,
      spends: true,
      by: ada,
    })
    expect(promptBudget(entryId("p"), relay("person"))).toEqual({
      key: budget,
      spends: false,
      by: ada,
    })
  })
  test("an answer that wakes spends; a person's own message is its own budget, and spends nothing", () => {
    const answer = (wakes: boolean) =>
      encodeAnswer(
        {
          from: here,
          fromName: "amber-fox",
          relay: entryId("r"),
          source: entryId("s"),
          text: "this",
          wakes,
          budget,
          by: ada,
        },
        1,
      )
    expect(promptBudget(entryId("p"), answer(true)).spends).toBe(true)
    expect(promptBudget(entryId("p"), answer(false)).spends).toBe(false)
    const chat = encodeChat(
      {
        author: ada,
        authorName: "Ada",
        text: "go",
        compels: { kind: "agent", agent: THE_AGENT },
        sendId: "s",
      },
      1,
    )
    expect(promptBudget(entryId("p"), chat)).toEqual({
      key: entryId("p"),
      spends: false,
      by: ada,
    })
  })
})
