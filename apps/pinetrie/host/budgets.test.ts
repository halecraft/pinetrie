import {
  entryId,
  THE_AGENT,
  threadIdFor,
  type ValueWrite,
  writerId,
} from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { readCardHistories, readPlaces, readRecords } from "@pinetrie/reads"
import {
  BUDGET,
  encodeAnswer,
  encodeMessage,
  encodeRelayMessage,
  newBudget,
} from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { createBudgets, promptBudget } from "./budgets.ts"
import {
  applyWrites,
  archiveCanvas,
  basics,
  placesFor,
  putCanvas,
} from "./fakes.ts"
import { createLater } from "./later.ts"

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
    const said = encodeMessage(
      {
        author: ada,
        authorName: "Ada",
        text: "go",
        compels: { kind: "agent", agent: THE_AGENT },
        sendId: "s",
      },
      1,
    )
    expect(promptBudget(entryId("p"), said)).toEqual({
      key: entryId("p"),
      spends: false,
      by: ada,
    })
  })
})

/** Ada's budget on `here`'s thread, on an open canvas, through a real late writer. */
function overBudget() {
  const b = basics()
  putCanvas(b, here)
  applyWrites(b, [
    newBudget({ message: budget, thread: here, by: ada, limit: 10 }),
  ])
  const drained: string[] = []
  const keeper = createKeeper()
  const records = {
    writeValues: async (w: readonly ValueWrite[]) => applyWrites(b, w),
  }
  const { placesWriter } = placesFor(b)
  const budgets = createBudgets({
    basics: b,
    keeper,
    records,
    placesWriter,
    limit: 10,
    later: createLater({
      basics: b,
      keeper,
      records,
      placesWriter,
      drain: lane => void drained.push(lane),
    }),
  })
  return { b, keeper, budgets, drained }
}

test("a budget gone over queues its fact, with its making in its history", async () => {
  const { b, keeper, budgets, drained } = overBudget()
  budgets.spendFrom(budget, 20)
  await keeper.idle()
  const [fact] = readPlaces(b.places).filter(c => c.kind === "fact")
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

test("a budget gone over after its thread's canvas was archived records the budget, and tells nobody", async () => {
  const { b, keeper, budgets } = overBudget()
  archiveCanvas(b)
  budgets.spendFrom(budget, 20)
  await keeper.idle()
  expect(readPlaces(b.places).filter(c => c.kind === "fact")).toEqual([])
  expect(readRecords(b.session, BUDGET).get(budget)?.over).toBe(true)
})
