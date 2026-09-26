import type { StreamEvent } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  applyStreamOps,
  clearStreams,
  newSessionDoc,
  type OpenStream,
  planStream,
  readStreams,
} from "./index.ts"

const L = "t-lane"
let n = 0
const newId = () => {
  n += 1
  return `s-${n.toString().padStart(3, "0")}`
}

/** Run events through plan → apply on a real document, as the host does. */
function drive(events: readonly StreamEvent[], running = true) {
  const doc = newSessionDoc()
  const seen: OpenStream[][] = []
  for (const event of events) {
    const ops = planStream({ event, open: readStreams(doc), running, newId })
    applyStreamOps(doc, ops)
    seen.push([...readStreams(doc)])
  }
  return { doc, seen }
}

describe("planStream: replies and tools are streams of edits", () => {
  test("a reply opens on its first text, appends, and closes when its message ends", () => {
    const { seen } = drive([
      { kind: "text", lane: L, delta: "Hel" },
      { kind: "text", lane: L, delta: "lo" },
      { kind: "messageEnd", lane: L },
      { kind: "text", lane: L, delta: "Next." },
    ])
    expect(seen[1]?.map(s => [s.kind, s.text])).toEqual([["reply", "Hello"]])
    expect(seen[2]).toEqual([])
    // The next message is its own stream: nothing of the first is shown again.
    expect(seen[3]?.map(s => s.text)).toEqual(["Next."])
    expect(seen[3]?.[0]?.id).not.toBe(seen[1]?.[0]?.id)
  })

  test("a tool's snapshots become edits; past the view's limit, a front cut and an append", () => {
    const view = (from: number, to: number) =>
      Array.from(
        { length: to - from + 1 },
        (_, k) => `line ${from + k}\n`,
      ).join("")
    const { seen } = drive([
      { kind: "toolStart", lane: L, callId: "c1", label: "bash pnpm test" },
      { kind: "toolOutput", lane: L, callId: "c1", text: view(1, 5) },
      { kind: "toolOutput", lane: L, callId: "c1", text: view(3, 9) },
      { kind: "toolEnd", lane: L, callId: "c1" },
    ])
    expect(seen[2]?.[0]).toMatchObject({
      kind: "tool",
      label: "bash pnpm test",
      text: view(3, 9),
    })
    expect(seen[3]).toEqual([])
    const doc = newSessionDoc()
    applyStreamOps(
      doc,
      planStream({
        event: { kind: "toolStart", lane: L, callId: "c", label: "x" },
        open: [],
        running: true,
        newId,
      }),
    )
    const open = readStreams(doc)
    const withText = open.map(s => ({ ...s, text: view(1, 5) }))
    const ops = planStream({
      event: { kind: "toolOutput", lane: L, callId: "c", text: view(3, 9) },
      open: withText,
      running: true,
      newId,
    })
    expect(ops).toEqual([
      {
        kind: "edit",
        id: open[0]?.id,
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

  test("clearStreams leaves no stream and no running lane", () => {
    const { doc } = drive([
      { kind: "text", lane: L, delta: "half" },
      { kind: "toolStart", lane: L, callId: "c", label: "read a" },
    ])
    doc.activeRuns.set(L, "r-1")
    clearStreams(doc)
    expect([readStreams(doc), Object.keys(doc.activeRuns())]).toEqual([[], []])
  })
})
