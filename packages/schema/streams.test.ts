import {
  type EntryId,
  entryId,
  type LaneName,
  laneNameForThread,
  runId,
  type StreamEvent,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  applyStreamOps,
  beginRun,
  clearStreams,
  endRun,
  newLiveDoc,
  planStream,
  readStreams,
  type Stream,
} from "./index.ts"

const L = laneNameForThread("lane")
const M = laneNameForThread("other")
let n = 0
const newId = () => {
  n += 1
  return `s-${n.toString().padStart(3, "0")}`
}

/** An entry written on `lane`: its tip moves, as pi's commit moves it. */
interface Commit {
  readonly commit: string
  readonly lane?: LaneName
}

/**
 * Run events through gather → plan → apply on a real document, as the host
 * does. A `Commit` step moves a lane's tip, standing for the entry pi writes.
 */
function drive(
  steps: readonly (StreamEvent | Commit)[],
  running = true,
  doc = newLiveDoc(),
) {
  const tips = new Map<LaneName, EntryId | null>([
    [L, entryId("p")],
    [M, entryId("q")],
  ])
  const seen: (readonly Stream[])[] = []
  for (const step of steps) {
    if ("commit" in step) tips.set(step.lane ?? L, entryId(step.commit))
    else
      applyStreamOps(
        doc,
        planStream({
          event: step,
          streams: readStreams(doc),
          tip: tips.get(step.lane) ?? null,
          running,
          newId,
        }),
      )
    seen.push(readStreams(doc))
  }
  return { doc, seen }
}

const replies = (s: readonly Stream[] | undefined) =>
  (s ?? []).filter(x => x.kind === "reply")

describe("planStream: replies and tools are streams of edits", () => {
  test("a reply opens under the lane's tip on its first text, and appends while the tip stays", () => {
    const { seen } = drive([
      { kind: "text", lane: L, delta: "Hel" },
      { kind: "text", lane: L, delta: "lo" },
    ])
    expect(seen[1]).toMatchObject([
      { kind: "reply", under: "p", text: "Hello" },
    ])
  })

  test("a message's end changes nothing: its reply stays until its entry moves the tip, and the next text opens a new one", () => {
    const { seen } = drive([
      { kind: "text", lane: L, delta: "First." },
      { commit: "a1" },
      { kind: "text", lane: L, delta: "Next." },
    ])
    // Its entry is written: the reply is still stored, and no longer current.
    expect(seen[1]?.map(s => s.text)).toEqual(["First."])
    // The next message is its own stream: nothing of the first is shown again.
    expect(seen[2]).toMatchObject([{ under: "a1", text: "Next." }])
    expect(seen[2]?.[0]?.id).not.toBe(seen[0]?.[0]?.id)
  })

  test("a tool opening closes the reply its entry replaced, and keeps a current one", () => {
    const replaced = drive([
      { kind: "text", lane: L, delta: "Let me run it." },
      { commit: "a1" },
      { kind: "toolStart", lane: L, callId: "c1" },
    ]).seen[2]
    expect(replaced?.map(s => s.kind)).toEqual(["tool"])
    const current = drive([
      { kind: "text", lane: L, delta: "still going" },
      { kind: "toolStart", lane: L, callId: "c1" },
    ]).seen[1]
    expect(current?.map(s => s.kind)).toEqual(["reply", "tool"])
  })

  test("a reply opening closes its lane's tools, whose results are written, and no other lane's", () => {
    const { seen } = drive([
      { kind: "toolStart", lane: M, callId: "m1" },
      { kind: "toolStart", lane: L, callId: "c1" },
      { kind: "toolStart", lane: L, callId: "c2" },
      { commit: "r2" },
      { kind: "text", lane: L, delta: "Both ran." },
    ])
    expect(seen[2]?.map(s => s.kind)).toEqual(["tool", "tool", "tool"])
    expect(seen[4]?.map(s => [s.lane, s.kind])).toEqual([
      [M, "tool"],
      [L, "reply"],
    ])
  })

  test("a lane has at most one reply at every step of a turn", () => {
    const { seen } = drive([
      { kind: "text", lane: L, delta: "Now the tests." },
      { commit: "a1" },
      { kind: "toolStart", lane: L, callId: "c1" },
      { kind: "toolOutput", lane: L, callId: "c1", text: "ok\n" },
      { commit: "r1" },
      { kind: "text", lane: L, delta: "And " },
      { kind: "text", lane: L, delta: "done." },
      { commit: "a2" },
      { kind: "text", lane: L, delta: "Also this." },
    ])
    for (const s of seen) expect(replies(s).length).toBeLessThanOrEqual(1)
  })

  test("a tool's snapshots become edits; past the view's limit, a front cut and an append", () => {
    const view = (from: number, to: number) =>
      Array.from(
        { length: to - from + 1 },
        (_, k) => `line ${from + k}\n`,
      ).join("")
    const { seen } = drive([
      { kind: "toolStart", lane: L, callId: "c1" },
      { kind: "toolOutput", lane: L, callId: "c1", text: view(1, 5) },
      { kind: "toolOutput", lane: L, callId: "c1", text: view(3, 9) },
    ])
    expect(seen[2]?.[0]).toMatchObject({
      kind: "tool",
      callId: "c1",
      text: view(3, 9),
    })
    const tool: Stream = {
      id: "t",
      lane: L,
      kind: "tool",
      callId: "c",
      text: view(1, 5),
    }
    const ops = planStream({
      event: { kind: "toolOutput", lane: L, callId: "c", text: view(3, 9) },
      streams: [tool],
      tip: entryId("p"),
      running: true,
      newId,
    })
    expect(ops).toEqual([
      {
        kind: "edit",
        id: "t",
        edits: [
          { at: 0, remove: view(1, 2).length, insert: "" },
          { at: view(3, 5).length, remove: 0, insert: view(6, 9) },
        ],
      },
    ])
  })

  test("an event for a lane that is not running changes nothing", () => {
    expect(
      drive([{ kind: "text", lane: L, delta: "late" }], false).seen[0],
    ).toEqual([])
  })
})

describe("the end of a run", () => {
  test("endRun deletes the lane's streams with its key, and leaves other lanes' alone", () => {
    const doc = newLiveDoc()
    beginRun(doc, L, runId("r-1"))
    beginRun(doc, M, runId("r-2"))
    drive(
      [
        { kind: "text", lane: L, delta: "half" },
        { kind: "toolStart", lane: M, callId: "m" },
      ],
      true,
      doc,
    )
    endRun(doc, L, runId("r-other"))
    expect(readStreams(doc).length).toBe(2)
    endRun(doc, L, runId("r-1"))
    expect([
      readStreams(doc).map(s => s.lane),
      Object.keys(doc.activeRuns()),
    ]).toEqual([[M], [M]])
  })

  test("clearStreams leaves no stream, no text and no running lane", () => {
    const { doc } = drive([
      { kind: "text", lane: L, delta: "half" },
      { kind: "toolStart", lane: L, callId: "c" },
    ])
    doc.activeRuns.set(L, runId("r-1"))
    // A text whose record is gone.
    doc.streamText.set("orphan", "left over")
    clearStreams(doc)
    expect([
      readStreams(doc),
      Object.keys(doc.streamText()),
      Object.keys(doc.activeRuns()),
    ]).toEqual([[], [], []])
  })
})
