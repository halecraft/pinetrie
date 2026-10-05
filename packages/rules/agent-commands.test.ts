import {
  atEntry,
  type CardRecord,
  cardId,
  commitId,
  entryId,
  laneNameForThread,
  type OfferRecord,
  rootIdFor,
  type ThreadName,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  catchUpAnswer,
  catchUpRefusal,
  encodeUpdate,
  type Floor,
  type ParentNow,
  planCatchUpCall,
  planCopyReady,
  planResolution,
  planSplitCall,
  resolutionFloor,
  splitRefusal,
} from "./index.ts"

/** A resolution's floor with room to spare (ADR-0084). */
function floor(): Floor {
  const found = resolutionFloor({
    budget: { tokens: 10_000, estimate: c => Math.ceil(c.length / 4) },
    skill: null,
    intent: "",
    incoming: "The project's work",
  })
  if (found.kind !== "fits") throw new Error("the floor does not fit")
  return found.floor
}

const LANE = laneNameForThread("1")
const ADA = writerId("ada@x.io")
const [B, C, D] = [commitId("b"), commitId("c"), commitId("d")]
const MOVE = {
  base: { kind: "line" },
  bookmark: "pinetrie-onto",
  from: B,
  to: C,
} as const

const parent = (over: Partial<ParentNow> = {}): ParentNow => ({
  kind: "parent",
  lane: laneNameForThread("p"),
  name: "amber-fox" as ThreadName,
  newest: D,
  caughtUpWith: C,
  conflicts: [],
  ...over,
})

describe("planCatchUpCall (ADR-0080)", () => {
  const call = (over: Partial<Parameters<typeof planCatchUpCall>[0]> = {}) =>
    planCatchUpCall({
      from: "base",
      own: true,
      calls: 1,
      base: { kind: "brings", move: MOVE, files: 2 },
      parent: null,
      parentRunning: false,
      ...over,
    })

  test("the base: brings, or a move not yet read, merges", () => {
    expect(call()).toEqual({ kind: "merge", command: "bring-up-to-date" })
    expect(call({ base: { kind: "unknown" } })).toEqual({
      kind: "merge",
      command: "bring-up-to-date",
    })
  })

  test("the parent: ahead and idle merges", () => {
    expect(call({ from: "parent", parent: parent() })).toEqual({
      kind: "merge",
      command: "catch-up-with-parent",
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
      { from: "parent", parent: parent({ caughtUpWith: D }) },
      "nothing-new",
    ],
  ] as const)("refused: %s", (_, over, why) => {
    expect(call(over as never)).toEqual({ kind: "refused", why })
  })

  test("each refusal says what to do", () => {
    expect(catchUpRefusal("alone")).toContain("alone in its turn")
    expect(catchUpRefusal("off-line")).toContain("Return to this thread's tip")
    expect(catchUpRefusal("no-bookmark")).toBe(
      "Not caught up: this thread's copy has lost its bookmark.",
    )
    expect(catchUpRefusal({ reason: "set up the line first" })).toBe(
      "Not caught up: set up the line first.",
    )
  })
})

describe("planCopyReady (ADR-0080)", () => {
  test.each([
    [
      "on the bookmark",
      { parents: [B], bookmark: B, descends: false },
      "ready",
    ],
    [
      "on the agent's own commit on it",
      { parents: [C], bookmark: B, descends: true },
      "ready",
    ],
    [
      "on another line: a split's stack",
      { parents: [C], bookmark: B, descends: false },
      "off-line",
    ],
    [
      "on two parents",
      { parents: [B, C], bookmark: B, descends: false },
      "off-line",
    ],
    [
      "with no bookmark: refused as that, not as off the line (S114)",
      { parents: [B], bookmark: null, descends: false },
      "no-bookmark",
    ],
  ] as const)("%s", (_, copy, ready) => {
    expect(planCopyReady(copy)).toBe(ready)
  })
})

describe("catchUpAnswer", () => {
  test("clean: the update's text, and what it merged; conflicted: the conflicts and what it merged; nothing: nothing new", () => {
    const update = encodeUpdate(
      {
        lane: LANE,
        from: { kind: "line" },
        bookmark: "pinetrie-onto",
        merged: C,
        commits: ["a change"],
        files: ["a.ts"],
        by: ADA,
      },
      1,
    )
    expect(
      catchUpAnswer({ kind: "clean", message: update, merged: C }),
    ).toEqual({
      text: update.content,
      isError: false,
      details: { merged: [C] },
    })
    const land = planResolution({
      floor: floor(),
      files: [],
      details: { lane: LANE, yours: [C], by: ADA },
      timestamp: 1,
    })
    expect(catchUpAnswer({ kind: "conflicted", message: land })).toEqual({
      text: land.content,
      isError: false,
      details: { merged: [C] },
    })
    expect(catchUpAnswer({ kind: "nothing" })).toMatchObject({
      isError: true,
      details: null,
    })
  })
})

describe("planSplitCall (ADR-0080)", () => {
  const ROOT_ID = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
  const open = {
    kind: "open",
    record: {} as OfferRecord,
  } as const
  const split = (over: Partial<Parameters<typeof planSplitCall>[0]> = {}) =>
    planSplitCall({
      offer: open,
      cards: [],
      lane: LANE,
      prompt: "chat",
      running: true,
      by: ADA,
      id: cardId("s-1"),
      root: ROOT_ID,
      at: atEntry(entryId("e-1")),
      ...over,
    })
  const queuedSplit: CardRecord = {
    id: cardId("q-1"),
    owner: ADA,
    placer: ADA,
    place: {
      kind: "queued",
      root: ROOT_ID,
      at: atEntry(entryId("e-1")),
      lane: LANE,
      order: "0000000001",
      by: ADA,
      seen: "",
    },
    carries: { kind: "message", command: "split" },
    unsent: null,
  }

  test("a split card queued by the person behind the run, with no text, from any run", () => {
    for (const prompt of ["chat", "land"])
      expect(split({ prompt })).toMatchObject({
        kind: "queue",
        step: {
          kind: "write",
          record: {
            owner: ADA,
            place: { kind: "queued", lane: LANE, by: ADA, seen: "" },
            carries: { kind: "message", command: "split" },
          },
        },
      })
  })

  test.each([
    ["no open offer", { offer: { kind: "none" } }, "no-offer"],
    ["a split already queued", { cards: [queuedSplit] }, "queued"],
    ["a split running", { prompt: "stack" }, "splitting"],
  ] as const)("refused: %s", (_, over, why) => {
    expect(split(over as never)).toEqual({ kind: "refused", why })
    expect(splitRefusal(why)).not.toBe("")
  })
})
