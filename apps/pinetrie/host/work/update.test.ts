import {
  type BaseMerge,
  CATCH_UP_TOOL,
  commitId,
  entryId,
  laneNameForThread,
  NOBODY,
  revisionMessage,
  type ThreadName,
  writerId,
} from "@pinetrie/core"
import { createQueue, planMerge } from "@pinetrie/lanes"
import { readTreeIndex } from "@pinetrie/reads"
import type { RepoOwner } from "@pinetrie/repo"
import {
  BASE,
  catchUpRefusal,
  encodeChat,
  encodeUpdate,
  type Floor,
  LINE as LINE_RECORD,
  type PromptBudget,
  setRecord,
} from "@pinetrie/rules"
import { newRootDoc, writeEntry, writeLaneTip } from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import { basics, putLane, putValue, record, row } from "../fakes.ts"
import {
  applySettle,
  createUpdates,
  type Prepared,
  planCatchUp,
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
  onto: "pinetrie-onto",
  commit: LINE,
  mark: false,
}
const parentFrom: BaseMerge = {
  kind: "parent",
  lane: laneNameForThread("p"),
  name: "amber-fox" as ThreadName,
  commit: LINE,
  caughtUpWith: OURS,
}
/** pi's estimate of a custom message: a token per four characters. */
const budgetOf = (tokens: number): PromptBudget => ({
  tokens,
  estimate: content => Math.ceil(content.length / 4),
})

/** The floor `planCatchUp` settles for `from`, with room for anything. */
function floorFor(from: BaseMerge, intent: string): Floor {
  const planned = planCatchUp(from, {
    budget: budgetOf(100_000),
    skill: null,
    intent,
  })
  if (planned.kind !== "merge") throw new Error("refused")
  return planned.floor
}

