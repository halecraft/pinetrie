import { describe, expect, test } from "vitest"
import {
  ancestry,
  askOutcome,
  askSpan,
  askStats,
  commitId,
  compactRail,
  type EntryLike,
  entryId,
  indexAsks,
  indexTree,
  lastWord,
  projectRail,
  type RevisionRecord,
  railLandmarks,
  type Segment,
  segmentPath,
  startsRun,
  type TreeIndex,
  workStats,
  writerId,
} from "./index.ts"

type Message = NonNullable<EntryLike["message"]>
const e = (
  id: string,
  parentId: string | null,
  message: Message,
  timestamp?: number,
): [string, EntryLike] => [
  id,
  {
    id,
    parentId,
    type: "message",
    message,
    ...(timestamp === undefined ? {} : { timestamp }),
  },
]
const chat = (text = "hi"): Message => ({ role: "chat", content: text })
const said = (text: string, extra: Partial<Message> = {}): Message => ({
  role: "assistant",
  content: [{ type: "text", text }],
  ...extra,
})
const calls = (call: string): Message => ({
  role: "assistant",
  content: [{ type: "toolCall", id: call, name: "bash", arguments: {} }],
  stopReason: "toolUse",
})
const result = (call: string, text = "ok", isError = false): Message => ({
  role: "toolResult",
  toolCallId: call,
  content: text,
  isError,
})
const build = (rows: readonly [string, EntryLike][]): TreeIndex =>
  indexTree(Object.fromEntries(rows))

describe("indexAsks", () => {
  const index = build([
    e("1-p", null, chat()),
    e("2-a", "1-p", calls("c1")),
    e("3-r", "2-a", result("c1")),
    e("4-a", "3-r", said("done")),
    e("5-q", "4-a", chat("for people only")),
    e("6-l", "5-q", { role: "land", content: "resolving" }),
    e("7-a", "6-l", said("resolved")),
  ])
  const asks = indexAsks(index)
  test("a run's agent messages and results belong to its prompt", () => {
    expect(asks.work.get(entryId("1-p"))).toEqual(["2-a", "4-a"])
    expect(asks.askOf.get(entryId("3-r"))).toBe("1-p")
    expect(asks.last.get(entryId("1-p"))).toBe("4-a")
  })
  test("a person's message the agent did not answer is no ask; a land message's run is one", () => {
    expect(asks.work.has(entryId("5-q"))).toBe(false)
    expect(asks.work.get(entryId("6-l"))).toEqual(["7-a"])
  })
  test("is kept per index", () => {
    expect(indexAsks(index)).toBe(asks)
  })
})

describe("askOutcome and lastWord, over S70's endings", () => {
  const ask = (rows: readonly [string, EntryLike][]) => {
    const index = build([e("1-p", null, chat()), ...rows])
    const asks = indexAsks(index)
    const p = entryId("1-p")
    return {
      outcome: (stop?: { by: ReturnType<typeof writerId>; at: number }) =>
        askOutcome(index, asks, p, { running: false, stop }),
      word: lastWord(index, asks, p),
    }
  }
  const bea = writerId("bea")
  test("answered: its last message", () => {
    const a = ask([e("2-a", "1-p", said("done", { stopReason: "stop" }))])
    expect(a.outcome()).toEqual({ kind: "answered" })
    expect(a.word).toBe("2-a")
  })
  test("stopped while text streamed: the partial text, aborted", () => {
    const a = ask([e("2-a", "1-p", said("word wo", { stopReason: "aborted" }))])
    expect(a.outcome({ by: bea, at: 1 })).toEqual({ kind: "stopped", by: bea })
    expect(a.outcome()).toEqual({ kind: "stopped", by: null })
    expect(a.word).toBe("2-a")
  })
  test("stopped during a command: the run ends on its aborted result, and the call is the last word", () => {
    const a = ask([
      e("2-a", "1-p", calls("c1")),
      e("3-r", "2-a", result("c1", "Command aborted", true)),
    ])
    expect(a.outcome({ by: bea, at: 1 })).toEqual({ kind: "stopped", by: bea })
    expect(a.word).toBe("2-a")
  })
  test("stopped before the first response: an empty message, never a last word", () => {
    const a = ask([
      e("2-a", "1-p", {
        role: "assistant",
        content: [],
        stopReason: "aborted",
      }),
    ])
    expect(a.outcome()).toEqual({ kind: "stopped", by: null })
    expect(a.word).toBeNull()
  })
  test("a model error fails with its message; its empty text is no last word", () => {
    const a = ask([
      e("2-a", "1-p", said("done")),
      e(
        "3-a",
        "2-a",
        said("", { stopReason: "error", errorMessage: "no reply" }),
      ),
    ])
    expect(a.outcome()).toEqual({ kind: "failed", error: "no reply" })
    expect(a.word).toBe("2-a")
  })
  test("a restart's interrupted partial is not last: the resumed run answered", () => {
    const a = ask([
      e("2-a", "1-p", said("par", { stopReason: "error" })),
      e("3-a", "2-a", said("after resume", { stopReason: "stop" })),
    ])
    expect(a.outcome()).toEqual({ kind: "answered" })
  })
  test("a stop that lost the race to the answer is ignored", () => {
    const a = ask([e("2-a", "1-p", said("done", { stopReason: "stop" }))])
    expect(a.outcome({ by: bea, at: 1 })).toEqual({ kind: "answered" })
  })
  test("running is running", () => {
    const index = build([e("1-p", null, chat())])
    expect(
      askOutcome(index, indexAsks(index), entryId("1-p"), {
        running: true,
        stop: undefined,
      }),
    ).toEqual({ kind: "running" })
  })
})

