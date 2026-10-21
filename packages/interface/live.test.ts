import {
  entryId,
  statementIndex,
  type ThreadId,
  threadIdFor,
} from "@pinetrie/core"
import { type AgentRun, type StreamRecord, streamId } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { callStatementStreams, callStreams, liveWork } from "./live.ts"

const L = threadIdFor("l")
const M = threadIdFor("m")
const run = (lane: typeof L, tip: string): AgentRun => ({
  lane,
  tip: entryId(tip),
})
const reply = (id: string, lane: ThreadId, under: string): StreamRecord => ({
  id: streamId(id),
  lane,
  kind: "reply",
  under: entryId(under),
})
const tool = (id: string, lane: ThreadId, callId: string): StreamRecord => ({
  id: streamId(id),
  lane,
  kind: "tool",
  callId,
})

describe("liveWork", () => {
  test("a call's stream is its whole output's, never a statement's", () => {
    const statement = statementIndex(1)
    if (statement === null) throw new Error("no statement")
    const live = liveWork(
      [
        tool("s1", L, "c1"),
        { id: streamId("s2"), lane: L, kind: "tool", callId: "c1", statement },
      ],
      [run(L, "p")],
    )
    expect(live.tools.get("c1")).toBe("s1")
  })

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
    const call = (id: string) => ({ id, name: "bash", subject: "x" })
    const tools = new Map([
      ["c1", streamId("s1")],
      ["c9", streamId("s9")],
    ])
    expect(callStreams([call("c1"), call("c2")], tools)).toEqual({ c1: "s1" })
    expect(callStreams([call("c2")], tools)).toEqual({})
    expect(callStreams(undefined, tools)).toEqual({})
  })
})

test("a running call's statement streams are kept by ordinal, and a message takes its own calls'", () => {
  const one = statementIndex(1)
  const two = statementIndex(2)
  if (one === null || two === null) throw new Error("no statement")
  const statement = (
    id: string,
    callId: string,
    n: typeof one,
  ): StreamRecord => ({
    id: streamId(id),
    lane: L,
    kind: "tool",
    callId,
    statement: n,
  })
  const live = liveWork(
    [
      statement("s1", "c1", one),
      statement("s2", "c1", two),
      statement("s3", "c2", one),
    ],
    [run(L, "p")],
  )
  expect(live.statements.get("c1")).toEqual({ 1: "s1", 2: "s2" })
  expect(
    callStatementStreams([{ id: "c1", name: "bash" }], live.statements),
  ).toEqual({ c1: { 1: "s1", 2: "s2" } })
  expect(liveWork([statement("s1", "c1", one)], []).statements.size).toBe(0)
})
