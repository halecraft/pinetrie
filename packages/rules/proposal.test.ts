import {
  type BranchOut,
  branchesByProposal,
  entryId,
  indexAsks,
  indexTree,
  nonEmpty,
  type Proposal,
  rootIdFor,
  type ThreadId,
  type ThreadRecord,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { entriesOf, entry } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { threadCardOf } from "./fixtures.ts"
import { decodeProposal, parseProposal, planBranchOut } from "./proposal.ts"
import { canvasOf, proposalDraft } from "./task.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const P = threadIdFor("01a0ffd2-0000-7000-8000-0000000000a0")
const OLDER = threadIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
const NEW = [1, 2, 3].map(n =>
  threadIdFor(`01a0ffd2-0000-7000-8000-0000000000b${n}`),
)
const PROPOSAL: Proposal = {
  branches: [
    { title: "one", brief: "do one" },
    { title: "two", brief: "do two" },
    { title: "three", brief: "do three" },
  ],
}
const RESULT = entryId("3-r")
const FORK = entryId("4-a")
const index = indexTree(
  entriesOf([
    entry("1-p", null, { role: "chat", content: "split it" }, { thread: P }),
    entry(
      "2-a",
      "1-p",
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "propose_branches" }],
        stopReason: "toolUse",
      },
      { thread: P },
    ),
    entry(
      "3-r",
      "2-a",
      {
        role: "toolResult",
        toolCallId: "c1",
        content: "ok",
        proposal: PROPOSAL,
      },
      { thread: P },
    ),
    entry(
      "4-a",
      "3-r",
      { role: "assistant", content: [{ type: "text", text: "three things" }] },
      { thread: P },
    ),
  ]),
)
const record = (
  thread: ThreadId,
  origin: ThreadRecord["origin"],
): ThreadRecord => ({
  thread,
  root: ROOT,
  by: ADA,
  createdAt: 1,
  origin,
})
const proposing = threadCardOf({ thread: P, task: TASK, by: ADA, cards: [] })
const older = threadCardOf({
  thread: OLDER,
  task: TASK,
  by: ADA,
  cards: [proposing],
})
const THREADS = new Map([
  [P, record(P, { kind: "root" })],
  [OLDER, record(OLDER, { kind: "fork", at: entryId("1-p"), how: "branch" })],
])
const atLeastOne = <T extends NonNullable<unknown>>(xs: readonly T[]) => {
  const rows = nonEmpty(xs)
  if (rows === null) throw new Error("a press names a row")
  return rows
}
const rows = (how: "open" | "start", ...pressed: number[]): BranchOut => {
  const opened = pressed.map((row, i) => ({ thread: NEW[i] ?? P, row }))
  const base = {
    kind: "branch-out",
    root: ROOT,
    task: TASK,
    proposal: RESULT,
  } as const
  return how === "open"
    ? { ...base, how, branches: atLeastOne(opened) }
    : {
        ...base,
        how,
        branches: atLeastOne(
          opened.map(b => ({
            ...b,
            brief: PROPOSAL.branches[b.row]?.brief ?? "",
          })),
        ),
      }
}
const plan = (
  press: BranchOut,
  over: Partial<Parameters<typeof planBranchOut>[0]> = {},
) =>
  planBranchOut({
    press,
    index,
    asks: indexAsks(index),
    branches: branchesByProposal(THREADS),
    runningAsk: null,
    sender: ADA,
    cards: [proposing, older],
    threads: THREADS,
    taskOfThread: new Map([
      [P, TASK],
      [OLDER, TASK],
    ]),
    tasks: new Set([TASK]),
    now: 7,
    ...over,
  })

describe("parseProposal", () => {
  test("keeps the order and trims each title and brief", () => {
    expect(
      parseProposal({
        branches: [
          { title: " a ", brief: " do a " },
          { title: "b", brief: "do b" },
        ],
      }),
    ).toEqual({
      branches: [
        { title: "a", brief: "do a" },
        { title: "b", brief: "do b" },
      ],
    })
  })

  test("refuses no branch, a blank title and a blank brief", () => {
    for (const args of [
      {},
      { branches: [] },
      { branches: [{ title: " ", brief: "x" }] },
      { branches: [{ title: "x", brief: "" }] },
    ])
      expect(parseProposal(args)).toHaveProperty("refused")
  })

  test("decodeProposal reads only what parseProposal accepts", () => {
    expect(decodeProposal({ branches: [{ title: "x" }] })).toBeUndefined()
    expect(decodeProposal(PROPOSAL)).toEqual(PROPOSAL)
  })
})

