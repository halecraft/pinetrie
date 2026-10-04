import {
  type BaseMerge,
  commitId,
  entryId,
  laneNameForThread,
  NOBODY,
  type ThreadName,
  writerId,
} from "@pineta/core"
import { revisionMessage } from "@pineta/lanes"
import { encodeChat, encodeUpdate } from "@pineta/marginalia"
import { readTreeIndex } from "@pineta/reads"
import { newRootDoc, writeEntry, writeLaneTip } from "@pineta/schema"
import { describe, expect, test } from "vitest"
import { basics, record, row } from "../fakes.ts"
import {
  applySettle,
  createUpdates,
  type Prepared,
  planSettle,
  reasonOf,
  type Settle,
  withLaneStarted,
} from "./update.ts"

const LANE = laneNameForThread("0123456789abcdef")

describe("reasonOf", () => {
  test("a revision's reason is its message, attributed to its author or the agent; else its first line", () => {
    const doc = newRootDoc()
    const ada = encodeChat(
      {
        author: writerId("ada@example.com"),
        authorName: "Ada",
        text: "rename the flag\nand its docs",
        compels: NOBODY,
        sendId: "s-1",
      },
      1,
    )
    writeEntry(doc, row("e1", null, ada))
    writeEntry(
      doc,
      row("e2", "e1", {
        role: "assistant",
        content: [{ type: "text", text: "renamed it" }],
      }),
    )
    const index = readTreeIndex(doc)
    const of = (entry: string) =>
      reasonOf(
        index,
        revisionMessage({ title: "t", entry: entryId(entry), lane: LANE }),
      )
    expect(of("e1")).toBe("Ada: rename the flag")
    expect(of("e2")).toBe("agent: renamed it")
    expect(reasonOf(index, "a commit of yours\n\nwith a body")).toBe(
      "a commit of yours",
    )
  })
})

const ADA = writerId("ada@example.com")
const LINE = commitId("11110000")
const OURS = commitId("22220000")
const MERGE = commitId("33330000")
const lineFrom: BaseMerge = {
  kind: "line",
  onto: "pineta-onto",
  commit: LINE,
  mark: false,
}

