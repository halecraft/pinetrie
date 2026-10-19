import {
  entryId,
  THE_AGENT,
  threadIdFor,
  type ValueWrite,
  writerId,
} from "@pinetrie/core"
import { readCardHistories, readPlaces, readRecords } from "@pinetrie/reads"
import {
  ALLOWANCE,
  encodeAnswer,
  encodeMessage,
  encodeRelayMessage,
  newAllowance,
} from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { createAllowances, promptAllowance } from "./allowances.ts"
import {
  applyWrites,
  archiveCanvas,
  basics,
  placesFor,
  putCanvas,
  stepKeeper,
} from "./fakes.ts"
import { createLater } from "./later.ts"

const ada = writerId("ada@example.com")
const here = threadIdFor("here")
const allowance = entryId("m")
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
      allowance,
      by: ada,
    },
    1,
  )

describe("the allowance a run spends is read from its prompt", () => {
  test("an agent's ask spends its chain's allowance; a person's ask names it, and spends nothing", () => {
    expect(promptAllowance(entryId("p"), relay("agent"))).toEqual({
      key: allowance,
      spends: true,
      by: ada,
    })
    expect(promptAllowance(entryId("p"), relay("person"))).toEqual({
      key: allowance,
      spends: false,
      by: ada,
    })
  })
  test("an answer that wakes spends; a person's own message is its own allowance, and spends nothing", () => {
    const answer = (wakes: boolean) =>
      encodeAnswer(
        {
          from: here,
          fromName: "amber-fox",
          relay: entryId("r"),
          source: entryId("s"),
          text: "this",
          wakes,
          allowance,
          by: ada,
        },
        1,
      )
    expect(promptAllowance(entryId("p"), answer(true)).spends).toBe(true)
    expect(promptAllowance(entryId("p"), answer(false)).spends).toBe(false)
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
    expect(promptAllowance(entryId("p"), said)).toEqual({
      key: entryId("p"),
      spends: false,
      by: ada,
    })
  })
})

/** Ada's allowance on `here`'s thread, on an open canvas, through a real late writer. */
function overAllowance() {
  const b = basics()
  putCanvas(b, here)
  applyWrites(b, [
    newAllowance({ message: allowance, thread: here, by: ada, limit: 10 }),
  ])
  const drained: string[] = []
  const keeper = stepKeeper(b)
  const records = {
    writeValues: async (w: readonly ValueWrite[]) => applyWrites(b, w),
  }
  const { placesWriter } = placesFor(b)
  const allowances = createAllowances({
    basics: b,
    runs: { docOf: () => b.root },
    keeper,
    records,
    placesWriter,
    limit: 10,
    later: createLater({
      basics: b,
      keeper,
      placesWriter,
      drain: lane => void drained.push(lane),
    }),
  })
  return { b, keeper, allowances, drained }
}

test("an allowance gone over queues its fact, with its making in its history", async () => {
  const { b, keeper, allowances, drained } = overAllowance()
  allowances.spendFrom(allowance, 20)
  await keeper.idle()
  const [fact] = readPlaces(b.places).filter(c => c.kind === "fact")
  expect(fact).toMatchObject({
    kind: "fact",
    place: { kind: "queued", thread: here },
    content: { fact: { kind: "allowance-spent", allowance, limit: 10 } },
  })
  expect(
    fact === undefined
      ? undefined
      : readCardHistories(b.session).get(fact.id)?.events,
  ).toMatchObject([{ kind: "created", by: null }])
  expect(drained).toEqual([here])
})

test("an allowance gone over after its thread's canvas was archived records the allowance, and tells nobody", async () => {
  const { b, keeper, allowances } = overAllowance()
  archiveCanvas(b)
  allowances.spendFrom(allowance, 20)
  await keeper.idle()
  expect(readPlaces(b.places).filter(c => c.kind === "fact")).toEqual([])
  expect(readRecords(b.session, ALLOWANCE).get(allowance)?.over).toBe(true)
})
