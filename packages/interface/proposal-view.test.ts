import {
  type EntryLike,
  entryId,
  indexAsks,
  indexTree,
  type LaneView,
  type Proposal,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { entriesById, entry } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  columnProposals,
  NO_PROPOSAL_MEMORY,
  type ProposalFacts,
  proposalView,
} from "./proposal-view.ts"

type Message = NonNullable<EntryLike["message"]>
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const P = threadIdFor("01a0ffd2-0000-7000-8000-0000000000a0")
const B0 = threadIdFor("01a0ffd2-0000-7000-8000-0000000000b0")
const B1 = threadIdFor("01a0ffd2-0000-7000-8000-0000000000b1")
const RESULT = entryId("3-r")
const FORK = entryId("4-a")
const PROPOSAL: Proposal = {
  branches: [
    { title: "one", brief: "do one\nin detail" },
    { title: "two", brief: "do two" },
    { title: "three", brief: "do three" },
  ],
}
const on = (id: string, parent: string | null, m: Message) =>
  entry(id, parent, m, { thread: P })
const index = indexTree(
  entriesById([
    on("1-p", null, { role: "person", content: "split it" }),
    on("2-a", "1-p", {
      role: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "propose_branches" }],
    }),
    on("3-r", "2-a", {
      role: "toolResult",
      toolCallId: "c1",
      content: "ok",
      proposal: PROPOSAL,
    }),
    on("4-a", "3-r", {
      role: "assistant",
      content: [{ type: "text", text: "three things" }],
    }),
  ]),
)
const asks = indexAsks(index)
const nodes = [entryId("1-p"), entryId("2-a"), FORK]
const lane = (running: boolean): LaneView => ({
  name: P,
  tip: FORK,
  running,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
})
const facts = (
  over: Partial<Parameters<typeof columnProposals>[0]> = {},
): ProposalFacts => {
  const found = columnProposals({
    nodes,
    index,
    asks,
    branches: new Map(),
    lanes: [lane(false)],
    me: ADA,
    ...over,
  })
    .get(entryId("1-p"))
    ?.at(0)
  if (found === undefined) throw new Error("no proposal on the path")
  return found
}
const spent = (
  threads: readonly { thread: ThreadId; row: number }[],
): ReadonlyMap<
  typeof RESULT,
  readonly { thread: ThreadId; row: number; by: typeof ADA }[]
> => new Map([[RESULT, threads.map(t => ({ ...t, by: ADA }))]])
const view = (
  f: ProposalFacts,
  over: Partial<Parameters<typeof proposalView>[0]> = {},
) =>
  proposalView({
    facts: f,
    memory: NO_PROPOSAL_MEMORY,
    readOnly: null,
    nameOf: w => (w === ADA ? "Ada" : "Bea"),
    ...over,
  })

describe("columnProposals", () => {
  test("finds a proposal under the ask that made it, from a result no column draws", () => {
    expect(facts()).toMatchObject({
      proposal: RESULT,
      state: { kind: "ready", fork: FORK },
      unsent: [],
    })
  })

  test("reads running from the proposing lane", () => {
    expect(facts({ lanes: [lane(true)] }).state).toEqual({ kind: "running" })
  })

  test("names your unsent branches once you opened them, and nobody else's", () => {
    const branches = spent([
      { thread: B0, row: 0 },
      { thread: B1, row: 2 },
    ])
    expect(facts({ branches }).unsent).toEqual([
      { thread: B0, row: 0 },
      { thread: B1, row: 2 },
    ])
    expect(facts({ branches, me: BEA }).unsent).toEqual([])
  })
})

describe("proposalView", () => {
  test("Start and Open count the rows kept, and press them with their briefs as edited", () => {
    const v = view(facts(), {
      memory: {
        ...NO_PROPOSAL_MEMORY,
        dropped: new Set([1]),
        edited: new Map([[2, "do three, carefully"]]),
      },
    })
    expect(v.start?.label).toBe("Start 2")
    expect(v.open?.label).toBe("Open 2")
    expect(v.open?.press).toEqual({
      kind: "open",
      rows: [
        { row: 0, brief: "do one\nin detail", edited: false },
        { row: 2, brief: "do three, carefully", edited: true },
      ],
    })
    expect(v.rows[0]?.firstLine).toBe("do one")
  })

  test("draws no Start or Open while the run runs, or in a column nothing may be written in, saying why", () => {
    const running = view(facts({ lanes: [lane(true)] }))
    expect(running.start).toBeNull()
    expect(running.open).toBeNull()
    expect(running.state).toBe("waiting for the run to end")
    const held = view(facts(), { readOnly: "Bea has it" })
    expect(held.start).toBeNull()
    expect(held.open).toBeNull()
    expect(held.state).toBe("Bea has it")
    expect(held.editable).toBe(false)
  })

  test("with every row dropped, Start and Open stay drawn, disabled", () => {
    const v = view(facts(), {
      memory: { ...NO_PROPOSAL_MEMORY, dropped: new Set([0, 1, 2]) },
    })
    expect(v.start).toEqual({ label: "Start 0", press: null })
    expect(v.open).toEqual({ label: "Open 0", press: null })
  })

  test("spent, it offers Send to its presser alone, counting their unsent branches", () => {
    const branches = spent([
      { thread: B0, row: 0 },
      { thread: B1, row: 1 },
    ])
    const mine = view(facts({ branches }))
    expect(mine.start).toBeNull()
    expect(mine.send).toEqual({
      label: "Send 2",
      press: {
        kind: "send",
        fork: FORK,
        threads: [
          { thread: B0, row: 0 },
          { thread: B1, row: 1 },
        ],
      },
    })
    expect(mine.state).toBe("opened by Ada · 2 unsent")
    const theirs = view(facts({ branches, me: BEA }))
    expect(theirs.send).toBeNull()
    expect(theirs.state).toBe("opened by Ada · 2 unsent")
  })
})
