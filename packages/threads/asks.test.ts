import {
  type EntryId,
  entryId,
  pointId,
  type RevisionRecord,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  entriesById,
  entry,
  FIXTURE_THREAD,
  lineMessage,
  personMessage as person,
  toolResultMessage,
} from "./fixtures.ts"
import {
  type AgentMessageLike,
  type AssistantMessage,
  askOutcome,
  askSpan,
  type EntryLike,
  entryAsk,
  indexAsks,
  indexTree,
  isLongAsk,
  LONG_ASK,
  lastWord,
  startsRun,
  type TreeIndex,
  threadAsks,
} from "./index.ts"

type Message = AgentMessageLike
const personMessage = (text = "hi"): Message => person(text)
const said = (
  text: string,
  extra: Partial<Omit<AssistantMessage, "role">> = {},
): Message => ({
  role: "assistant",
  content: [{ type: "text", text }],
  ...extra,
})
const calls = (call: string): Message => ({
  role: "assistant",
  content: [{ type: "toolCall", id: call, name: "bash", arguments: {} }],
  stopReason: "toolUse",
})
const result = (call: string, text = "ok", isError = false): Message =>
  toolResultMessage({ toolCallId: call, content: text, isError })
const build = (rows: readonly EntryLike[]): TreeIndex =>
  indexTree(entriesById(rows))

describe("indexAsks", () => {
  const index = build([
    entry("1-p", null, personMessage()),
    entry("2-a", "1-p", calls("c1")),
    entry("3-r", "2-a", result("c1")),
    entry("4-a", "3-r", said("done")),
    entry("5-q", "4-a", personMessage("for people only")),
    entry("6-l", "5-q", lineMessage("land", "resolving")),
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

test("a base's news steered in between a run's entries is steered into it; one after the run or before a prompt is not", () => {
  const behind = (to: string): Message => lineMessage("behind", to)
  const index = build([
    entry("1-b", null, behind("before the prompt")),
    entry("2-p", "1-b", personMessage()),
    entry("3-a", "2-p", calls("c1")),
    entry("4-r", "3-a", result("c1")),
    entry("5-b", "4-r", behind("mid-run")),
    entry("6-a", "5-b", said("done")),
    entry("7-b", "6-a", behind("after the run")),
  ])
  const asks = indexAsks(index)
  expect([...asks.steered]).toEqual([["5-b", "2-p"]])
  expect(entryAsk(asks, entryId("5-b"))).toBe("2-p")
  expect(entryAsk(asks, entryId("4-r"))).toBe("2-p")
  expect(entryAsk(asks, entryId("7-b"))).toBeUndefined()
  expect(asks.askOf.has(entryId("5-b"))).toBe(false)
})

test("a carry-on message starts an ask of its own; the stopped ask before it stays stopped", () => {
  const index = build([
    entry("1-p", null, personMessage()),
    entry("2-a", "1-p", said("word wo", { stopReason: "aborted" })),
    entry("3-c", "2-a", lineMessage("carry-on", "↻ resumed by Ada")),
    entry("4-a", "3-c", said("done", { stopReason: "stop" })),
  ])
  const asks = indexAsks(index)
  expect(startsRun(index.entries[entryId("3-c")])).toBe(true)
  expect(asks.work.get(entryId("3-c"))).toEqual(["4-a"])
  expect(asks.work.get(entryId("1-p"))).toEqual(["2-a"])
  const facts = { running: false, stop: undefined }
  expect(askOutcome(index, asks, entryId("1-p"), facts)).toEqual({
    kind: "stopped",
    by: null,
  })
  expect(askOutcome(index, asks, entryId("3-c"), facts)).toEqual({
    kind: "answered",
  })
})

test("isLongAsk: a run of LONG_ASK agent messages, not one fewer", () => {
  const rows = (n: number) =>
    build([
      entry("0-p", null, personMessage()),
      ...Array.from({ length: n }, (_, i) =>
        entry(`${i + 1}-a`, `${i === 0 ? "0-p" : `${i}-a`}`, said(`step ${i}`)),
      ),
    ])
  const long = (n: number) => isLongAsk(indexAsks(rows(n)), entryId("0-p"))
  expect(long(LONG_ASK - 1)).toBe(false)
  expect(long(LONG_ASK)).toBe(true)
  expect(isLongAsk(indexAsks(rows(0)), entryId("0-p"))).toBe(false)
})

test("a stop's fact names who stopped its ask, and is drawn in it: the first press's", () => {
  const stopFact = (by: string): Message => ({
    role: "fact",
    content: "■ the run was stopped",
    stopped: { prompt: entryId("1-p"), by: writerId(by) },
  })
  const index = build([
    entry("1-p", null, personMessage()),
    entry("2-a", "1-p", said("word wo", { stopReason: "aborted" })),
    entry("3-f", "2-a", stopFact("bea")),
    entry("4-f", "3-f", stopFact("cal")),
    entry("5-c", "4-f", lineMessage("carry-on", "go on")),
  ])
  const asks = indexAsks(index)
  expect(asks.stoppedBy.get(entryId("1-p"))).toBe(writerId("bea"))
  expect(asks.steered.get(entryId("3-f"))).toBe("1-p")
  expect(asks.askOf.has(entryId("3-f"))).toBe(false)
  expect(askOutcome(index, asks, entryId("1-p"), { running: false })).toEqual({
    kind: "stopped",
    by: writerId("bea"),
  })
})

describe("askOutcome and lastWord, over each way a run ends", () => {
  const ask = (rows: readonly EntryLike[]) => {
    const index = build([entry("1-p", null, personMessage()), ...rows])
    const asks = indexAsks(index)
    const p = entryId("1-p")
    return {
      /** Its outcome, the stop's fact naming `by` when given. */
      outcome: (stop?: { by: ReturnType<typeof writerId>; at: number }) =>
        askOutcome(
          index,
          stop === undefined
            ? asks
            : { ...asks, stoppedBy: new Map([[p, stop.by]]) },
          p,
          { running: false },
        ),
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
    const index = build([entry("1-p", null, personMessage())])
    expect(
      askOutcome(index, indexAsks(index), entryId("1-p"), { running: true }),
    ).toEqual({ kind: "running" })
  })
})

describe("askSpan", () => {
  const index = build([
    entry("1-p", null, personMessage()),
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
      lane: threadIdFor("x"),
      point: commit === null ? null : pointId(commit),
      snapshot: null,
      paths: [],
      conflicts: [],
      disk: null,
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

test("a thread's asks are its own runs' prompts, oldest first", () => {
  const other = threadIdFor("other")
  const index = build([
    entry("1-p", null, personMessage("in the parent")),
    entry("2-a", "1-p", said("parent's answer")),
    entry("3-p", "2-a", personMessage("first"), { thread: other }),
    entry("4-a", "3-p", said("one"), { thread: other }),
    entry("5-q", "4-a", personMessage("for people only"), { thread: other }),
    entry("6-l", "5-q", lineMessage("land", "land it"), { thread: other }),
    entry("7-a", "6-l", said("landed"), { thread: other }),
  ])
  const asks = indexAsks(index)
  expect(threadAsks(index, asks, other)).toEqual(["3-p", "6-l"])
  expect(threadAsks(index, asks, FIXTURE_THREAD)).toEqual(["1-p"])
  expect(threadAsks(index, asks, threadIdFor("none"))).toEqual([])
})
