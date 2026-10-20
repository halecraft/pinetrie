import {
  commitId,
  entryId,
  GET_LATEST_TOOL,
  planCopyReady,
  pointId,
  rootIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { createQueue, type LaneHistory } from "@pinetrie/lanes"
import { readConflictAsks } from "@pinetrie/reads"
import {
  ACCEPTED as ACCEPTED_RECORD,
  BASE,
  encodeUpdate,
  getLatestRefusal,
  removalsText,
  type Settle,
  setRecord,
} from "@pinetrie/rules"
import { writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import {
  applyWrites,
  basics,
  putLane,
  putValue,
  record,
  row,
  storedMessage,
} from "../fakes.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Ready } from "./setup.ts"
import {
  applySettle,
  createUpdates,
  type Prepared,
  withLaneStarted,
} from "./update.ts"

/**
 * A registry whose lanes are their own or not, each step run on one queue
 * with `history`: a stand-in for the adapter's.
 */
const NONE = removalsText([])

const registryWith = (history: LaneHistory, own = true) => {
  const queue = createQueue()
  return record<Parameters<typeof createUpdates>[0]["registry"]>({
    isOwn: () => own,
    withHistory: (lane, f) =>
      queue.enqueue(() =>
        f(
          history,
          {} as Parameters<Parameters<LaneRegistry["withHistory"]>[1]>[1],
          {
            lane,
            root: rootIdFor("r"),
            history: "jj",
            by: writerId("ada@example.com"),
            createdAt: 0,
          },
        ),
      ),
  }).port
}

const LANE = threadIdFor("0123456789abcdef")

const ADA = writerId("ada@example.com")
const ACCEPTED = pointId("11110000")
const MERGE = pointId("33330000")

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
    })
  const follow = (calls: string[]) => () => {
    calls.push("follow")
  }
  const clean: Settle = {
    kind: "clean",
    message: encodeUpdate(
      {
        lane: LANE,
        from: { kind: "accepted" },
        merged: ACCEPTED,
        commits: [],
        files: ["a.txt"],
        by: ADA,
      },
      1,
      NONE,
    ),
    merge: MERGE,
  }
  test("a clean update appends its entry, records its revision, then fires what follows the merge, in that order", async () => {
    const calls: string[] = []
    const p = ports(calls)
    expect(await applySettle(p.port, clean, follow(calls))).toEqual({
      kind: "clean",
    })
    expect(calls).toEqual([
      "append pinetrie.update",
      "record e-9 33330000",
      "follow",
    ])
  })
  test("an entry not appended records no revision, and what follows the merge is still fired", async () => {
    const calls: string[] = []
    await applySettle(ports(calls, false).port, clean, follow(calls))
    expect(calls).toEqual(["append pinetrie.update", "follow"])
  })
  test("nothing, with nothing to follow, writes nothing", async () => {
    const calls: string[] = []
    expect(
      await applySettle(ports(calls).port, { kind: "nothing" }, null),
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
  test("with a run to follow, the lane is never stopped, whatever the update comes to", async () => {
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

describe("askedAboutConflict", () => {
  /**
   * Updates whose lane's history answers with `conflicted` files, the lane
   * its own or not, its run prompted by `role`.
   */
  const updatesWith = (
    conflicted: readonly string[],
    own = true,
    role = "person",
  ) => {
    const b = basics()
    writeEntry(b.root, row("p-1", null, { role, content: "go" }))
    writeLaneTip(b.root, LANE, entryId("p-1"))
    const asked: string[] = []
    const history = record<LaneHistory>({
      conflicts: async () => {
        asked.push("conflicts")
        return conflicted
      },
    }).port
    const updates = createUpdates({
      basics: b,
      setup: { ready: { image: "img" } as Ready },
      destination:
        record<Parameters<typeof createUpdates>[0]["destination"]>().port,
      registry: registryWith(history, own),
      piSetup: record<Parameters<typeof createUpdates>[0]["piSetup"]>().port,
      containers:
        record<Parameters<typeof createUpdates>[0]["containers"]>().port,
      records: { writeValues: async writes => applyWrites(b, writes) },
      writeRevision: async () => {},
    })
    return { updates, asked, b }
  }

  test("taken while jj finds a conflict in the lane's copy, whatever started the run", async () => {
    for (const role of ["person", "land", "stack"])
      expect(
        await updatesWith(["a.txt"], true, role).updates.askedAboutConflict(
          LANE,
        ),
      ).toBe(true)
  })

  test("refused with no conflict, and for a lane that works directly, which jj is never asked about", async () => {
    const none = updatesWith([])
    expect(await none.updates.askedAboutConflict(LANE)).toBe(false)
    expect(readConflictAsks(none.b.session).size).toBe(0)
    const direct = updatesWith(["a.txt"], false)
    expect(await direct.updates.askedAboutConflict(LANE)).toBe(false)
    expect(direct.asked).toEqual([])
  })

  test("a taken ask is recorded for its lane at the host's clock", async () => {
    const { updates, b } = updatesWith(["a.txt"])
    await updates.askedAboutConflict(LANE)
    expect(readConflictAsks(b.session).get(LANE)).toEqual({
      lane: LANE,
      at: b.now(),
    })
  })
})

describe("getLatestInRun", () => {
  /**
   * A lane of its own whose turn is `calls` calls of `catch_up`, its base
   * moved with files to bring, and a history whose copy has `parents` as
   * `@`'s parents, the bookmark `b`, and nothing descending.
   */
  const inRun = (calls: number, parents: string) => {
    const b = basics()
    putLane(b, LANE, entryId("a-1"))
    const call = (id: string) => ({
      type: "toolCall",
      id,
      name: GET_LATEST_TOOL,
      arguments: {},
    })
    writeEntry(b.root, row("p-1", null, storedMessage("go", { author: ADA })))
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
        kind: "jj",
        lane: LANE,
        base: { kind: "accepted" },
        start: commitId("l1"),
        state: "ok",
        getLatest: { tip: commitId("t"), to: commitId("l2"), files: ["a.ts"] },
        untraced: [],
        work: "some",
      }),
    )
    putValue(
      b,
      setRecord(ACCEPTED_RECORD, {
        kind: "jj",
        acceptedBookmark: "pinetrie-accepted",
        wipPrefix: "wip/",
        publish: "main",
        published: { commit: null, behind: 0, ahead: 0 },
        commit: commitId("l2"),
        heads: { current: null, proposed: "x" },
        log: { current: null, proposed: "x" },
        unfinishedWork: [],
        workingCopy: {
          behind: 0,
          ahead: 0,
          getLatest: null,
          conflicts: { commits: 0, files: [] },
        },
        publishCatchesUp: true,
      }),
    )
    const asked: string[] = []
    const b0 = commitId("b")
    const history = record<LaneHistory>({
      readyToMerge: async () => {
        asked.push("readyToMerge")
        return planCopyReady({
          parents: [commitId(parents)],
          bookmark: b0,
          descends: false,
        })
      },
      commit: async () => {
        asked.push("commit")
        return { point: null, conflicted: false }
      },
      merge: async () => {
        asked.push("merge")
        throw new Error("merged")
      },
    }).port
    const updates = createUpdates({
      basics: b,
      setup: { ready: { image: "img" } as Ready },
      destination:
        record<Parameters<typeof createUpdates>[0]["destination"]>().port,
      registry: registryWith(history),
      // The skill is read before the merge, for the floor.
      piSetup: record<Parameters<typeof createUpdates>[0]["piSetup"]>({
        skill: async () => null,
      }).port,
      // Neither starts nor stops the lane: the port throws if asked.
      containers:
        record<Parameters<typeof createUpdates>[0]["containers"]>().port,
      records: record<Parameters<typeof createUpdates>[0]["records"]>().port,
      writeRevision: async () => {},
    })
    return { updates, asked }
  }

  test("a call beside another in its turn is refused before anything is queued", async () => {
    const { updates, asked } = inRun(2, "b")
    expect(await updates.getLatestInRun(LANE, "base")).toMatchObject({
      isError: true,
      text: getLatestRefusal("alone"),
    })
    expect(asked).toEqual([])
  })

  test("a copy off its own line is refused before any edit is committed or merged, and the lane is neither started nor stopped", async () => {
    const { updates, asked } = inRun(1, "x")
    expect(await updates.getLatestInRun(LANE, "base")).toMatchObject({
      isError: true,
      text: getLatestRefusal("off-line"),
    })
    expect(asked).toEqual(["readyToMerge"])
  })
})
