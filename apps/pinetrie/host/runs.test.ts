import {
  commitId,
  ERR,
  entryId,
  NOBODY,
  pointId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { Agent } from "@pinetrie/pi"
import {
  encodeBehind,
  encodeCanvas,
  encodeChat,
  encodePinned,
  planStack,
} from "@pinetrie/rules"
import { readActiveRun, readStreams } from "@pinetrie/schema"
import { writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import type { BaseNews } from "./base-news.ts"
import {
  basics,
  deferred,
  fakeLane,
  methods,
  record,
  row,
  runnableFor,
  TASK_ID,
} from "./fakes.ts"
import {
  createRuns,
  planRunEnd,
  type ReadPinned,
  type ReadTaskContext,
  streamInto,
} from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

const LANE = threadIdFor("0123456789abcdef")
const chat = encodeChat(
  {
    author: writerId("alice@example.com"),
    authorName: "Alice",
    text: "hi",
    compels: NOBODY,
    sendId: "s-1",
  },
  1,
)

describe("planRunEnd", () => {
  test("endRun comes before laneStopped, and ended is last, for every role", () => {
    for (const role of [undefined, "chat", "land", "stack"]) {
      const steps = planRunEnd(role)
      expect(steps.indexOf("endRun")).toBeLessThan(steps.indexOf("laneStopped"))
      expect(steps.at(-1)).toBe("ended")
    }
  })

  test("a stack prompt adds splitEnded before endRun; a land prompt ends as any run", () => {
    expect(planRunEnd("land")).toEqual(planRunEnd("chat"))
    expect(planRunEnd("stack")).toEqual([
      "splitEnded",
      "verdictPending",
      "endRun",
      "laneStopped",
      "ended",
    ])
    expect(planRunEnd(undefined)).not.toContain("splitEnded")
  })

  test("the verdict is pending before endRun, for every role", () => {
    for (const role of [undefined, "chat", "land", "stack"]) {
      const steps = planRunEnd(role)
      expect(steps.indexOf("verdictPending")).toBeGreaterThanOrEqual(0)
      expect(steps.indexOf("verdictPending")).toBeLessThan(
        steps.indexOf("endRun"),
      )
    }
  })
})

function setUp(
  lane = fakeLane(LANE),
  splitEnded: LaneWork["splitEnded"] = async () => null,
  readPinned: ReadPinned = async () => null,
  atStart: BaseNews["atStart"] = async () => null,
  readTaskContext: ReadTaskContext = async () => [],
) {
  const b = basics()
  const work = record<Pick<LaneWork, "beforeRun" | "runEnded" | "splitEnded">>({
    beforeRun: () => {},
    runEnded: () => {},
    splitEnded,
  })
  const agent = record<Pick<Agent, "lane">>({ lane: () => lane.lane })
  // Whether the lane was still running when its verdict was made pending.
  const pending: { prompt: string; running: boolean }[] = []
  const runs = createRuns({
    basics: b,
    agent: agent.port,
    work: work.port,
    readPinned,
    readTaskContext,
    baseNews: { atStart, runEnded: () => {} },
    pending: async (l, prompt) => {
      pending.push({ prompt, running: readActiveRun(b.live, l) !== undefined })
    },
  })
  const ended = deferred<{
    running: boolean
    open: number
    work: string[]
    prompt: string | null
  }>()
  runs.onEnded((l, prompt) =>
    ended.resolve({
      running: readActiveRun(b.live, l) !== undefined,
      open: readStreams(b.live).filter(s => s.lane === l).length,
      work: methods(work.calls),
      prompt,
    }),
  )
  return { b, lane, runs, pending, ended: ended.promise }
}

test("a run starts only on a lane proven runnable", () => {
  const { runs } = setUp()
  // @ts-expect-error: a bare lane is no proof that a run may start there
  const start = () => runs.start(LANE, { kind: "resume" })
  expect(start).toBeTypeOf("function")
})

describe("a run's end", () => {
  test("when ended is called, the lane has no active run and no open stream, and it has stopped", async () => {
    const { b, lane, runs, ended } = setUp()
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: chat,
      pinnedSeen: [],
    })
    streamInto(b)({ kind: "text", lane: LANE, delta: "hello" })
    expect(readStreams(b.live).filter(s => s.lane === LANE)).toHaveLength(1)
    lane.finish({ kind: "ok" })
    expect(await ended).toEqual({
      running: false,
      open: 0,
      work: ["beforeRun", "runEnded"],
      prompt: null,
    })
  })

  test("its verdict is made pending while the run is still active, for the prompt it answered", async () => {
    const { b, lane, runs, pending, ended } = setUp()
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: chat,
      pinnedSeen: [],
    })
    writeEntry(
      b.root,
      row(entryId("p-1"), null, { role: "chat", content: "hi" }),
    )
    writeLaneTip(b.root, LANE, entryId("p-1"))
    lane.finish({ kind: "ok" })
    await ended
    expect(pending).toEqual([{ prompt: "p-1", running: true }])
  })

  test("ended is given the prompt the run answered", async () => {
    const { b, lane, runs, ended } = setUp()
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: chat,
      pinnedSeen: [],
    })
    writeEntry(
      b.root,
      row(entryId("p-1"), null, { role: "chat", content: "hi" }),
    )
    writeEntry(
      b.root,
      row(entryId("a-1"), "p-1", { role: "assistant", content: "hello" }),
    )
    writeLaneTip(b.root, LANE, entryId("a-1"))
    lane.finish({ kind: "ok" })
    expect((await ended).prompt).toBe("p-1")
  })

  test("a failing step before endRun is logged, and endRun and ended still run", async () => {
    const { b, lane, runs, ended } = setUp(fakeLane(LANE), async () => {
      throw new Error("pi is gone")
    })
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: chat,
      pinnedSeen: [],
    })
    writeEntry(
      b.root,
      row(entryId("p-1"), null, { role: "stack", content: "stack" }),
    )
    writeLaneTip(b.root, LANE, entryId("p-1"))
    lane.finish({ kind: "ok" })
    expect((await ended).running).toBe(false)
    expect(b.lines).toContain("[host] run end failed: pi is gone")
  })

  test("a compelled chat pi refuses to run is appended, not lost", async () => {
    const lane = fakeLane(LANE, {
      append: async () => ({ kind: "appended", id: entryId("e-1") }),
    })
    const { runs, ended } = setUp(lane)
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: chat,
      pinnedSeen: [],
    })
    lane.finish({ kind: "refused", code: ERR.REFUSED })
    await ended
    expect(
      lane.calls.filter(c => c.method === "append").map(c => c.args[0]),
    ).toEqual([chat])
  })
})