describe("planBranchOut", () => {
  test("opens each row after the one before it, the first right after the proposing thread", () => {
    const opened = plan(rows("open", 0, 1, 2))
    if ("kind" in opened) throw new Error(opened.why)
    const cards = opened.opening.steps.flatMap(s =>
      s.kind === "write" ? [s.record] : [],
    )
    const canvas = canvasOf(
      [
        ...[proposing, older].filter(c => !cards.some(m => m.id === c.id)),
        ...cards,
      ],
      TASK,
    ).map(c => c.id)
    expect(canvas).toEqual([P, ...NEW, OLDER])
  })

  test("lands them in order at the canvas's end when the proposing thread is not on it", () => {
    const opened = plan(rows("open", 0, 1), { cards: [older] })
    if ("kind" in opened) throw new Error(opened.why)
    const made = opened.opening.steps.flatMap(s =>
      s.kind === "write" ? [s.record] : [],
    )
    expect(canvasOf([older, ...made], TASK).map(c => c.id)).toEqual([
      OLDER,
      NEW[0],
      NEW[1],
    ])
  })

  test("each record forks at the run's last entry and names the proposal and its row", () => {
    const opened = plan(rows("open", 0, 2))
    if ("kind" in opened) throw new Error(opened.why)
    expect(opened.opening.records).toMatchObject([
      {
        value: {
          origin: {
            kind: "fork",
            at: FORK,
            how: "branch",
            proposal: { entry: RESULT, row: 0 },
          },
        },
      },
      { value: { origin: { proposal: { entry: RESULT, row: 2 } } } },
    ])
    expect(opened.fact).toEqual({
      kind: "branched",
      lane: P,
      by: ADA,
      proposal: RESULT,
      how: "opened",
      titles: ["one", "three"],
    })
  })

  test("Open plans no send; Start sends each brief as the presser's message to the agent", () => {
    expect(plan(rows("open", 0))).not.toHaveProperty("sends")
    const started = plan(rows("start", 0, 1))
    if (!("sends" in started)) throw new Error("no sends")
    expect(started.sends).toMatchObject([
      {
        kind: "chat",
        text: "@agent do one",
        root: ROOT,
        at: { kind: "branch", thread: NEW[0], at: FORK, task: TASK },
        mentions: [{ kind: "agent" }],
        card: null,
      },
      { text: "@agent do two" },
    ])
  })

  test("a brief that names a person still asks the agent", () => {
    const press = rows("start", 0)
    const started = plan({
      ...press,
      branches: [{ thread: NEW[0] ?? P, row: 0, brief: "@bea look" }],
    } as BranchOut)
    if (!("sends" in started)) throw new Error("no sends")
    expect(started.sends[0].text).toBe("@agent @bea look")
    expect(started.sends[0].mentions.some(m => m.kind === "agent")).toBe(true)
  })

  test("refuses while its run runs, once a record names the proposal, and past its last row", () => {
    expect(plan(rows("open", 0), { runningAsk: entryId("1-p") })).toEqual({
      kind: "refused",
      why: "running",
    })
    const spent = new Map([
      ...THREADS,
      [
        NEW[2] ?? P,
        record(NEW[2] ?? P, {
          kind: "fork",
          at: FORK,
          how: "branch",
          proposal: { entry: RESULT, row: 1 },
        }),
      ],
    ])
    expect(
      plan(rows("open", 0), { branches: branchesByProposal(spent) }),
    ).toEqual({
      kind: "refused",
      why: "spent",
    })
    expect(plan(rows("open", 3))).toEqual({ kind: "refused", why: "no-row" })
  })

  test("refuses a task that is not the proposing thread's", () => {
    expect(
      plan({
        ...rows("open", 0),
        task: taskIdFor("01a0ffd2-0000-7000-8000-00000000000e"),
      }),
    ).toEqual({
      kind: "refused",
      why: "unknown",
    })
  })
})

describe("proposalDraft", () => {
  const opened = record(NEW[0] ?? P, {
    kind: "fork",
    at: FORK,
    how: "branch",
    proposal: { entry: RESULT, row: 1 },
  })
  test("is the row's brief asked of the agent, for its opener alone", () => {
    expect(proposalDraft({ record: opened, index, me: ADA })).toBe(
      "@agent do two",
    )
    expect(proposalDraft({ record: opened, index, me: BEA })).toBeUndefined()
  })

  test("is gone once the thread has started, and absent for a branch with no proposal", () => {
    const started = indexTree(
      entriesOf([
        ...Object.values(index.entries),
        entry(
          "5-c",
          "4-a",
          { role: "chat", content: "@agent do two" },
          {
            thread: NEW[0] ?? P,
          },
        ),
      ]),
    )
    expect(
      proposalDraft({ record: opened, index: started, me: ADA }),
    ).toBeUndefined()
    expect(
      proposalDraft({
        record: record(OLDER, { kind: "fork", at: FORK, how: "branch" }),
        index,
        me: ADA,
      }),
    ).toBeUndefined()
  })
})
