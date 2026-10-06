import {
  type AgentRun,
  entryId,
  type LaneName,
  laneNameForThread,
  type StreamRecord,
  streamId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { callStreams, liveWork } from "./live.ts"

const L = laneNameForThread("l")
const M = laneNameForThread("m")
const run = (lane: typeof L, tip: string): AgentRun => ({
  lane,
  tip: entryId(tip),
})
const reply = (id: string, lane: LaneName, under: string): StreamRecord => ({
  id: streamId(id),
  lane,
  kind: "reply",
  under: entryId(under),
})
const tool = (id: string, lane: LaneName, callId: string): StreamRecord => ({
  id: streamId(id),
  lane,
  kind: "tool",
  callId,
})

describe("liveWork", () => {
  test("a reply is drawn while its lane's tip is where it opened, and not once its entry moves the tip", () => {
    const streams = [reply("s1", L, "p")]
    expect(liveWork(streams, [run(L, "p")]).replies.get(L)?.id).toBe("s1")
    expect(liveWork(streams, [run(L, "a1")]).replies.size).toBe(0)
  })

  test("a lane that is not running draws nothing", () => {
    const live = liveWork([reply("s1", L, "p"), tool("s2", L, "c1")], [])
    expect([live.replies.size, live.tools.size]).toEqual([0, 0])
  })

  test("two lanes' streams stay apart", () => {
    const live = liveWork(
      [reply("s1", L, "p"), reply("s2", M, "q"), tool("s3", M, "c1")],
      [run(L, "p"), run(M, "q")],
    )
    expect(live.replies.get(L)?.id).toBe("s1")
    expect(live.replies.get(M)?.id).toBe("s2")
    expect(live.tools.get("c1")).toBe("s3")
  })

  test("a tool's stream is found by its call, whatever the tip", () => {
    const live = liveWork([tool("s1", L, "c1")], [run(L, "r1")])
    expect(live.tools.get("c1")).toBe("s1")
  })
})

describe("callStreams", () => {
  test("a message gets only its own calls' streams, equal by value when nothing of its own changed", () => {
    const call = (id: string) => ({ id, name: "bash", label: "bash x" })
    const tools = new Map([
      ["c1", streamId("s1")],
      ["c9", streamId("s9")],
    ])
    expect(callStreams([call("c1"), call("c2")], tools)).toEqual({ c1: "s1" })
    expect(callStreams([call("c2")], tools)).toEqual({})
    expect(callStreams(undefined, tools)).toEqual({})
  })
})