describe("planSettle: what a merge comes to (ADR-0060, ADR-0033)", () => {
  const ctx = {
    lane: LANE,
    by: ADA,
    intent: "keep both sides",
    from: lineFrom,
    index: readTreeIndex(newRootDoc()),
    now: 7,
  }
  test("clean: the update in the thread, naming its base, and the lane fetched", () => {
    const facts = {
      kind: "clean",
      from: LINE,
      ours: OURS,
      merge: MERGE,
      files: ["a.txt"],
      commits: ["yours one"],
    } as const
    expect(planSettle(facts, ctx)).toEqual({
      kind: "clean",
      message: encodeUpdate(
        {
          lane: LANE,
          from: { kind: "line" },
          bookmark: "pineta-onto",
          merged: LINE,
          files: ["a.txt"],
          commits: ["yours one"],
          by: ADA,
        },
        7,
      ),
      merge: MERGE,
      fetch: [OURS, LINE],
    })
    const wip: BaseMerge = {
      kind: "wip",
      bookmark: "wip/x",
      commit: LINE,
      under: OURS,
      on: OURS,
    }
    expect(planSettle(facts, { ...ctx, from: wip })).toMatchObject({
      message: encodeUpdate(
        {
          lane: LANE,
          from: { kind: "wip", bookmark: "wip/x" },
          bookmark: "wip/x",
          merged: LINE,
          files: ["a.txt"],
          commits: ["yours one"],
          by: ADA,
        },
        7,
      ),
    })
  })
  test("a move to the line is fetched; nothing else is", () => {
    expect(
      planSettle({ kind: "nothing", ours: OURS, mark: MERGE }, ctx),
    ).toEqual({ kind: "nothing", fetch: [OURS] })
    expect(
      planSettle({ kind: "nothing", ours: OURS, mark: null }, ctx),
    ).toEqual({ kind: "nothing", fetch: null })
  })
  test("conflicted: each file's reasons are the revisions that touched it, ours attributed; the land message ends with the card's text", () => {
    const doc = newRootDoc()
    writeEntry(
      doc,
      row("e1", null, {
        role: "assistant",
        content: [{ type: "text", text: "renamed it" }],
      }),
    )
    const lane = (title: string, entry: string) =>
      revisionMessage({ title, entry: entryId(entry), lane: LANE })
    const settled = planSettle(
      {
        kind: "conflicted",
        from: LINE,
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
        skill: null,
        landing: "l-1",
      },
      { ...ctx, index: readTreeIndex(doc) },
    )
    if (settled.kind !== "conflicted") throw new Error("not conflicted")
    expect(settled.fetch).toBeNull()
    expect(settled.message.details).toMatchObject({
      landing: "l-1",
      lane: LANE,
      yours: [LINE],
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
  test("from the thread it branched from: the update and the resolution name it (ADR-0072)", () => {
    const parent: BaseMerge = {
      kind: "parent",
      lane: laneNameForThread("p"),
      name: "amber-fox" as ThreadName,
      commit: LINE,
      taken: OURS,
    }
    const clean = planSettle(
      {
        kind: "clean",
        from: LINE,
        ours: OURS,
        merge: MERGE,
        files: ["a.txt"],
        commits: [],
      },
      { ...ctx, from: parent },
    )
    if (clean.kind !== "clean") throw new Error("not clean")
    expect(clean.message.details).toMatchObject({
      parent: { name: "amber-fox" },
    })
    const conflicted = planSettle(
      {
        kind: "conflicted",
        from: LINE,
        contents: [{ path: "a.txt", content: "<<<<<<< a" }],
        ours: [],
        theirs: [],
        skill: null,
        landing: "l-2",
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

describe("applySettle: a settle's writes", () => {
  const ports = (calls: string[], appended = true) =>
    record<Parameters<typeof applySettle>[0]>({
      append: async message => {
        calls.push(`append ${message.customType}`)
        return appended
          ? { kind: "appended", id: entryId("e-9") }
          : { kind: "refused", code: "refused", message: "no" }
      },
      recordUpdate: async (entry, merge) => {
        calls.push(`record ${entry} ${merge}`)
      },
      fetchLane: have => {
        calls.push(`fetch ${have.join(",")}`)
      },
    })
  const clean: Settle = {
    kind: "clean",
    message: encodeUpdate(
      {
        lane: LANE,
        from: { kind: "line" },
        bookmark: "pineta-onto",
        merged: LINE,
        commits: [],
        files: ["a.txt"],
        by: ADA,
      },
      1,
    ),
    merge: MERGE,
    fetch: [OURS, LINE],
  }
  test("a clean update appends its entry, records its revision, then fetches the lane, in that order", async () => {
    const calls: string[] = []
    const p = ports(calls)
    expect(await applySettle(p.port, clean)).toEqual({ kind: "clean" })
    expect(calls).toEqual([
      "append pineta.update",
      "record e-9 33330000",
      `fetch ${OURS},${LINE}`,
    ])
  })
  test("an entry not appended records no revision, and the lane is still fetched", async () => {
    const calls: string[] = []
    await applySettle(ports(calls, false).port, clean)
    expect(calls).toEqual(["append pineta.update", `fetch ${OURS},${LINE}`])
  })
  test("nothing with no fetch writes nothing", async () => {
    const calls: string[] = []
    expect(
      await applySettle(ports(calls).port, { kind: "nothing", fetch: null }),
    ).toEqual({ kind: "nothing" })
    expect(calls).toEqual([])
  })
})

describe("withLaneStarted: the lane an update starts", () => {
  const run = async (update: () => Promise<Prepared>) => {
    const calls: string[] = []
    const prepared = await withLaneStarted(
      {
        beforeRun: () => calls.push("start"),
        runEnded: () => calls.push("stop"),
      },
      async () => {
        calls.push("update")
        return update()
      },
    )
    return { prepared, calls }
  }
  test("every outcome but a resolution stops the lane after", async () => {
    for (const prepared of [
      { kind: "clean" },
      { kind: "nothing" },
      { kind: "refused", reason: "no" },
    ] as const)
      expect(await run(async () => prepared)).toEqual({
        prepared,
        calls: ["start", "update", "stop"],
      })
    const message = { role: "custom" } as never
    expect(await run(async () => ({ kind: "conflicted", message }))).toEqual({
      prepared: { kind: "conflicted", message },
      calls: ["start", "update"],
    })
  })
  test("a throw is a refusal saying why, and stops the lane", async () => {
    expect(
      await run(async () => {
        throw new Error("jj failed")
      }),
    ).toEqual({
      prepared: { kind: "refused", reason: "jj failed" },
      calls: ["start", "update", "stop"],
    })
  })
})

describe("askedForGuidance", () => {
  /** Updates over a document whose lane's run was prompted by `role`. */
  const updatesAt = (role: string) => {
    const b = basics()
    writeEntry(b.root, row("p-1", null, { role, content: "go" }))
    writeLaneTip(b.root, LANE, entryId("p-1"))
    return createUpdates({
      basics: b,
      setup: { root: null, owner: null, paths: null, lanes: null },
      registry: record<Parameters<typeof createUpdates>[0]["registry"]>().port,
      agent: () =>
        record<ReturnType<Parameters<typeof createUpdates>[0]["agent"]>>().port,
      containers:
        record<Parameters<typeof createUpdates>[0]["containers"]>().port,
      fetchLane: async () => {},
      writeRevision: async () => {},
    })
  }

  test("a landing takes the question; any other run's call asks nothing (S85)", () => {
    expect(updatesAt("land").askedForGuidance(LANE)).toBe(true)
    expect(updatesAt("chat").askedForGuidance(LANE)).toBe(false)
  })
})
