import {
  type CardRecord,
  commitId,
  type JjProposedChangesRecord,
  pointFromCommit,
  rootIdFor,
  type ThreadName,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  encodeUpdate,
  type Floor,
  getLatestAnswer,
  getLatestRefusal,
  type ParentNow,
  planGetLatestCall,
  planResolution,
  planSplitCall,
  resolutionFloor,
  resolveAnswer,
  splitRefusal,
} from "./index.ts"

/** A resolution's floor with room to spare. */
function floor(): Floor {
  const found = resolutionFloor({
    budget: { tokens: 10_000, estimate: c => Math.ceil(c.length / 4) },
    skill: null,
    intent: "",
    latest: "Accepted work",
  })
  if (found.kind !== "fits") throw new Error("the floor does not fit")
  return found.floor
}

const LANE = threadIdFor("1")
const ADA = writerId("ada@x.io")
const [B, C, D] = [commitId("b"), commitId("c"), commitId("d")]
/** `C` and `D` as the lane's states. */
const [PC, PD] = [pointFromCommit(C), pointFromCommit(D)]
const MOVE = {
  base: { kind: "accepted" },
  bookmark: "pinetrie-accepted",
  from: pointFromCommit(B),
  to: pointFromCommit(C),
} as const

const parent = (over: Partial<ParentNow> = {}): ParentNow => ({
  kind: "parent",
  lane: threadIdFor("p"),
  name: "amber-fox" as ThreadName,
  newest: PD,
  upToDateWith: PC,
  conflicts: [],
  ...over,
})

describe("planGetLatestCall", () => {
  const call = (over: Partial<Parameters<typeof planGetLatestCall>[0]> = {}) =>
    planGetLatestCall({
      from: "base",
      own: true,
      calls: 1,
      base: { kind: "brings", move: MOVE, files: 2 },
      parent: null,
      parentRunning: false,
      ...over,
    })

  test("the base: brings, or a move not yet read, merges", () => {
    expect(call()).toEqual({ kind: "merge", command: "get-latest" })
    expect(call({ base: { kind: "unknown" } })).toEqual({
      kind: "merge",
      command: "get-latest",
    })
  })

  test("the parent: ahead and idle merges", () => {
    expect(call({ from: "parent", parent: parent() })).toEqual({
      kind: "merge",
      command: "get-latest-from-parent",
    })
  })

  test.each([
    ["no copy of its own", { own: false }, "no-copy"],
    ["two calls in its turn", { calls: 2 }, "alone"],
    ["a base that has not moved", { base: { kind: "current" } }, "nothing-new"],
    [
      "a move that is the lane's own work",
      { base: { kind: "nothing-new" } },
      "nothing-new",
    ],
    ["no parent", { from: "parent" }, "no-parent"],
    [
      "a parent that runs",
      { from: "parent", parent: parent(), parentRunning: true },
      "parent-running",
    ],
    [
      "a parent not ahead",
      { from: "parent", parent: parent({ upToDateWith: PD }) },
      "nothing-new",
    ],
  ] as const)("refused: %s", (_, over, why) => {
    expect(call(over as never)).toEqual({ kind: "refused", why })
  })

  test("each refusal says what to do", () => {
    expect(getLatestRefusal("alone")).toContain("alone in its turn")
    expect(getLatestRefusal("off-line")).toContain(
      "Return to this thread's tip",
    )
    expect(getLatestRefusal("no-bookmark")).toBe(
      "Did not get the latest: this thread's copy has lost its bookmark.",
    )
    expect(getLatestRefusal({ reason: "set up accepted work first" })).toBe(
      "Did not get the latest: set up accepted work first.",
    )
  })
})

describe("getLatestAnswer", () => {
  test("the answer says what it merged, and any conflicts", () => {
    const update = encodeUpdate(
      {
        lane: LANE,
        from: { kind: "accepted" },
        merged: PC,
        commits: ["a change"],
        files: ["a.ts"],
        by: ADA,
      },
      1,
    )
    expect(
      getLatestAnswer({ kind: "clean", message: update, merged: PC }),
    ).toEqual({
      text: update.content,
      isError: false,
      details: { merged: [PC] },
    })
    const land = planResolution({
      floor: floor(),
      files: [],
      details: { lane: LANE, merged: [PC], by: ADA },
      timestamp: 1,
    })
    expect(getLatestAnswer({ kind: "conflicted", message: land })).toEqual({
      text: land.content,
      isError: false,
      details: { merged: [PC] },
    })
    expect(getLatestAnswer({ kind: "nothing" })).toMatchObject({
      isError: true,
      details: null,
    })
  })
})

test("resolveAnswer: a path closed, or why not, each worded", () => {
  expect(resolveAnswer("a.txt", { kind: "resolved" }).isError).toBe(false)
  for (const why of ["no-copy", "no-conflict", "markers"] as const) {
    const answer = resolveAnswer("a.txt", { kind: "refused", why })
    expect(answer.isError).toBe(true)
    expect(answer.text).not.toBe("")
  }
})

describe("planSplitCall", () => {
  const _ROOT_ID = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
  const open = {
    kind: "open",
    record: {} as JjProposedChangesRecord,
  } as const
  const split = (over: Partial<Parameters<typeof planSplitCall>[0]> = {}) =>
    planSplitCall({
      history: "jj",
      proposed: open,
      cards: [],
      lane: LANE,
      prompt: "person",
      running: true,
      by: ADA,
      id: textCardId("s-1"),
      ...over,
    })
  const queuedSplit: CardRecord = {
    kind: "text",
    id: textCardId("q-1"),
    owner: ADA,
    placer: ADA,
    place: {
      kind: "queued",
      thread: LANE,
      order: "0000000001",
      by: ADA,
      seen: "",
    },
    content: { command: "split", unsent: null, origin: null },
  }

  test("a split card queued by the person behind the run, with no text, from any run", () => {
    for (const prompt of ["person", "land"])
      expect(split({ prompt })).toMatchObject({
        kind: "queue",
        step: {
          kind: "write",
          record: {
            kind: "text",
            owner: ADA,
            place: { kind: "queued", thread: LANE, by: ADA, seen: "" },
            content: { command: "split", unsent: null, origin: null },
          },
        },
      })
  })

  test.each([
    [
      "a folder lane, whose proposed changes are files",
      { history: "folder" },
      "folder",
    ],
    [
      "no open proposed changes",
      { proposed: { kind: "none" } },
      "no-proposed-changes",
    ],
    ["a split already queued", { cards: [queuedSplit] }, "queued"],
    ["a split running", { prompt: "stack" }, "splitting"],
  ] as const)("refused: %s", (_, over, why) => {
    expect(split(over as never)).toEqual({ kind: "refused", why })
    expect(splitRefusal(why)).not.toBe("")
  })
})
