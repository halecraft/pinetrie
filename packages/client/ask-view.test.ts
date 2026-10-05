import {
  type EntryId,
  type EntryLike,
  entryId,
  indexAsks,
  type RevisionRecord,
  segmentPath,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  askView,
  type ColumnRow,
  columnRows,
  lastEndedAsk,
} from "./ask-view.ts"
import { entry, indexOf } from "./fixtures.ts"

type Message = NonNullable<EntryLike["message"]>
const chat: Message = {
  role: "chat",
  content: "Fix it",
  writer: writerId("ada"),
}
const said = (text: string): Message => ({
  role: "assistant",
  content: [{ type: "text", text }],
})
const index = indexOf([
  entry("1-p", null, chat),
  entry("2-a", "1-p", said("looking")),
  entry("3-a", "2-a", {
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
  entry("4-r", "3-a", { role: "toolResult", toolCallId: "c1", content: "ok" }),
  entry("5-a", "4-r", said("done")),
  entry("6-q", "5-a", chat),
])
const asks = indexAsks(index)
const path = [
  entryId("1-p"),
  entryId("2-a"),
  entryId("3-a"),
  entryId("5-a"),
  entryId("6-q"),
]
const noRevisions: ReadonlyMap<EntryId, RevisionRecord> = new Map()

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

test("columnRows: a base's news steered into a run is drawn in its ask's row", () => {
  const steered = indexOf([
    entry("1-p", null, chat),
    entry("2-a", "1-p", said("looking")),
    entry("3-a", "2-a", said("still looking")),
    entry("4-b", "3-a", { role: "behind", content: "↓ new work" }),
    entry("5-a", "4-b", said("more")),
    entry("6-a", "5-a", said("done")),
    entry("7-q", "6-a", chat),
    entry("8-b", "7-q", { role: "behind", content: "↓ newer work" }),
  ])
  const ids = ["1-p", "2-a", "3-a", "4-b", "5-a", "6-a", "7-q", "8-b"]
  const a = indexAsks(steered)
  const rows = columnRows(
    segmentPath(steered, a, ids.map(entryId), new Set()),
    a,
  )
  expect(rows.map(r => (r.kind === "message" ? r.id : r.ask))).toEqual([
    "1-p",
    "1-p",
    "7-q",
    "8-b",
  ])
  expect(rows[1]).toMatchObject({
    parts: [
      { kind: "fold", ids: ["2-a", "3-a"], first: true },
      { kind: "entry", id: "4-b" },
      { kind: "fold", ids: ["5-a"], first: false },
      { kind: "entry", id: "6-a" },
    ],
  })
})

test("lastEndedAsk: the column's last ask, passing over the one running", () => {
  const ask = (id: string): ColumnRow => ({
    kind: "ask",
    ask: entryId(id),
    parts: [{ kind: "entry", id: entryId(`${id}-a`) }],
  })
  const rows: readonly ColumnRow[] = [
    ask("1-p"),
    { kind: "message", id: entryId("2-p") },
    ask("2-p"),
    { kind: "message", id: entryId("3-m") },
  ]
  expect(lastEndedAsk(rows, null)).toBe("2-p")
  expect(lastEndedAsk(rows, entryId("2-p"))).toBe("1-p")
  expect(lastEndedAsk(rows.slice(1, 2), null)).toBeNull()
})

describe("askView", () => {
  const view = (over: Partial<Parameters<typeof askView>[0]> = {}) =>
    askView({
      index,
      asks,
      ask: entryId("1-p"),
      runningAsk: null,
      lastEnded: null,
      stops: new Map(),
      revisions: noRevisions,
      digests: new Map([
        [
          entryId("1-p"),
          { headline: "Fixed it", points: ["`rail.tsx`"], final: true },
        ],
      ]),
      releasedPath: null,
      nameOf: () => "Bea",
      ...over,
    })
  test("an ended ask: its work, no outcome to say, its last word, its final digest", () => {
    expect(view()).toMatchObject({
      running: false,
      endedWhileAway: false,
      work: "3 steps · 1 tool call",
      outcome: null,
      live: null,
      outlineHides: "5-a",
      headline: "Fixed it",
      points: ["`rail.tsx`"],
    })
  })
  test("a live digest shows its headline, never its points", () => {
    expect(
      view({
        runningAsk: entryId("1-p"),
        digests: new Map([
          [
            entryId("1-p"),
            { headline: "Fixing it", points: ["`rail.tsx`"], final: false },
          ],
        ]),
      }),
    ).toMatchObject({ headline: "Fixing it", points: [] })
  })
  test("outline keeps the last word of the column's last ended ask", () => {
    expect(view({ lastEnded: entryId("1-p") }).outlineHides).toBeNull()
  })
  test("it ended while its reader was away when its last entry is past the tip they left", () => {
    expect(
      view({ releasedPath: new Set([entryId("1-p"), entryId("2-a")]) })
        .endedWhileAway,
    ).toBe(true)
    expect(
      view({
        releasedPath: new Set([
          entryId("1-p"),
          entryId("2-a"),
          entryId("3-a"),
          entryId("4-r"),
          entryId("5-a"),
          entryId("6-q"),
        ]),
      }).endedWhileAway,
    ).toBe(false)
  })
  test("running, it says what it is doing", () => {
    expect(view({ runningAsk: entryId("1-p") })).toMatchObject({
      running: true,
      live: "done",
    })
  })
  test("a stop names who stopped it", () => {
    const stopped = indexOf([
      entry("1-p", null, chat),
      entry("2-a", "1-p", { ...said("wo"), stopReason: "aborted" }),
    ])
    expect(
      askView({
        index: stopped,
        asks: indexAsks(stopped),
        ask: entryId("1-p"),
        runningAsk: null,
        lastEnded: null,
        stops: new Map([
          [
            entryId("1-p"),
            { prompt: entryId("1-p"), by: writerId("bea"), at: 1 },
          ],
        ]),
        revisions: noRevisions,
        digests: new Map(),
        releasedPath: null,
        nameOf: () => "Bea",
      }).outcome,
    ).toBe("stopped by Bea")
  })
})
