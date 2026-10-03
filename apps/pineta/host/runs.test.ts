import { ERR, entryId, laneNameForThread, NOBODY, writerId } from "@pineta/core"
import { encodeChat } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import {
  readActiveRun,
  readStreams,
  writeEntry,
  writeLaneTip,
} from "@pineta/schema"
import { describe, expect, test } from "vitest"
import { basics, deferred, fakeLane, methods, record, row } from "./fakes.ts"
import { createRuns, planRunEnd, streamInto } from "./runs.ts"
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
  const runs = createRuns({ basics: b, agent: agent.port, work: work.port })
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
    runs.start(LANE, { kind: "prompt", message: chat })
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
    runs.start(LANE, { kind: "prompt", message: chat })
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
    runs.start(LANE, { kind: "prompt", message: chat })
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
    runs.start(LANE, { kind: "prompt", message: chat })
    lane.finish({ kind: "refused", code: ERR.REFUSED })
    await ended
    expect(
      lane.calls.filter(c => c.method === "append").map(c => c.args[0]),
    ).toEqual([chat])
  })
})
