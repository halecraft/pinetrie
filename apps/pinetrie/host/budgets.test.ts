import { entryId, THE_AGENT, threadIdFor, writerId } from "@pinetrie/core"
import { readCardHistories, readPlaces } from "@pinetrie/reads"
import {
  encodeAnswer,
  encodeChat,
  encodeRelayMessage,
  newBudget,
} from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { createBudgets, promptBudget } from "./budgets.ts"
import { applyWrites, basics, placesFor } from "./fakes.ts"

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

describe("the budget a run spends is read from its prompt", () => {
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

test("a budget gone over queues its fact, with its making in its history", async () => {
  const b = basics()
  applyWrites(b, [
    newBudget({ message: budget, thread: here, by: ada, limit: 10 }),
  ])
  const drained: string[] = []
  const budgets = createBudgets({
    basics: b,
    keeper: { run: step => step() },
    records: { writeValues: async w => applyWrites(b, w) },
    placesWriter: placesFor(b).placesWriter,
    limit: 10,
    drain: lane => void drained.push(lane),
  })
  budgets.spendFrom(budget, 20)
  await new Promise(r => setTimeout(r, 0))
  const [fact] = readPlaces(b.places)
  expect(fact).toMatchObject({
    kind: "fact",
    place: { kind: "queued", thread: here },
    content: { fact: { kind: "budget-spent", budget, limit: 10 } },
  })
  expect(
    fact === undefined
      ? undefined
      : readCardHistories(b.session).get(fact.id)?.events,
  ).toMatchObject([{ kind: "created", by: null }])
  expect(drained).toEqual([here])
})
