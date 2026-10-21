import {
  type EntryId,
  entryId,
  runId,
  type StatementIndex,
  statementIndex,
  type ThreadId,
  threadIdFor,
} from "@pinetrie/core"
import {
  type LiveOp,
  type Stream,
  type StreamEvent,
  streamId,
} from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { planClear, planEndRun, planStream } from "./live.ts"

const L = threadIdFor("lane")
const M = threadIdFor("other")
let n = 0
const newId = () => {
  n += 1
  return `s-${n.toString().padStart(3, "0")}`
}

/** The streams after `ops`, as `applyLiveOps` leaves them, in id order. */
function fold(streams: readonly Stream[], ops: readonly LiveOp[]): Stream[] {
  let out = [...streams]
  for (const op of ops)
    switch (op.kind) {
      case "open":
        out.push({ ...op.stream, text: "" })
        break
      case "edit":
        out = out.map(s => {
          if (s.id !== op.id) return s
          let text = s.text
          for (const e of op.edits)
            text = text.slice(0, e.at) + e.insert + text.slice(e.at + e.remove)
          return { ...s, text }
        })
        break
      case "close":
        out = out.filter(s => s.id !== op.id)
        break
      default:
        break
    }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** An entry written on `lane`: its tip moves, as pi's commit moves it. */
interface Commit {
  readonly commit: string
  readonly lane?: ThreadId
}

/**
 * Run events through gather, plan and apply, as the host does, with `fold`
 * for the document. A `Commit` step moves a lane's tip, standing for the
 * entry pi writes.
 */
function drive(steps: readonly (StreamEvent | Commit)[], running = true) {
  const tips = new Map<ThreadId, EntryId | null>([
    [L, entryId("p")],
    [M, entryId("q")],
  ])
  let streams: Stream[] = []
  const seen: (readonly Stream[])[] = []
  for (const step of steps) {
    if ("commit" in step) tips.set(step.lane ?? L, entryId(step.commit))
    else
      streams = fold(
        streams,
        planStream({
          event: step,
          streams: streams.filter(s => s.lane === step.lane),
          tip: tips.get(step.lane) ?? null,
          running,
          newId,
        }),
      )
    seen.push(streams)
  }
  return seen
}

const replies = (s: readonly Stream[] | undefined) =>
  (s ?? []).filter(x => x.kind === "reply")

describe("planStream: replies and tools are streams of edits", () => {
  test("a reply opens under the lane's tip on its first text, and appends while the tip stays", () => {
    const seen = drive([
      { kind: "text", lane: L, delta: "Hel" },
      { kind: "text", lane: L, delta: "lo" },
    ])
    expect(seen[1]).toMatchObject([
      { kind: "reply", under: "p", text: "Hello" },
    ])
  })

  test("a message's end leaves its reply until its entry moves the tip; the next text opens a new one", () => {
    const seen = drive([
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
      { kind: "tool-start", lane: L, callId: "c1" },
    ])[2]
    expect(replaced?.map(s => s.kind)).toEqual(["tool"])
    const current = drive([
      { kind: "text", lane: L, delta: "still going" },
      { kind: "tool-start", lane: L, callId: "c1" },
    ])[1]
    expect(current?.map(s => s.kind)).toEqual(["reply", "tool"])
  })

  test("a reply opening closes its lane's tools, whose results are written, and no other lane's", () => {
    const seen = drive([
      { kind: "tool-start", lane: M, callId: "m1" },
      { kind: "tool-start", lane: L, callId: "c1" },
      { kind: "tool-start", lane: L, callId: "c2" },
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
    const seen = drive([
      { kind: "text", lane: L, delta: "Now the tests." },
      { commit: "a1" },
      { kind: "tool-start", lane: L, callId: "c1" },
      { kind: "tool-output", lane: L, callId: "c1", text: "ok\n" },
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
    const seen = drive([
      { kind: "tool-start", lane: L, callId: "c1" },
      { kind: "tool-output", lane: L, callId: "c1", text: view(1, 5) },
      { kind: "tool-output", lane: L, callId: "c1", text: view(3, 9) },
    ])
    expect(seen[2]?.[0]).toMatchObject({
      kind: "tool",
      callId: "c1",
      text: view(3, 9),
    })
    const tool: Stream = {
      id: streamId("t"),
      lane: L,
      kind: "tool",
      callId: "c",
      text: view(1, 5),
    }
    const ops = planStream({
      event: { kind: "tool-output", lane: L, callId: "c", text: view(3, 9) },
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
    expect(drive([{ kind: "text", lane: L, delta: "late" }], false)[0]).toEqual(
      [],
    )
  })
})

describe("the end of a run, and a clear at start", () => {
  const streams = [
    { id: streamId("s-1"), lane: L, kind: "reply", under: null },
    { id: streamId("s-2"), lane: M, kind: "tool", callId: "m" },
  ] as const

  test("planEndRun closes the lane's streams and ends it, and leaves other lanes' alone", () => {
    expect(
      planEndRun({
        lane: L,
        run: runId("r-1"),
        running: runId("r-1"),
        streams,
      }),
    ).toEqual([
      { kind: "close", id: "s-1" },
      { kind: "end", lane: L },
    ])
  })

  test("planEndRun of a run that is no longer the lane's changes nothing", () => {
    for (const running of [runId("r-2"), undefined])
      expect(
        planEndRun({ lane: L, run: runId("r-1"), running, streams }),
      ).toEqual([])
  })

  test("planClear closes every stream, text only included, and ends every running lane", () => {
    expect(
      planClear({
        streams: [streamId("s-1"), streamId("orphan")],
        running: [L, M],
      }),
    ).toEqual([
      { kind: "close", id: "s-1" },
      { kind: "close", id: "orphan" },
      { kind: "end", lane: L },
      { kind: "end", lane: M },
    ])
  })
})

describe("planStream: a statement's stream", () => {
  const st = (n: number): StatementIndex => {
    const i = statementIndex(n)
    if (i === null) throw new Error(`no statement ${n}`)
    return i
  }
  const start: StreamEvent = { kind: "tool-start", lane: L, callId: "c1" }
  const out = (text: string, statement?: number): StreamEvent => ({
    kind: "tool-output",
    lane: L,
    callId: "c1",
    text,
    ...(statement === undefined ? {} : { statement: st(statement) }),
  })
  const tools = (s: readonly Stream[] | undefined) =>
    (s ?? []).flatMap(x =>
      x.kind === "tool" ? [{ statement: x.statement, text: x.text }] : [],
    )

  test("opens when its statement first prints, and takes its snapshots apart from the call's", () => {
    const seen = drive([
      start,
      out("a\n"),
      out("a\n", 1),
      out("a\nb\n"),
      out("a\nb\n", 1),
    ])
    expect(tools(seen.at(-1))).toEqual([
      { statement: undefined, text: "a\nb\n" },
      { statement: 1, text: "a\nb\n" },
    ])
  })

  test("a statement that has printed nothing has no stream", () => {
    expect(tools(drive([start, out("", 2)]).at(-1))).toEqual([
      { statement: undefined, text: "" },
    ])
  })

  test("the call's output without a statement never opens a stream", () => {
    expect(tools(drive([out("x")]).at(-1))).toEqual([])
  })

  test("a call turned undivided closes its statements' streams and keeps its own", () => {
    const seen = drive([
      start,
      out("a", 1),
      out("b", 2),
      out("ab"),
      { kind: "tool-undivided", lane: L, callId: "c1" },
    ])
    expect(tools(seen.at(-1))).toEqual([{ statement: undefined, text: "ab" }])
  })

  test("a run's end closes its statements' streams with the call's", () => {
    const streams = [
      { id: streamId("s-1"), lane: L, kind: "tool", callId: "c" },
      {
        id: streamId("s-2"),
        lane: L,
        kind: "tool",
        callId: "c",
        statement: st(1),
      },
    ] as const
    expect(
      planEndRun({
        lane: L,
        run: runId("r-1"),
        running: runId("r-1"),
        streams,
      }),
    ).toEqual([
      { kind: "close", id: "s-1" },
      { kind: "close", id: "s-2" },
      { kind: "end", lane: L },
    ])
  })
})
