import {
  type EntryLike,
  entryId,
  indexAsks,
  indexTree,
  type RevisionRecord,
  segmentPath,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { askView, columnRows } from "./ask-view.ts"

type Message = NonNullable<EntryLike["message"]>
const e = (
  id: string,
  parentId: string | null,
  message: Message,
): [string, EntryLike] => [id, { id, parentId, type: "message", message }]
const chat: Message = {
  role: "chat",
  content: "Fix it",
  writer: writerId("ada"),
}
const said = (text: string): Message => ({
  role: "assistant",
  content: [{ type: "text", text }],
})
const index = indexTree(
  Object.fromEntries([
    e("1-p", null, chat),
    e("2-a", "1-p", said("looking")),
    e("3-a", "2-a", {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "c1",
          name: "bash",
          arguments: { command: "pnpm test" },
        },
      ],
    }),
    e("4-r", "3-a", { role: "toolResult", toolCallId: "c1", content: "ok" }),
    e("5-a", "4-r", said("done")),
    e("6-q", "5-a", chat),
  ]),
)
const asks = indexAsks(index)
const path = ["1-p", "2-a", "3-a", "5-a", "6-q"]
const noRevisions: ReadonlyMap<string, RevisionRecord> = new Map()

test("columnRows: an ask's work is one row, its prompt and what follows rows of their own", () => {
  const rows = columnRows(segmentPath(index, asks, path, new Set()), asks)
  expect(rows.map(r => (r.kind === "message" ? r.id : r.ask))).toEqual([
    "1-p",
    "1-p",
    "6-q",
  ])
  expect(rows[1]).toMatchObject({
    kind: "ask",
    parts: [
      { kind: "fold", ids: ["2-a", "3-a"], first: true },
      { kind: "entry", id: "5-a" },
    ],
  })
})

describe("askView", () => {
  const view = (over: Partial<Parameters<typeof askView>[0]> = {}) =>
    askView({
      index,
      asks,
      ask: entryId("1-p"),
      runningAsk: null,
      stops: new Map(),
      revisions: noRevisions,
      digests: new Map([["1-p", { text: "Fixed it." }]]),
      releasedPath: null,
      nameOf: () => "Bea",
      ...over,
    })
  test("an ended ask: its digest, no outcome to say, its last word", () => {
    expect(view()).toMatchObject({
      running: false,
      endedWhileAway: false,
      digest: "3 steps · 1 tool call",
      outcome: null,
      live: null,
      lastWord: "5-a",
      summary: "Fixed it.",
    })
  })
  test("it ended while its reader was away when its last entry is past the tip they left", () => {
    expect(view({ releasedPath: new Set(["1-p", "2-a"]) }).endedWhileAway).toBe(
      true,
    )
    expect(
      view({
        releasedPath: new Set(["1-p", "2-a", "3-a", "4-r", "5-a", "6-q"]),
      }).endedWhileAway,
    ).toBe(false)
  })
  test("running, it says what it is doing", () => {
    expect(view({ runningAsk: "1-p" })).toMatchObject({
      running: true,
      live: "done",
    })
  })
  test("a stop names who stopped it", () => {
    const stopped = indexTree(
      Object.fromEntries([
        e("1-p", null, chat),
        e("2-a", "1-p", { ...said("wo"), stopReason: "aborted" }),
      ]),
    )
    expect(
      askView({
        index: stopped,
        asks: indexAsks(stopped),
        ask: entryId("1-p"),
        runningAsk: null,
        stops: new Map([["1-p", { by: writerId("bea"), at: 1 }]]),
        revisions: noRevisions,
        digests: new Map(),
        releasedPath: null,
        nameOf: () => "Bea",
      }).outcome,
    ).toBe("stopped by Bea")
  })
})
