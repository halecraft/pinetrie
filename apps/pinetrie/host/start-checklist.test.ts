import { describe, expect, test } from "vitest"
import {
  type Checklist,
  checklistAfter,
  decodeStartTimes,
  encodeStartTimes,
  planStartSteps,
  type StartEvent,
  startChecklist,
  stepEstimate,
  timesAfter,
} from "./start-checklist.ts"

const after = (list: Checklist, ...events: StartEvent[]) =>
  events.reduce(checklistAfter, list)

describe("planStartSteps", () => {
  test("a host with tools readies its lane machine first and its lanes after its roots", () => {
    expect(planStartSteps({ tools: true })).toEqual([
      "lane-machine",
      "store",
      "project",
      "model",
      "roots",
      "lane-work",
      "lane-images",
      "lane-runtime",
      "lanehost",
      "observer",
      "base-snapshot",
      "agent",
      "listening",
    ])
  })

  test("a host without tools has no lane machine and no lanes to ready", () => {
    expect(planStartSteps({ tools: false })).toEqual([
      "store",
      "project",
      "model",
      "roots",
      "lane-work",
      "agent",
      "listening",
    ])
  })
})

describe("checklistAfter", () => {
  const start = startChecklist(["store", "project", "listening"], {})

  test("a begin ends the step running", () => {
    const list = after(
      start,
      { kind: "begin", step: "store", at: 0 },
      { kind: "begin", step: "project", at: 300 },
    )
    expect(list.ended).toEqual([
      { kind: "done", step: "store", took: 300, built: null },
    ])
    expect(list.now).toEqual({
      kind: "running",
      step: "project",
      since: 300,
      building: null,
    })
    expect(list.waiting).toEqual(["listening"])
  })

  test("a build lands on the step running, and is what it ended having built", () => {
    const build = { kind: "runtime" } as const
    const list = after(
      start,
      { kind: "begin", step: "store", at: 0 },
      { kind: "building", build },
      { kind: "end", at: 50 },
    )
    expect(list.ended).toEqual([
      { kind: "done", step: "store", took: 50, built: build },
    ])
    expect(list.now).toBeNull()
  })

  test("a begin past a waiting step marks it never run", () => {
    const list = after(start, { kind: "begin", step: "listening", at: 0 })
    expect(list.ended).toEqual([
      { kind: "never-ran", step: "store" },
      { kind: "never-ran", step: "project" },
    ])
  })

  test("a failure stops the list: nothing after it moves it", () => {
    const failed = after(
      start,
      { kind: "begin", step: "store", at: 0 },
      { kind: "fail", why: "locked" },
    )
    expect(failed.now).toEqual({ kind: "failed", step: "store", why: "locked" })
    expect(after(failed, { kind: "begin", step: "project", at: 9 })).toBe(
      failed,
    )
  })
})

describe("stepEstimate", () => {
  test("a remembered build's time is the estimate of a step that builds", () => {
    expect(
      stepEstimate("lane-images", true, {
        "lane-images": { built: 90_000, usual: 300 },
      }),
    ).toBe(90_000)
  })

  test("a remembered usual time is the estimate of a step that does not build", () => {
    expect(
      stepEstimate("lane-images", false, {
        "lane-images": { built: 90_000, usual: 300 },
      }),
    ).toBe(300)
  })

  test("a step never measured takes its default", () => {
    expect(stepEstimate("lane-images", true, {})).toBe(140_000)
    expect(stepEstimate("store", false, {})).toBe(1000)
  })
})

describe("timesAfter", () => {
  test("a built step keeps its time as its build's, a quick one as its usual", () => {
    const list = after(
      startChecklist(["lane-images", "store"], {
        "lane-images": { usual: 200 },
      }),
      { kind: "begin", step: "lane-images", at: 0 },
      { kind: "building", build: { kind: "image", image: "lane" } },
      { kind: "begin", step: "store", at: 100_000 },
      { kind: "end", at: 100_400 },
    )
    expect(timesAfter(list)).toEqual({
      "lane-images": { usual: 200, built: 100_000 },
      store: { usual: 400 },
    })
  })

  test("a failed step's times stay as they were", () => {
    const times = { observer: { usual: 700 } }
    const list = after(
      startChecklist(["observer"], times),
      { kind: "begin", step: "observer", at: 0 },
      { kind: "fail", why: "no BPF" },
    )
    expect(timesAfter(list)).toEqual(times)
  })
})

describe("the times' file", () => {
  test("a missing or broken file is no times", () => {
    expect(decodeStartTimes(null)).toEqual({})
    expect(decodeStartTimes("{not json")).toEqual({})
    expect(decodeStartTimes('{"store": {"usual": "slow"}}')).toEqual({
      store: {},
    })
  })

  test("times read back as they were written", () => {
    const times = { observer: { usual: 700, built: 56_000 } }
    expect(decodeStartTimes(encodeStartTimes(times))).toEqual(times)
  })
})
