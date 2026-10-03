import { describe, expect, test } from "vitest"
import { entriesOf, entry } from "./fixtures.ts"
import {
  ancestry,
  askOutcome,
  askSpan,
  askStats,
  commitId,
  compactRail,
  type EntryId,
  type EntryLike,
  entryId,
  indexAsks,
  indexTree,
  laneNameForThread,
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
const build = (rows: readonly EntryLike[]): TreeIndex =>
  indexTree(entriesOf(rows))

describe("indexAsks", () => {
  const index = build([
    entry("1-p", null, chat()),
    entry("2-a", "1-p", calls("c1")),
    entry("3-r", "2-a", result("c1")),
    entry("4-a", "3-r", said("done")),
    entry("5-q", "4-a", chat("for people only")),
    entry("6-l", "5-q", { role: "land", content: "resolving" }),
    entry("7-a", "6-l", said("resolved")),
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
  const ask = (rows: readonly EntryLike[]) => {
    const index = build([entry("1-p", null, chat()), ...rows])
    const asks = indexAsks(index)
    const p = entryId("1-p")
    return {
      outcome: (stop?: { by: ReturnType<typeof writerId>; at: number }) =>
        askOutcome(index, asks, p, {
          running: false,
          stop: stop === undefined ? undefined : { prompt: p, ...stop },
        }),
      word: lastWord(index, asks, p),
    }
  }
  const bea = writerId("bea")
  test("answered: its last message", () => {
    const a = ask([entry("2-a", "1-p", said("done", { stopReason: "stop" }))])
    expect(a.outcome()).toEqual({ kind: "answered" })
    expect(a.word).toBe("2-a")
  })
  test("stopped while text streamed: the partial text, aborted", () => {
    const a = ask([
      entry("2-a", "1-p", said("word wo", { stopReason: "aborted" })),
    ])
    expect(a.outcome({ by: bea, at: 1 })).toEqual({ kind: "stopped", by: bea })
    expect(a.outcome()).toEqual({ kind: "stopped", by: null })
    expect(a.word).toBe("2-a")
  })
  test("stopped during a command: the run ends on its aborted result, and the call is the last word", () => {
    const a = ask([
      entry("2-a", "1-p", calls("c1")),
      entry("3-r", "2-a", result("c1", "Command aborted", true)),
    ])
    expect(a.outcome({ by: bea, at: 1 })).toEqual({ kind: "stopped", by: bea })
    expect(a.word).toBe("2-a")
  })
  test("stopped before the first response: an empty message, never a last word", () => {
    const a = ask([
      entry("2-a", "1-p", {
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
      entry("2-a", "1-p", said("done")),
      entry(
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
      entry("2-a", "1-p", said("par", { stopReason: "error" })),
      entry("3-a", "2-a", said("after resume", { stopReason: "stop" })),
    ])
    expect(a.outcome()).toEqual({ kind: "answered" })
  })
  test("a stop that lost the race to the answer is ignored", () => {
    const a = ask([entry("2-a", "1-p", said("done", { stopReason: "stop" }))])
    expect(a.outcome({ by: bea, at: 1 })).toEqual({ kind: "answered" })
  })
  test("running is running", () => {
    const index = build([entry("1-p", null, chat())])
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
    entry("1-p", null, chat(), { timestamp: 100 }),
    entry("2-a", "1-p", calls("c1"), { timestamp: 110 }),
    entry("3-r", "2-a", result("c1", "x", true), { timestamp: 150 }),
    entry("4-a", "3-r", calls("c2"), { timestamp: 160 }),
    entry("5-r", "4-a", result("c2"), { timestamp: 170 }),
    entry("6-a", "5-r", said("done"), { timestamp: 200 }),
    entry("7-q", "6-a", chat("thanks"), { timestamp: 300 }),
  ])
  const rev = (entry: string, paths: string[]): [EntryId, RevisionRecord] => [
    entryId(entry),
    {
      entry: entryId(entry),
      lane: laneNameForThread("x"),
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
      workStats(
        index,
        [entryId("2-a"), entryId("4-a"), entryId("6-a")],
        undefined,
        revisions,
      ),
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
    const rows = projectRail(index, entryId("1-p"))
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
        ? workStats(index, stretch.ids, entryId("7-q"), revisions)
        : null,
    ).toEqual(askStats(index, asks, entryId("1-p"), revisions))
  })
})

describe("askSpan", () => {
  const index = build([
    entry("1-p", null, chat()),
    entry("2-a", "1-p", calls("c1")),
    entry("3-r", "2-a", result("c1")),
    entry("4-a", "3-r", said("done")),
  ])
  const asks = indexAsks(index)
  const rev = (
    entry: string,
    commit: string | null,
  ): [EntryId, RevisionRecord] => [
    entryId(entry),
    {
      entry: entryId(entry),
      lane: laneNameForThread("x"),
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
    const rows: EntryLike[] = [
      entry("01", null, chat()),
      entry("02", "01", said("ok")),
      entry("03", "02", chat()),
      entry("04", "03", said("ok")),
      entry("05", "04", chat("the long one")),
    ]
    let parent = "05"
    for (const id of ["06", "07", "08", "09"]) {
      rows.push(entry(id, parent, said(id)))
      parent = id
    }
    rows.push(entry("10", parent, chat("next")), entry("11", "10", said("ok")))
    rows.push(entry("12", "11", chat("more")), entry("13", "12", said("ok")))
    rows.push(entry("14", "13", chat("end")))
    const index = build(rows)
    const items = compactRail(
      index,
      projectRail(index, entryId("01")),
      new Set(),
      {
        asks: indexAsks(index),
        revisions: new Map(),
      },
    )
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
    const rows: EntryLike[] = [entry("00", null, chat())]
    let parent = "00"
    for (let k = 1; k <= 10; k += 1) {
      const q = `${String(2 * k).padStart(2, "0")}`
      const a = `${String(2 * k + 1).padStart(2, "0")}`
      rows.push(entry(q, parent, chat()), entry(a, q, said("ok")))
      parent = a
    }
    rows.push(entry("99", parent, chat()))
    const index = build(rows)
    const items = compactRail(
      index,
      projectRail(index, entryId("00")),
      new Set(),
      {
        asks: indexAsks(index),
        revisions: new Map(),
      },
    )
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

const id = (i: number) => entryId(String(i).padStart(2, "0"))

/** Segment edges on a path: each segment's first and last position. */
function edges(segments: readonly Segment[], path: readonly EntryId[]) {
  const starts = new Set<number>()
  const ends = new Set<number>()
  for (const s of segments) {
    const ids = s.kind === "entry" ? [s.id] : s.ids
    starts.add(ids[0] === undefined ? -1 : path.indexOf(ids[0]))
    const last = ids.at(-1)
    ends.add(last === undefined ? -1 : path.indexOf(last))
  }
  return { starts, ends }
}

test("over every tree of 6 entries: no fold crosses a prompt, landmarks are drawn, and every rail capsule's edges are column edges", () => {
  let checked = 0
  for (const shape of shapes(6))
    for (const role of roles(6)) {
      const index = build(
        shape.map((p, i) =>
          entry(
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
        const rows = projectRail(index, entryId("00"))
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
          expect(ends.has(path.indexOf(it.ids.at(-1) ?? it.ids[0]))).toBe(true)
        }
        checked += 1
      }
    }
  expect(checked).toBeGreaterThan(10_000)
})