describe("workStats", () => {
  const index = build([
    e("1-p", null, chat(), 100),
    e("2-a", "1-p", calls("c1"), 110),
    e("3-r", "2-a", result("c1", "x", true), 150),
    e("4-a", "3-r", calls("c2"), 160),
    e("5-r", "4-a", result("c2"), 170),
    e("6-a", "5-r", said("done"), 200),
    e("7-q", "6-a", chat("thanks"), 300),
  ])
  const rev = (entry: string, paths: string[]): [string, RevisionRecord] => [
    entry,
    {
      entry: entryId(entry),
      lane: "t-x" as RevisionRecord["lane"],
      commit: null,
      snapshot: null,
      paths,
    },
  ]
  const revisions = new Map([
    rev("2-a", ["a.txt", "b.txt"]),
    rev("4-a", ["b.txt", "c.txt"]),
  ])
  test("counts the work, the union of its turns' paths, and its time", () => {
    expect(
      workStats(index, ["2-a", "4-a", "6-a"], undefined, revisions),
    ).toEqual({
      people: 0,
      writers: [],
      agent: 3,
      calls: 2,
      failed: 1,
      files: ["a.txt", "b.txt", "c.txt"],
      first: 110,
      last: 200,
    })
  })
  test("a long ask's stretch and its fold hold the same messages", () => {
    const asks = indexAsks(index)
    const rows = projectRail(index, "1-p")
    const [, stretch] = compactRail(index, rows, new Set(), {
      asks,
      revisions,
    })
    const path = rows.map(r => r.id)
    // The column folds the work before the last word: the same stats with
    // the last word counted, as the digest line does.
    const fold = segmentPath(index, asks, path, railLandmarks(rows, new Set()))
    expect(stretch).toMatchObject({ kind: "stretch", ask: "1-p" })
    expect(fold.map(s => (s.kind === "entry" ? s.id : [...s.ids]))).toEqual([
      "1-p",
      ["2-a", "4-a"],
      "6-a",
      "7-q",
    ])
    expect(
      stretch?.kind === "stretch"
        ? workStats(index, stretch.ids, "7-q", revisions)
        : null,
    ).toEqual(askStats(index, asks, entryId("1-p"), revisions))
  })
})

describe("askSpan", () => {
  const index = build([
    e("1-p", null, chat()),
    e("2-a", "1-p", calls("c1")),
    e("3-r", "2-a", result("c1")),
    e("4-a", "3-r", said("done")),
  ])
  const asks = indexAsks(index)
  const rev = (
    entry: string,
    commit: string | null,
  ): [string, RevisionRecord] => [
    entry,
    {
      entry: entryId(entry),
      lane: "t-x" as RevisionRecord["lane"],
      commit: commit === null ? null : commitId(commit),
      snapshot: null,
      paths: [],
    },
  ]
  test("from what the lane had before the ask to its last turn's commit", () => {
    expect(
      askSpan(
        index,
        asks,
        entryId("1-p"),
        new Map([rev("1-p", "a0"), rev("2-a", "a1")]),
      ),
    ).toEqual({ kind: "range", from: "a0", to: "a1" })
  })
  test("none when no turn committed, or the lane works directly", () => {
    expect(
      askSpan(
        index,
        asks,
        entryId("1-p"),
        new Map([rev("1-p", "a0"), rev("2-a", null)]),
      ),
    ).toBeNull()
    expect(
      askSpan(index, asks, entryId("1-p"), new Map([rev("1-p", null)])),
    ).toBeNull()
  })
})

