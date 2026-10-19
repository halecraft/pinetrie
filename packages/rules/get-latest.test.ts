import {
  type BaseMerge,
  commitId,
  type DiskPath,
  entryId,
  pointId,
  revisionMessage,
  type ThreadName,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { indexTree } from "@pinetrie/threads"
import { fromParents, personMessage } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import type { AcceptedRecord } from "./accepted.ts"
import { getLatestRefusal } from "./agent-commands.ts"
import {
  changeReason,
  planGetLatest,
  planLatestInRun,
  planLatestInRunAnswer,
  planSettle,
} from "./get-latest.ts"
import type { Floor, PromptBudget } from "./land.ts"
import { removalsText, type StaleRemoval } from "./removals.ts"
import { encodeUpdate } from "./update.ts"

const NONE = removalsText([])
const LANE = threadIdFor("0123456789abcdef")

describe("changeReason", () => {
  test("a revision's reason is its message, attributed to its author or the agent; else its first line", () => {
    const index = indexTree(
      fromParents({ e1: null, e2: "e1" }, id =>
        id === "e1"
          ? personMessage("rename the flag\nand its docs", { author: "Ada" })
          : {
              role: "assistant",
              content: [{ type: "text", text: "renamed it" }],
            },
      ),
    )
    const of = (entry: string) =>
      changeReason(
        index,
        revisionMessage({ title: "t", entry: entryId(entry), lane: LANE }),
      )
    expect(of("e1")).toBe("Ada: rename the flag")
    expect(of("e2")).toBe("agent: renamed it")
    expect(changeReason(index, "a commit of yours\n\nwith a body")).toBe(
      "a commit of yours",
    )
  })
})

const ADA = writerId("ada@example.com")
const ACCEPTED = pointId("11110000")
const OURS = pointId("22220000")
const MERGE = pointId("33330000")
const acceptedFrom: BaseMerge = {
  kind: "accepted",
  point: ACCEPTED,
  mark: false,
}
const parentFrom: BaseMerge = {
  kind: "parent",
  lane: threadIdFor("p"),
  name: "amber-fox" as ThreadName,
  point: ACCEPTED,
  upToDateWith: OURS,
}
/** pi's estimate of a custom message: a token per four characters. */
const allowanceOf = (tokens: number): PromptBudget => ({
  tokens,
  estimate: content => Math.ceil(content.length / 4),
})

/** The floor `planGetLatest` settles for `from`, with room for anything. */
function floorFor(from: BaseMerge, intent: string): Floor {
  const planned = planGetLatest(from, {
    budget: allowanceOf(100_000),
    skill: null,
    intent,
  })
  if (planned.kind !== "merge") throw new Error("refused")
  return planned.floor
}

describe("planGetLatest: whether a catch-up may merge", () => {
  test("refused, before the merge, when even the smallest prompt would not fit; it names what can be shortened", () => {
    const planned = planGetLatest(acceptedFrom, {
      budget: allowanceOf(50),
      skill: null,
      intent: "x".repeat(400),
    })
    expect(planned.kind).toBe("refused")
    if (planned.kind === "refused") {
      expect(planned.reason).toContain("over the 50")
      expect(planned.reason).toContain("the card's text")
      expect(planned.reason).toContain("resolve-conflicts skill")
    }
  })
  test("with room, it merges what it was given, and the prompt names whose work comes in", () => {
    const planned = planGetLatest(parentFrom, {
      budget: allowanceOf(1_000),
      skill: null,
      intent: "",
    })
    if (planned.kind !== "merge") throw new Error("refused")
    expect(planned.from).toEqual(parentFrom)
    expect(planned.floor.content).toContain(
      "The work of the thread this one branched from (amber-fox) was merged",
    )
  })
})

describe("planSettle: what a merge comes to", () => {
  const ctx = {
    lane: LANE,
    by: ADA,
    from: acceptedFrom,
    index: indexTree({}),
    now: 7,
  }
  test("clean: the update in the thread, naming its base", () => {
    const facts = {
      kind: "clean",
      from: ACCEPTED,
      ours: OURS,
      merge: MERGE,
      files: ["a.txt"],
      commits: ["yours one"],
      removed: [],
    } as const
    expect(planSettle(facts, ctx)).toEqual({
      kind: "clean",
      message: encodeUpdate(
        {
          lane: LANE,
          from: { kind: "accepted" },
          merged: ACCEPTED,
          files: ["a.txt"],
          commits: ["yours one"],
          by: ADA,
        },
        7,
        NONE,
      ),
      merge: MERGE,
    })
    const unfinished: BaseMerge = {
      kind: "unfinished",
      bookmark: "wip/x",
      commit: commitId(ACCEPTED),
      under: commitId(OURS),
      on: OURS,
    }
    expect(planSettle(facts, { ...ctx, from: unfinished })).toMatchObject({
      message: encodeUpdate(
        {
          lane: LANE,
          from: { kind: "unfinished", bookmark: "wip/x" },
          merged: ACCEPTED,
          files: ["a.txt"],
          commits: ["yours one"],
          by: ADA,
        },
        7,
        NONE,
      ),
    })
  })
  test("a settle's message names what getting the latest removed, clean or conflicted", () => {
    const removed: readonly StaleRemoval[] = [
      {
        paths: ["node_modules" as DiskPath],
        cause: { kind: "changed", path: "pnpm-lock.yaml" },
        command: "pnpm install",
      },
    ]
    const told = "`pnpm-lock.yaml` changed, so what was made from it went"
    const clean = planSettle(
      {
        kind: "clean",
        from: ACCEPTED,
        ours: OURS,
        merge: MERGE,
        files: [],
        commits: [],
        removed,
      },
      ctx,
    )
    if (clean.kind !== "clean") throw new Error("not clean")
    expect(clean.message.content).toContain(told)
    const conflicted = planSettle(
      {
        kind: "conflicted",
        from: ACCEPTED,
        contents: [{ path: "a.txt", content: "<<<<<<< a" }],
        ours: [],
        theirs: [],
        floor: floorFor(acceptedFrom, "keep both sides"),
        removed,
      },
      ctx,
    )
    if (conflicted.kind !== "conflicted") throw new Error("not conflicted")
    expect(conflicted.message.content).toContain(told)
    expect(conflicted.message.content.endsWith("keep both sides")).toBe(true)
  })
  test("nothing merged: nothing for the thread, with a mark or without", () => {
    expect(
      planSettle(
        { kind: "nothing", ours: OURS, mark: MERGE, removed: [] },
        ctx,
      ),
    ).toEqual({ kind: "nothing" })
    expect(
      planSettle({ kind: "nothing", ours: OURS, mark: null, removed: [] }, ctx),
    ).toEqual({ kind: "nothing" })
  })
  test("conflicted: each file's reasons are the revisions that touched it, ours attributed; the land message ends with the card's text", () => {
    const tree = indexTree(
      fromParents({ e1: null }, () => ({
        role: "assistant",
        content: [{ type: "text", text: "renamed it" }],
      })),
    )
    const lane = (title: string, entry: string) =>
      revisionMessage({ title, entry: entryId(entry), lane: LANE })
    const settled = planSettle(
      {
        kind: "conflicted",
        from: ACCEPTED,
        contents: [
          { path: "a.txt", content: "<<<<<<< a" },
          { path: "b.txt", content: "<<<<<<< b" },
        ],
        ours: [
          { description: lane("t", "e1"), paths: ["a.txt"] },
          { description: "a commit of the lane's\n", paths: ["b.txt"] },
        ],
        theirs: [
          { description: "yours a\n\nbody", paths: ["a.txt", "b.txt"] },
          { description: "yours b\n", paths: ["b.txt"] },
        ],
        floor: floorFor(acceptedFrom, "keep both sides"),
        removed: [],
      },
      { ...ctx, index: tree },
    )
    if (settled.kind !== "conflicted") throw new Error("not conflicted")
    expect(settled.message.details).toMatchObject({
      lane: LANE,
      merged: [ACCEPTED],
      by: ADA,
      files: ["a.txt", "b.txt"],
    })
    const { content } = settled.message
    expect(content).toContain("agent: renamed it")
    expect(content).not.toMatch(
      /a\.txt[\s\S]*a commit of the lane's[\s\S]*b\.txt/,
    )
    expect(content).toMatch(/b\.txt[\s\S]*a commit of the lane's/)
    expect(content).toMatch(/b\.txt[\s\S]*yours b/)
    expect(content.split("yours b").length).toBe(2)
    expect(content.endsWith("keep both sides")).toBe(true)
  })
  test("from the thread it branched from: the update and the resolution name it", () => {
    const parent = parentFrom
    const clean = planSettle(
      {
        kind: "clean",
        from: ACCEPTED,
        ours: OURS,
        merge: MERGE,
        files: ["a.txt"],
        commits: [],
        removed: [],
      },
      { ...ctx, from: parent },
    )
    if (clean.kind !== "clean") throw new Error("not clean")
    expect(clean.message.details).toMatchObject({
      from: { kind: "parent", name: "amber-fox" },
    })
    const conflicted = planSettle(
      {
        kind: "conflicted",
        from: ACCEPTED,
        contents: [{ path: "a.txt", content: "<<<<<<< a" }],
        ours: [],
        theirs: [],
        floor: floorFor(parent, ""),
        removed: [],
      },
      { ...ctx, from: parent },
    )
    if (conflicted.kind !== "conflicted") throw new Error("not conflicted")
    expect(conflicted.message.content).toContain(
      "The work of the thread this one branched from (amber-fox) was merged",
    )
    expect(conflicted.message.content).toContain(
      "### theirs: the thread amber-fox",
    )
  })
})

describe("catch_up, around its merge", () => {
  const ADA = writerId("ada@example.com")
  const call = (calls: number) => ({
    role: "assistant" as const,
    content: Array.from({ length: calls }, (_, i) => ({
      type: "toolCall" as const,
      id: `c${i}`,
      name: "catch_up",
      arguments: {},
    })),
  })
  const tree = (calls: number) =>
    indexTree(fromParents({ e1: null }, () => call(calls)))
  /** Accepted work set up, the lane's base unread: what catching up brings is unknown. */
  const accepted = { kind: "jj", commit: commitId("abc") } as AcceptedRecord
  const facts = (
    over: Partial<Parameters<typeof planLatestInRun>[0]> = {},
  ) => ({
    lane: LANE,
    from: "base" as const,
    own: true,
    index: tree(1),
    tip: entryId("e1"),
    by: ADA,
    base: undefined,
    accepted,
    parent: null,
    parentRunning: false,
    ...over,
  })

  test("refused with no copy of its own, or no person behind its run; refused beside another call in its turn", () => {
    for (const over of [{ own: false }, { by: null }, { index: null }])
      expect(planLatestInRun(facts(over))).toMatchObject({
        kind: "answer",
        answer: { isError: true, text: getLatestRefusal("no-copy") },
      })
    expect(planLatestInRun(facts({ index: tree(2) }))).toMatchObject({
      kind: "answer",
      answer: { text: getLatestRefusal("alone") },
    })
  })

  test("let through, it merges for the person behind the run, and its answer is planned from what the merge came to", () => {
    const call = planLatestInRun(facts())
    expect(call).toMatchObject({
      kind: "merge",
      command: "get-latest",
      by: ADA,
    })
    if (call.kind !== "merge") throw new Error("merged")
    const ctx = { index: indexTree({}), now: 7 }
    expect(planLatestInRunAnswer(call, { kind: "nothing" }, ctx)).toMatchObject(
      {
        text: getLatestRefusal("nothing-new"),
        isError: true,
      },
    )
    expect(
      planLatestInRunAnswer(call, { kind: "copy", why: "off-line" }, ctx),
    ).toMatchObject({ text: getLatestRefusal("off-line") })
  })
})
