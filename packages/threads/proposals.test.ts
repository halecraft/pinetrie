import {
  entryId,
  rootIdFor,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  entriesById,
  entry,
  personMessage as person,
  toolResultMessage,
} from "./fixtures.ts"
import {
  type AgentMessageLike,
  branchesByProposal,
  indexAsks,
  indexTree,
  type Proposal,
  proposalState,
  type ThreadRecord,
} from "./index.ts"

type Message = AgentMessageLike
const PROPOSAL: Proposal = {
  branches: [
    { title: "one", brief: "do one" },
    { title: "two", brief: "do two" },
  ],
}
const personMessage = (text = "hi"): Message => person(text)
const calls = (call: string): Message => ({
  role: "assistant",
  content: [
    { type: "toolCall", id: call, name: "propose_branches", arguments: {} },
  ],
  stopReason: "toolUse",
})
const proposed = (call: string): Message =>
  toolResultMessage({
    toolCallId: call,
    content: "proposed",
    proposal: PROPOSAL,
  })
const said = (text: string): Message => ({
  role: "assistant",
  content: [{ type: "text", text }],
})

const ADA = writerId("ada@x.io")
const RESULT = entryId("3-r")
/** A run that proposes, then answers; then a later run of the same thread. */
const answered = indexTree(
  entriesById([
    entry("1-p", null, personMessage()),
    entry("2-a", "1-p", calls("c1")),
    entry("3-r", "2-a", proposed("c1")),
    entry("4-a", "3-r", said("the list")),
    entry("5-p", "4-a", personMessage("later")),
    entry("6-a", "5-p", said("later reply")),
  ]),
)
/** A run a Stop ended right after the proposal's result. */
const stopped = indexTree(
  entriesById([
    entry("1-p", null, personMessage()),
    entry("2-a", "1-p", calls("c1")),
    entry("3-r", "2-a", proposed("c1")),
  ]),
)
const branchRecord = (
  name: string,
  row: number,
  entry = RESULT,
): ThreadRecord => ({
  thread: threadIdFor(name),
  root: rootIdFor("r"),
  by: ADA,
  createdAt: 0,
  origin: {
    kind: "fork",
    at: entryId("4-a"),
    how: "branch",
    proposal: { entry, row },
  },
})
const records = (...rs: ThreadRecord[]): ReadonlyMap<ThreadId, ThreadRecord> =>
  new Map(rs.map(r => [r.thread, r]))

const stateNow = (
  index = answered,
  threads: ReadonlyMap<ThreadId, ThreadRecord> = new Map(),
  runningAsk: string | null = null,
) =>
  proposalState({
    index,
    asks: indexAsks(index),
    branches: branchesByProposal(threads),
    proposal: RESULT,
    runningAsk: runningAsk === null ? null : entryId(runningAsk),
  })

describe("proposalState", () => {
  test("is running only while its own run is the one running", () => {
    expect(stateNow(answered, new Map(), "1-p")).toEqual({ kind: "running" })
    expect(stateNow(answered, new Map(), "5-p")).toEqual({
      kind: "ready",
      fork: entryId("4-a"),
    })
  })

  test("forks at the run's last entry, a tool result a Stop left last included", () => {
    expect(stateNow(stopped)).toEqual({ kind: "ready", fork: RESULT })
  })

  test("is spent once a thread record names it, with the presser and each branch by row", () => {
    const started = indexTree(
      entriesById([
        ...Object.values(answered.entries),
        entry("7-c", "4-a", personMessage("@agent do two"), {
          thread: threadIdFor("b"),
        }),
      ]),
    )
    expect(
      stateNow(started, records(branchRecord("b", 1), branchRecord("a", 0))),
    ).toEqual({
      kind: "spent",
      by: ADA,
      fork: entryId("4-a"),
      threads: [
        { thread: threadIdFor("a"), row: 0, started: false },
        { thread: threadIdFor("b"), row: 1, started: true },
      ],
    })
  })

  test("is not spent by a record naming another proposal", () => {
    expect(
      stateNow(answered, records(branchRecord("a", 0, entryId("9-x"))))?.kind,
    ).toBe("ready")
  })

  test("is null at an entry that holds no proposal", () => {
    expect(
      proposalState({
        index: answered,
        asks: indexAsks(answered),
        branches: new Map(),
        proposal: entryId("4-a"),
        runningAsk: null,
      }),
    ).toBeNull()
  })
})