describe("planCatchUp: whether a catch-up may merge (ADR-0084)", () => {
  test("refused, before the merge, when even the smallest prompt would not fit; it names what can be shortened", () => {
    const planned = planCatchUp(lineFrom, {
      budget: budgetOf(50),
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
  test("with room, it merges as `planMerge` says, and the prompt names whose work comes in", () => {
    const planned = planCatchUp(parentFrom, {
      budget: budgetOf(1_000),
      skill: null,
      intent: "",
    })
    if (planned.kind !== "merge") throw new Error("refused")
    expect(planned.plan).toEqual(planMerge(parentFrom))
    expect(planned.floor.content).toContain(
      "The work of the thread this one branched from (amber-fox) was merged",
    )
  })
})

describe("planSettle: what a merge comes to (ADR-0060, ADR-0033)", () => {
  const ctx = {
    lane: LANE,
    by: ADA,
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
          bookmark: "pinetrie-onto",
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
        floor: floorFor(lineFrom, "keep both sides"),
      },
      { ...ctx, index: readTreeIndex(doc) },
    )
    if (settled.kind !== "conflicted") throw new Error("not conflicted")
    expect(settled.fetch).toBeNull()
    expect(settled.message.details).toMatchObject({
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
    const parent = parentFrom
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
        floor: floorFor(parent, ""),
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
        bookmark: "pinetrie-onto",
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
      "append pinetrie.update",
      "record e-9 33330000",
      `fetch ${OURS},${LINE}`,
    ])
  })
  test("an entry not appended records no revision, and the lane is still fetched", async () => {
    const calls: string[] = []
    await applySettle(ports(calls, false).port, clean)
    expect(calls).toEqual(["append pinetrie.update", `fetch ${OURS},${LINE}`])
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
  const run = async (
    update: () => Promise<Prepared>,
    follows: "run" | "send" = "send",
  ) => {
    const calls: string[] = []
    const prepared = await withLaneStarted(
      {
        beforeRun: () => calls.push("start"),
        runEnded: () => calls.push("stop"),
      },
      follows,
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
  test("with a run to follow, the lane is never stopped, whatever the update comes to (ADR-0080)", async () => {
    for (const prepared of [
      { kind: "clean" },
      { kind: "nothing" },
      { kind: "refused", reason: "no" },
    ] as const)
      expect((await run(async () => prepared, "run")).calls).toEqual([
        "start",
        "update",
      ])
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

describe("askedAboutConflict (ADR-0080)", () => {
  /**
   * Updates whose lane jj answers with `conflicted` files, the lane its own
   * or not, its run prompted by `role`.
   */
  const updatesWith = (
    conflicted: readonly string[],
    own = true,
    role = "chat",
  ) => {
    const b = basics()
    writeEntry(b.root, row("p-1", null, { role, content: "go" }))
    writeLaneTip(b.root, LANE, entryId("p-1"))
    const asked: string[][] = []
    const jj = async (argv: readonly string[]) => {
      asked.push([...argv])
      return {
        ok: true,
        code: 0,
        stdout:
          argv[0] === "file" ? conflicted.map(f => `${f}\n`).join("") : "",
        stderr: "",
      }
    }
    const updates = createUpdates({
      basics: b,
      setup: { root: null, owner: null, paths: null, lanes: null },
      registry: record<Parameters<typeof createUpdates>[0]["registry"]>({
        isOwn: () => own,
        laneJjOf: () => jj,
        handleOf: () =>
          ({ queue: createQueue() }) as unknown as ReturnType<
            Parameters<typeof createUpdates>[0]["registry"]["handleOf"]
          >,
      }).port,
      agent: () =>
        record<ReturnType<Parameters<typeof createUpdates>[0]["agent"]>>().port,
      containers:
        record<Parameters<typeof createUpdates>[0]["containers"]>().port,
      fetchLane: async () => {},
      writeRevision: async () => {},
    })
    return { updates, asked }
  }

  test("taken while jj finds a conflict in the lane's copy, whatever started the run", async () => {
    for (const role of ["chat", "land", "stack"])
      expect(
        await updatesWith(["a.txt"], true, role).updates.askedAboutConflict(
          LANE,
        ),
      ).toBe(true)
  })

  test("refused with no conflict, and for a lane that works directly, which jj is never asked about", async () => {
    expect(await updatesWith([]).updates.askedAboutConflict(LANE)).toBe(false)
    const direct = updatesWith(["a.txt"], false)
    expect(await direct.updates.askedAboutConflict(LANE)).toBe(false)
    expect(direct.asked).toEqual([])
  })
})

describe("catchUpInRun (ADR-0080)", () => {
  /**
   * A lane of its own whose turn is `calls` calls of `catch_up`, its base
   * moved with files to bring, and a jj that answers `@`'s parents as
   * `parents`, the bookmark as `b`, and nothing descending.
   */
  const inRun = (calls: number, parents: string) => {
    const b = basics()
    putLane(b, LANE, entryId("a-1"))
    const call = (id: string) => ({
      type: "toolCall",
      id,
      name: CATCH_UP_TOOL,
      arguments: {},
    })
    writeEntry(
      b.root,
      row("p-1", null, { role: "chat", content: "go", writer: ADA }),
    )
    writeEntry(
      b.root,
      row("a-1", "p-1", {
        role: "assistant",
        content: Array.from({ length: calls }, (_, i) => call(`c${i}`)),
      }),
    )
    writeLaneTip(b.root, LANE, entryId("a-1"))
    putValue(
      b,
      setRecord(BASE, {
        lane: LANE,
        base: { kind: "line" },
        start: commitId("l1"),
        state: "ok",
        catchUp: { tip: commitId("t"), to: commitId("l2"), files: ["a.ts"] },
        untraced: [],
        work: "some",
      }),
    )
    putValue(
      b,
      setRecord(LINE_RECORD, {
        onto: "pinetrie-onto",
        wipPrefix: "wip/",
        publish: "main",
        published: { commit: null, behind: 0, ahead: 0 },
        commit: commitId("l2"),
        heads: { current: null, proposed: "x" },
        log: { current: null, proposed: "x" },
        wips: [],
        yours: {
          behind: 0,
          ahead: null,
          follow: null,
          conflicts: { commits: 0, files: [] },
        },
        commands: true,
      }),
    )
    const asked: string[] = []
    const jj = async (argv: readonly string[]) => {
      asked.push(argv.join(" "))
      const out = argv.includes("@")
        ? parents
        : argv.some(a => a.includes("present("))
          ? "b\n"
          : ""
      return { ok: true, code: 0, stdout: out, stderr: "" }
    }
    const updates = createUpdates({
      basics: b,
      setup: {
        root: null,
        owner: record<RepoOwner>().port,
        paths: null,
        lanes: null,
      },
      registry: record<Parameters<typeof createUpdates>[0]["registry"]>({
        isOwn: () => true,
        laneJjOf: () => jj,
        handleOf: () =>
          ({ queue: createQueue() }) as unknown as ReturnType<
            Parameters<typeof createUpdates>[0]["registry"]["handleOf"]
          >,
      }).port,
      // The skill is read before the merge, for the floor (ADR-0084).
      agent: () =>
        record<ReturnType<Parameters<typeof createUpdates>[0]["agent"]>>({
          skill: async () => null,
        }).port,
      // Neither starts nor stops the lane: the port throws if asked.
      containers:
        record<Parameters<typeof createUpdates>[0]["containers"]>().port,
      fetchLane: async () => {},
      writeRevision: async () => {},
    })
    return { updates, asked }
  }

  test("a call beside another in its turn is refused before anything is queued", async () => {
    const { updates, asked } = inRun(2, "b\n")
    expect(await updates.catchUpInRun(LANE, "base")).toMatchObject({
      isError: true,
      text: catchUpRefusal("alone"),
    })
    expect(asked).toEqual([])
  })

  test("a copy off its own line is refused before any edit is committed or merged, and the lane is neither started nor stopped", async () => {
    const { updates, asked } = inRun(1, "x\n")
    expect(await updates.catchUpInRun(LANE, "base")).toMatchObject({
      isError: true,
      text: catchUpRefusal("off-line"),
    })
    expect(asked.some(a => a.startsWith("commit") || a.startsWith("new"))).toBe(
      false,
    )
  })
})
