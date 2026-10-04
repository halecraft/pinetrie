import {
  cardId,
  commitId,
  ERR,
  entryId,
  laneNameForThread,
  NOBODY,
  writerId,
} from "@pineta/core"
import type { Agent } from "@pineta/pi"
import { encodeChat, encodePinned, planStack } from "@pineta/rules"
import {
  readActiveRun,
  readStreams,
  writeEntry,
  writeLaneTip,
} from "@pineta/schema"
import { describe, expect, test } from "vitest"
import { basics, deferred, fakeLane, methods, record, row } from "./fakes.ts"
import { createRuns, planRunEnd, type ReadPinned, streamInto } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

const LANE = laneNameForThread("0123456789abcdef")
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

  test("a land prompt adds landingEnded, a stack prompt splitEnded, both before endRun", () => {
    expect(planRunEnd("land")).toEqual([
      "landingEnded",
      "endRun",
      "laneStopped",
      "ended",
    ])
    expect(planRunEnd("stack")).toEqual([
      "splitEnded",
      "endRun",
      "laneStopped",
      "ended",
    ])
    expect(planRunEnd(undefined)).not.toContain("landingEnded")
  })
})

function setUp(
  lane = fakeLane(LANE),
  landingEnded: LaneWork["landingEnded"] = async () => {},
  readPinned: ReadPinned = async () => null,
) {
  const b = basics()
  const work = record<
    Pick<LaneWork, "beforeRun" | "runEnded" | "landingEnded" | "splitEnded">
  >({
    beforeRun: () => {},
    runEnded: () => {},
    landingEnded,
    splitEnded: async () => null,
  })
  const agent = record<Pick<Agent, "lane">>({ lane: () => lane.lane })
  const runs = createRuns({
    basics: b,
    agent: agent.port,
    work: work.port,
    readPinned,
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
  return { b, lane, runs, ended: ended.promise }
}

describe("a run's end", () => {
  test("when ended is called, the lane has no active run and no open stream, and it has stopped", async () => {
    const { b, lane, runs, ended } = setUp()
    runs.start(LANE, { kind: "prompt", message: chat, pinnedSeen: [] })
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

  test("ended is given the prompt the run answered", async () => {
    const { b, lane, runs, ended } = setUp()
    runs.start(LANE, { kind: "prompt", message: chat, pinnedSeen: [] })
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
    runs.start(LANE, { kind: "prompt", message: chat, pinnedSeen: [] })
    writeEntry(
      b.root,
      row(entryId("p-1"), null, { role: "land", content: "land" }),
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
    runs.start(LANE, { kind: "prompt", message: chat, pinnedSeen: [] })
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

describe("a run's pinned cards (ADR-0048)", () => {
  const pinned = encodePinned(
    {
      lane: LANE,
      cards: [{ id: cardId("c-1"), text: "ship it", by: writerId("a@x.io") }],
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
    const seen = [{ id: cardId("c-1"), seen: "v-1" }]
    runs.start(LANE, { kind: "prompt", message: chat, pinnedSeen: seen })
    lane.finish({ kind: "ok" })
    await ended
    expect(asked).toEqual([[LANE, seen]])
    expect(lane.calls.filter(c => c.method === "run").map(c => c.args)).toEqual(
      [[chat, pinned]],
    )
  })

  test("a resume reads no pinned cards", async () => {
    let read = 0
    const { lane, runs, ended } = setUp(fakeLane(LANE), undefined, async () => {
      read += 1
      return pinned
    })
    runs.start(LANE, { kind: "resume" })
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
    runs.start(LANE, { kind: "prompt", message: chat, pinnedSeen: [] })
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
    runs.start(LANE, { kind: "prompt", message: stack, pinnedSeen: [] })
    expect(runs.cancel(LANE)).toBe(false)
    lane.finish({ kind: "ok" })
    await ended
    expect(methods(lane.calls)).toEqual(["run"])
  })

  test("once a chat's run has reached pi, cancel returns false, so pi's abort is used", async () => {
    const { lane, runs, ended } = setUp()
    runs.start(LANE, { kind: "prompt", message: chat, pinnedSeen: [] })
    await untilRun(lane)
    expect(runs.cancel(LANE)).toBe(false)
    lane.finish({ kind: "ok" })
    await ended
  })
})