describe("compactRail and asks", () => {
  test("a long ask is a dot and a capsule; its next prompt starts again", () => {
    const rows: [string, EntryLike][] = [
      e("01", null, chat()),
      e("02", "01", said("ok")),
      e("03", "02", chat()),
      e("04", "03", said("ok")),
      e("05", "04", chat("the long one")),
    ]
    let parent = "05"
    for (const id of ["06", "07", "08", "09"]) {
      rows.push(e(id, parent, said(id)))
      parent = id
    }
    rows.push(e("10", parent, chat("next")), e("11", "10", said("ok")))
    rows.push(e("12", "11", chat("more")), e("13", "12", said("ok")))
    rows.push(e("14", "13", chat("end")))
    const index = build(rows)
    const items = compactRail(index, projectRail(index, "01"), new Set(), {
      asks: indexAsks(index),
      revisions: new Map(),
    })
    expect(
      items.map(it => (it.kind === "dot" ? it.ids[0] : [...it.ids])),
    ).toEqual([
      "01",
      ["02", "03", "04"],
      "05",
      ["06", "07", "08", "09"],
      ["10", "11", "12", "13"],
      "14",
    ])
    expect(items[3]).toMatchObject({ kind: "stretch", ask: "05" })
  })
  test("short exchanges still merge across their asks", () => {
    const rows: [string, EntryLike][] = [e("00", null, chat())]
    let parent = "00"
    for (let k = 1; k <= 10; k += 1) {
      const q = `${String(2 * k).padStart(2, "0")}`
      const a = `${String(2 * k + 1).padStart(2, "0")}`
      rows.push(e(q, parent, chat()), e(a, q, said("ok")))
      parent = a
    }
    rows.push(e("99", parent, chat()))
    const index = build(rows)
    const items = compactRail(index, projectRail(index, "00"), new Set(), {
      asks: indexAsks(index),
      revisions: new Map(),
    })
    expect(items).toHaveLength(3)
    expect(items[1]).toMatchObject({ kind: "stretch", ask: null })
  })
})

// ── the rail and the column agree, over every small tree ───────────────────

/** Every way to give `n` entries parents among the ones before them. */
function* shapes(n: number): Generator<(number | null)[]> {
  const parents: (number | null)[] = [null]
  function* grow(): Generator<(number | null)[]> {
    if (parents.length === n) {
      yield [...parents]
      return
    }
    for (let p = 0; p < parents.length; p += 1) {
      parents.push(p)
      yield* grow()
      parents.pop()
    }
  }
  yield* grow()
}

/** Every assignment of a role to entries after the first, which is a chat. */
function* roles(n: number): Generator<("chat" | "agent" | "update")[]> {
  const all = ["chat", "agent", "update"] as const
  const total = 3 ** (n - 1)
  for (let k = 0; k < total; k += 1) {
    const out: ("chat" | "agent" | "update")[] = ["chat"]
    let x = k
    for (let i = 1; i < n; i += 1) {
      out.push(all[x % 3] ?? "chat")
      x = Math.floor(x / 3)
    }
    yield out
  }
}

const id = (i: number) => `${String(i).padStart(2, "0")}`

/** Segment edges on a path: each segment's first and last position. */
function edges(segments: readonly Segment[], path: readonly string[]) {
  const starts = new Set<number>()
  const ends = new Set<number>()
  for (const s of segments) {
    const ids = s.kind === "entry" ? [s.id] : s.ids
    starts.add(path.indexOf(ids[0] ?? ""))
    ends.add(path.indexOf(ids.at(-1) ?? ""))
  }
  return { starts, ends }
}

test("over every tree of 6 entries: no fold crosses a prompt, landmarks are drawn, and every rail capsule's edges are column edges", () => {
  let checked = 0
  for (const shape of shapes(6))
    for (const role of roles(6)) {
      const index = build(
        shape.map((p, i) =>
          e(
            id(i),
            p === null ? null : id(p),
            role[i] === "agent"
              ? said("x")
              : role[i] === "update"
                ? { role: "update", content: "u" }
                : chat(),
          ),
        ),
      )
      const asks = indexAsks(index)
      const leaves = shape
        .map((_, i) => id(i))
        .filter(i => (index.childrenOf.get(i) ?? []).length === 0)
      for (const leaf of leaves) {
        const path = ancestry(index, leaf).path.toReversed()
        // A column's end is kept, as `railKeep` keeps every open column's.
        const keep = new Set([leaf])
        const rows = projectRail(index, "00")
        const landmarks = railLandmarks(rows, keep)
        const segments = segmentPath(index, asks, path, landmarks)
        for (const s of segments) {
          if (s.kind === "entry") continue
          const at = path.indexOf(s.ids[0])
          for (const [k, f] of s.ids.entries()) {
            expect(path[at + k]).toBe(f)
            expect(startsRun(index.entries[f])).toBe(false)
            expect(landmarks.has(f)).toBe(false)
          }
        }
        const { starts, ends } = edges(segments, path)
        for (const it of compactRail(index, rows, keep, {
          asks,
          revisions: new Map(),
        })) {
          if (it.kind !== "stretch" || !path.includes(it.ids[0])) continue
          expect(starts.has(path.indexOf(it.ids[0]))).toBe(true)
          expect(ends.has(path.indexOf(it.ids.at(-1) ?? ""))).toBe(true)
        }
        checked += 1
      }
    }
  expect(checked).toBeGreaterThan(10_000)
})
