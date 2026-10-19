import { entryId, runId, threadIdFor } from "@pinetrie/core"
import { streamId } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { newLiveDoc } from "./fixtures.ts"
import {
  applyLiveOps,
  readActiveLanes,
  readActiveRun,
  readStreamIds,
  readStreamRecords,
  readStreams,
} from "./index.ts"

const L = threadIdFor("lane")
const M = threadIdFor("other")

describe("applyLiveOps, the one writer of pinetrie:live", () => {
  test("a reply and a tool round-trip, null fields included, in id order", () => {
    const live = newLiveDoc()
    applyLiveOps(live, [
      {
        kind: "open",
        stream: { id: streamId("s-2"), lane: L, kind: "tool", callId: "c1" },
      },
      {
        kind: "open",
        stream: { id: streamId("s-1"), lane: L, kind: "reply", under: null },
      },
      {
        kind: "open",
        stream: {
          id: streamId("s-3"),
          lane: M,
          kind: "reply",
          under: entryId("e-1"),
        },
      },
      {
        kind: "edit",
        id: streamId("s-1"),
        edits: [{ at: 0, remove: 0, insert: "Hello" }],
      },
      {
        kind: "edit",
        id: streamId("s-1"),
        edits: [{ at: 0, remove: 1, insert: "J" }],
      },
    ])
    expect(readStreams(live)).toEqual([
      { id: "s-1", lane: L, kind: "reply", under: null, text: "Jello" },
      { id: "s-2", lane: L, kind: "tool", callId: "c1", text: "" },
      { id: "s-3", lane: M, kind: "reply", under: "e-1", text: "" },
    ])
    expect(readStreamRecords(live, M).map(s => s.id)).toEqual(["s-3"])
  })

  test("close deletes a stream's record and its text", () => {
    const live = newLiveDoc()
    applyLiveOps(live, [
      {
        kind: "open",
        stream: { id: streamId("s-1"), lane: L, kind: "reply", under: null },
      },
      { kind: "close", id: streamId("s-1") },
    ])
    expect([readStreams(live), readStreamIds(live)]).toEqual([[], []])
  })

  test("begin marks a lane running, and end deletes its key", () => {
    const live = newLiveDoc()
    applyLiveOps(live, [
      { kind: "begin", lane: L, run: runId("r-1") },
      { kind: "begin", lane: M, run: runId("r-2") },
      { kind: "end", lane: L },
    ])
    expect([readActiveRun(live, L), readActiveRun(live, M)]).toEqual([
      undefined,
      "r-2",
    ])
    expect(Object.keys(live.activeRuns())).toEqual([M])
    expect(readActiveLanes(live)).toEqual([M])
  })

  test("a text whose record is gone is still a stream id, and a row whose lane is no thread's is left out", () => {
    const live = newLiveDoc()
    live.streamText.set("orphan", "left over")
    live.streams.set("s-bad", {
      lane: "main",
      kind: "reply",
      callId: null,
      under: null,
    })
    expect(readStreamIds(live).toSorted()).toEqual(["orphan", "s-bad"])
    expect(readStreamRecords(live)).toEqual([])
  })
})
