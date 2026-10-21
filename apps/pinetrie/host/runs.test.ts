import {
  commitId,
  ERR,
  entryId,
  pointId,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import type { Agent } from "@pinetrie/pi"
import {
  encodeBehind,
  encodeCanvas,
  encodeMessage,
  encodePinned,
  planStack,
} from "@pinetrie/rules"
import { readActiveRun, readStreams } from "@pinetrie/schema"
import { writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { NOBODY } from "@pinetrie/threads"
import { cardIdFor } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import type { BaseNews } from "./base-news.ts"
import {
  basics,
  CANVAS_ID,
  deferred,
  fakeLane,
  hostRoots,
  methods,
  putLane,
  RAN,
  ROOT_ID,
  record,
  row,
  runnableFor,
  storedMessage,
} from "./fakes.ts"
import {
  createRunDocs,
  createRuns,
  planRunEnd,
  type ReadCanvasContext,
  type ReadPinned,
  streamInto,
} from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

const LANE = threadIdFor("0123456789abcdef")
const said = encodeMessage(
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
  const ROLES = [undefined, "person", "land", "stack"] as const
  test("end-run comes before lane-stopped, and ended is last, for every role", () => {
    for (const role of ROLES) {
      const { always } = planRunEnd({ role, interrupted: false })
      expect(always.indexOf("end-run")).toBeLessThan(
        always.indexOf("lane-stopped"),
      )
      expect(always.at(-1)).toBe("ended")
    }
  })

  test("a stack prompt adds split-ended before end-run; a land prompt ends as any run", () => {
    const end = (role: (typeof ROLES)[number]) =>
      planRunEnd({ role, interrupted: false })
    expect(end("land")).toEqual(end("person"))
    expect(end("stack")).toEqual({
      failable: ["split-ended", "run-end-report-pending"],
      always: ["end-run", "lane-stopped", "ended"],
    })
    expect(end(undefined).failable).not.toContain("split-ended")
  })

  test("the run-end report is pending before end-run, for every role", () => {
    for (const role of ROLES) {
      const { failable, always } = planRunEnd({ role, interrupted: false })
      expect(failable).toContain("run-end-report-pending")
      expect(always).toContain("end-run")
    }
  })

  test("an interrupted run leaves its lane running, and ended is still last", () => {
    for (const role of ROLES) {
      const { failable, always } = planRunEnd({ role, interrupted: true })
      expect(always).toEqual(["left-running", "lane-stopped", "ended"])
      expect(failable).toEqual(
        planRunEnd({ role, interrupted: false }).failable,
      )
    }
  })
})

function setUp(
  lane = fakeLane(LANE),
  splitEnded: LaneWork["splitEnded"] = async () => null,
  readPinned: ReadPinned = async () => null,
  atStart: BaseNews["atStart"] = async () => null,
  readCanvasContext: ReadCanvasContext = async () => [],
) {
  const b = basics()
  const work = record<Pick<LaneWork, "beforeRun" | "runEnded" | "splitEnded">>({
    beforeRun: () => {},
    runEnded: () => {},
    splitEnded,
  })
  const agent = record<Pick<Agent, "lane">>({ lane: () => lane.lane })
  // Whether the lane was still running when its end report was made pending.
  const pending: { prompt: string; running: boolean }[] = []
  const runDocs = createRunDocs()
  // Each lane a run announced as it began.
  const started: ThreadId[] = []
  const runs = createRuns({
    basics: b,
    runDocs,
    agent: agent.port,
    work: work.port,
    readPinned,
    readCanvasContext,
    baseNews: { atStart, runEnded: () => {} },
    pending: async (l, prompt) => {
      pending.push({ prompt, running: readActiveRun(b.live, l) !== undefined })
    },
    started: l => void started.push(l),
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
  return {
    b,
    lane,
    runs: { ...runs, start: runs.start.bind(null, b.roots) },
    runDocs,
    pending,
    started,
    ended: ended.promise,
  }
}

test("a run starts only on a lane proven runnable", () => {
  const { runs } = setUp()
  // @ts-expect-error: a bare lane is no proof that a run may start there
  const start = () => runs.start(LANE, { kind: "resume" })
  expect(start).toBeTypeOf("function")
})

describe("a run's end", () => {
  test("when ended is called, the lane has no active run and no open stream, and it has stopped", async () => {
    const { b, lane, runs, runDocs, ended } = setUp()
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    streamInto(b, runDocs)({ kind: "text", lane: LANE, delta: "hello" })
    expect(readStreams(b.live).filter(s => s.lane === LANE)).toHaveLength(1)
    lane.finish(RAN)
    expect(await ended).toEqual({
      running: false,
      open: 0,
      work: ["beforeRun", "runEnded"],
      prompt: null,
    })
  })

  test("its run-end report is made pending while the run is still active, for the prompt it answered", async () => {
    const { b, lane, runs, pending, ended } = setUp()
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    writeEntry(b.root, row(entryId("p-1"), null, storedMessage("hi")))
    writeLaneTip(b.root, LANE, entryId("p-1"))
    lane.finish(RAN)
    await ended
    expect(pending).toEqual([{ prompt: "p-1", running: true }])
  })

  test("ended is given the prompt the run answered", async () => {
    const { b, lane, runs, ended } = setUp()
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    writeEntry(b.root, row(entryId("p-1"), null, storedMessage("hi")))
    writeEntry(
      b.root,
      row(entryId("a-1"), "p-1", { role: "assistant", content: "hello" }),
    )
    writeLaneTip(b.root, LANE, entryId("a-1"))
    lane.finish(RAN)
    expect((await ended).prompt).toBe("p-1")
  })

  test("a failing step before end-run is logged, and end-run and ended still run", async () => {
    const { b, lane, runs, ended } = setUp(fakeLane(LANE), async () => {
      throw new Error("pi is gone")
    })
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    writeEntry(
      b.root,
      row(
        entryId("p-1"),
        null,
        planStack({
          skill: null,
          bookmark: "pinetrie-stack/x",
          details: {
            lane: LANE,
            start: [],
            tip: commitId("t"),
            by: writerId("a@x.io"),
          },
          timestamp: 1,
        }),
      ),
    )
    writeLaneTip(b.root, LANE, entryId("p-1"))
    lane.finish(RAN)
    expect((await ended).running).toBe(false)
    expect(b.lines).toContain("[host] run end failed: pi is gone")
  })

  test("a run that wrote its lane's prompt anew logs the sections it changed, and one that did not logs none", async () => {
    const { b, lane, runs, ended } = setUp()
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    lane.finish({ kind: "ok", promptChanged: ["project_context", "skills"] })
    await ended
    expect(
      b.lines.filter(l => l.includes("the model's prompt changed")),
    ).toEqual([
      `[host] ${LANE.slice(-8)}: the model's prompt changed: project_context, skills`,
    ])
  })

  test("a compelled chat pi refuses to run is appended, not lost", async () => {
    const lane = fakeLane(LANE, {
      append: async () => ({ kind: "appended", id: entryId("e-1") }),
    })
    const { runs, ended } = setUp(lane)
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    lane.finish({ kind: "refused", code: ERR.REFUSED })
    await ended
    expect(
      lane.calls.filter(c => c.method === "append").map(c => c.args[0]),
    ).toEqual([said])
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
      message: said,
      pinnedSeen: seen,
    })
    lane.finish(RAN)
    await ended
    expect(asked).toEqual([[LANE, seen]])
    expect(lane.calls.filter(c => c.method === "run").map(c => c.args)).toEqual(
      [[said, [pinned]]],
    )
  })

  test("a chat's run is told its base's news first, then its canvas, before its cards entry", async () => {
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
    const canvasEntry = encodeCanvas(
      {
        canvas: CANVAS_ID,
        title: "T",
        lines: ["thread a (this thread)"],
        more: 0,
      },
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
      async () => [canvasEntry],
    )
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    lane.finish(RAN)
    await ended
    expect(asked).toEqual([LANE])
    expect(lane.calls.filter(c => c.method === "run").map(c => c.args)).toEqual(
      [[said, [behind, canvasEntry, pinned]]],
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
    lane.finish(RAN)
    await ended
    expect(asked).toEqual([])
  })

  test("a prompt's run is announced as it begins; a resume's is not", async () => {
    const prompted = setUp()
    prompted.runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    expect(prompted.started).toEqual([LANE])
    prompted.lane.finish(RAN)
    await prompted.ended
    const resumed = setUp()
    resumed.runs.start(runnableFor(LANE), { kind: "resume" })
    resumed.lane.finish(RAN)
    await resumed.ended
    expect(resumed.started).toEqual([])
  })

  test("a resume reads no pinned cards", async () => {
    let read = 0
    const { lane, runs, ended } = setUp(fakeLane(LANE), undefined, async () => {
      read += 1
      return pinned
    })
    runs.start(runnableFor(LANE), { kind: "resume" })
    lane.finish(RAN)
    await ended
    expect(read).toBe(0)
  })

  test("a stop while a chat's run waits for its pinned cards: no run, its message kept, and the lane ends", async () => {
    const lane = fakeLane(LANE, {
      append: async () => ({ kind: "appended", id: entryId("e-1") }),
    })
    const reading = deferred<void>()
    const { runs, ended } = setUp(lane, undefined, (_, __, signal) => {
      reading.resolve()
      return new Promise(resolve =>
        signal.addEventListener("abort", () => resolve(pinned)),
      )
    })
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    await reading.promise
    expect(runs.cancel(LANE)).toBe(true)
    expect((await ended).running).toBe(false)
    expect(methods(lane.calls)).toEqual(["isLeftOpen", "append"])
    expect(lane.calls[1]?.args).toEqual([said])
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
    lane.finish(RAN)
    await ended
    expect(methods(lane.calls)).toEqual(["isLeftOpen", "run"])
  })

  test("once a chat's run has reached pi, cancel returns false, so pi's abort is used", async () => {
    const { lane, runs, ended } = setUp()
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    await untilRun(lane)
    expect(runs.cancel(LANE)).toBe(false)
    lane.finish(RAN)
    await ended
  })
})

describe("a lane another process left open", () => {
  test("a prompt on it resumes the operation, then runs with what it is told gathered after", async () => {
    const order: string[] = []
    const resumed = deferred<{ readonly kind: "ok" }>()
    const lane = fakeLane(LANE, {
      isLeftOpen: async () => true,
      resume: async () => {
        order.push("resume")
        return resumed.promise
      },
      run: async () => RAN,
    })
    const { runs, ended } = setUp(lane, undefined, async () => {
      order.push("pinned")
      return null
    })
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    resumed.resolve({ kind: "ok" })
    await ended
    expect(methods(lane.calls)).toEqual(["isLeftOpen", "resume", "run"])
    expect(order).toEqual(["resume", "pinned"])
  })

  test("a Stop while a chat's run resumes it keeps the message, unrun, and leaves the abort to pi", async () => {
    const resumed = deferred<{ readonly kind: "ok" }>()
    const lane = fakeLane(LANE, {
      isLeftOpen: async () => true,
      resume: async () => resumed.promise,
      append: async () => ({ kind: "appended", id: entryId("e-1") }),
    })
    const { runs, ended } = setUp(lane)
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    while (!methods(lane.calls).includes("resume"))
      await new Promise(resolve => setImmediate(resolve))
    expect(runs.cancel(LANE)).toBe(false)
    resumed.resolve({ kind: "ok" })
    await ended
    expect(methods(lane.calls)).toEqual(["isLeftOpen", "resume", "append"])
    expect(lane.calls[2]?.args).toEqual([said])
  })

  test("a Stop during the pinned cards' wait after a resume cancels the run", async () => {
    const reading = deferred<void>()
    const lane = fakeLane(LANE, {
      isLeftOpen: async () => true,
      resume: async () => ({ kind: "ok" }),
      append: async () => ({ kind: "appended", id: entryId("e-1") }),
    })
    const { runs, ended } = setUp(lane, undefined, (_, __, signal) => {
      reading.resolve()
      return new Promise(resolve =>
        signal.addEventListener("abort", () => resolve(null)),
      )
    })
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    await reading.promise
    expect(runs.cancel(LANE)).toBe(true)
    await ended
    expect(methods(lane.calls)).toEqual(["isLeftOpen", "resume", "append"])
  })

  test("an interrupted run's end leaves its lane running in pinetrie:live, and ended still runs", async () => {
    const { lane, runs, ended } = setUp()
    runs.start(runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    })
    lane.finish({ kind: "interrupted" })
    expect((await ended).running).toBe(true)
  })
})

test("a run's end forgets the lane's base news as the lane stops, before ended", async () => {
  const lane = fakeLane(LANE)
  const order: string[] = []
  const b = basics()
  const runs = createRuns({
    basics: b,
    runDocs: createRunDocs(),
    agent: { lane: () => lane.lane },
    work: {
      beforeRun: () => {},
      runEnded: l => order.push(`work ${l}`),
      splitEnded: async () => null,
    },
    readPinned: async () => null,
    readCanvasContext: async () => [],
    baseNews: {
      atStart: async () => null,
      runEnded: l => order.push(`news ${l}`),
    },
    pending: async () => {},
    started: () => {},
  })
  const ended = deferred<void>()
  runs.onEnded(l => {
    order.push(`ended ${l}`)
    ended.resolve()
  })
  runs.start(b.roots, runnableFor(LANE), {
    kind: "prompt",
    message: said,
    pinnedSeen: [],
  })
  lane.finish(RAN)
  await ended.promise
  expect(order).toEqual([`work ${LANE}`, `news ${LANE}`, `ended ${LANE}`])
})

test("a run holds its lane's root from its start until its end's last step, through a failed step before end-run", async () => {
  const b = basics()
  putLane(b, LANE)
  const { keeper, roots } = hostRoots({ session: b.session })
  const lane = fakeLane(LANE)
  const runDocs = createRunDocs()
  const loadedAtEnded = deferred<boolean>()
  const runs = createRuns({
    basics: b,
    runDocs,
    agent: { lane: () => lane.lane },
    work: {
      beforeRun: () => {},
      runEnded: () => {},
      splitEnded: async () => null,
    },
    readPinned: async () => null,
    readCanvasContext: async () => [],
    baseNews: { atStart: async () => null, runEnded: () => {} },
    pending: async () => {
      throw new Error("run-end report lost")
    },
    started: () => {},
  })
  runs.onEnded(() => loadedAtEnded.resolve(roots.loaded().includes(ROOT_ID)))
  await keeper.run(async step =>
    runs.start(step, runnableFor(LANE), {
      kind: "prompt",
      message: said,
      pinnedSeen: [],
    }),
  )
  await keeper.idle()
  expect(roots.loaded()).toEqual([ROOT_ID])
  expect(runDocs.docOf(LANE)).not.toBeNull()
  lane.finish(RAN)
  expect(await loadedAtEnded.promise).toBe(true)
  await new Promise(r => setTimeout(r, 0))
  await keeper.idle()
  expect(roots.loaded()).toEqual([])
  expect(runDocs.docOf(LANE)).toBeNull()
})