/** Resolves once `lane` has been asked to run. */
async function untilRun(lane: ReturnType<typeof fakeLane>): Promise<void> {
  while (!methods(lane.calls).includes("run"))
    await new Promise(resolve => setImmediate(resolve))
}

describe("a run's pinned cards", () => {
  const pinned = encodePinned(
    {
      lane: LANE,
      cards: [
        {
          id: cardIdFor("c1"),
          text: "ship it",
          by: writerId("a@x.io"),
        },
      ],
      retired: [],
    },
    () => "Ada",
    1,
  )

  test("a prompt's run reads its pinned cards, with what the sender had, and passes the entry to pi", async () => {
    const asked: unknown[] = []
    const { lane, runs, ended } = setUp(
      fakeLane(LANE),
      undefined,
      async (l, seen) => {
        asked.push([l, seen])
        return pinned
      },
    )
    const seen = [{ id: cardIdFor("c1"), seen: "v-1" }]
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: chat,
      pinnedSeen: seen,
    })
    lane.finish({ kind: "ok" })
    await ended
    expect(asked).toEqual([[LANE, seen]])
    expect(lane.calls.filter(c => c.method === "run").map(c => c.args)).toEqual(
      [[chat, [pinned]]],
    )
  })

  test("a chat's run is told its base's news first, then its task, before its cards entry", async () => {
    const behind = encodeBehind(
      {
        from: { kind: "accepted" },
        to: pointId("l2"),
        files: ["a.ts"],
        overlap: [],
        conflicts: [],
      },
      1,
    )
    const asked: string[] = []
    const canvas = encodeCanvas(
      { task: TASK_ID, title: "T", lines: ["thread a (this thread)"], more: 0 },
      1,
    )
    const { lane, runs, ended } = setUp(
      fakeLane(LANE),
      undefined,
      async () => pinned,
      async l => {
        asked.push(l)
        return behind
      },
      async () => [canvas],
    )
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: chat,
      pinnedSeen: [],
    })
    lane.finish({ kind: "ok" })
    await ended
    expect(asked).toEqual([LANE])
    expect(lane.calls.filter(c => c.method === "run").map(c => c.args)).toEqual(
      [[chat, [behind, canvas, pinned]]],
    )
  })

  test("a split's run is not told its base's news: it has its own prompt", async () => {
    const asked: string[] = []
    const { lane, runs, ended } = setUp(
      fakeLane(LANE),
      undefined,
      undefined,
      async l => {
        asked.push(l)
        return null
      },
    )
    const stack = planStack({
      skill: null,
      bookmark: "pinetrie-stack/x",
      details: {
        lane: LANE,
        start: [],
        tip: commitId("t"),
        by: writerId("a@x.io"),
      },
      timestamp: 1,
    })
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: stack,
      pinnedSeen: [],
    })
    lane.finish({ kind: "ok" })
    await ended
    expect(asked).toEqual([])
  })

  test("a resume reads no pinned cards", async () => {
    let read = 0
    const { lane, runs, ended } = setUp(fakeLane(LANE), undefined, async () => {
      read += 1
      return pinned
    })
    runs.start(runnableFor(LANE), { kind: "resume" })
    lane.finish({ kind: "ok" })
    await ended
    expect(read).toBe(0)
  })

  test("a stop while a chat's run waits for its pinned cards: no run, its message kept, and the lane ends", async () => {
    const lane = fakeLane(LANE, {
      append: async () => ({ kind: "appended", id: entryId("e-1") }),
    })
    const { runs, ended } = setUp(
      lane,
      undefined,
      (_, __, signal) =>
        new Promise(resolve =>
          signal.addEventListener("abort", () => resolve(pinned)),
        ),
    )
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: chat,
      pinnedSeen: [],
    })
    expect(runs.cancel(LANE)).toBe(true)
    expect((await ended).running).toBe(false)
    expect(methods(lane.calls)).toEqual(["append"])
    expect(lane.calls[0]?.args).toEqual([chat])
    expect(runs.cancel(LANE)).toBe(false)
  })

  test("a land or stack start cannot be cancelled: its run goes ahead", async () => {
    const stack = planStack({
      skill: null,
      bookmark: "b",
      details: {
        lane: LANE,
        start: [commitId("s")],
        tip: commitId("t"),
        by: writerId("a@x.io"),
      },
      timestamp: 1,
    })
    const { lane, runs, ended } = setUp()
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: stack,
      pinnedSeen: [],
    })
    expect(runs.cancel(LANE)).toBe(false)
    lane.finish({ kind: "ok" })
    await ended
    expect(methods(lane.calls)).toEqual(["run"])
  })

  test("once a chat's run has reached pi, cancel returns false, so pi's abort is used", async () => {
    const { lane, runs, ended } = setUp()
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: chat,
      pinnedSeen: [],
    })
    await untilRun(lane)
    expect(runs.cancel(LANE)).toBe(false)
    lane.finish({ kind: "ok" })
    await ended
  })
})

test("a run's end forgets the lane's base news as the lane stops, before ended", async () => {
  const lane = fakeLane(LANE)
  const order: string[] = []
  const runs = createRuns({
    basics: basics(),
    agent: { lane: () => lane.lane },
    work: {
      beforeRun: () => {},
      runEnded: l => order.push(`work ${l}`),
      splitEnded: async () => null,
    },
    readPinned: async () => null,
    readTaskContext: async () => [],
    baseNews: {
      atStart: async () => null,
      runEnded: l => order.push(`news ${l}`),
    },
    pending: async () => {},
  })
  const ended = deferred<void>()
  runs.onEnded(l => {
    order.push(`ended ${l}`)
    ended.resolve()
  })
  runs.start(runnableFor(LANE), {
    kind: "prompt",
    message: chat,
    pinnedSeen: [],
  })
  lane.finish({ kind: "ok" })
  await ended.promise
  expect(order).toEqual([`work ${LANE}`, `news ${LANE}`, `ended ${LANE}`])
})
