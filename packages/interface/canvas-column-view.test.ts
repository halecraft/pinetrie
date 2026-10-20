import {
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  entryId,
  threadIdFor,
  UNTICKED,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import type { Workflow } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import {
  boardPlaceWords,
  canvasColumnView,
  canvasTrash,
  pinnedCountWords,
  trashKeepWords,
  trashWords,
} from "./canvas-column-view.ts"
import {
  buildTaskStrip,
  type CardColumn,
  defaultView,
  type Strip,
} from "./canvas-columns.ts"
import { NO_TEXT } from "./root-label.ts"
import { threadCardHead } from "./thread-card.ts"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const WEEK = 7 * DAY

const ADA = writerId("ada@x.io")
const K = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const [B, D, X] = ["b", "d", "x"].map(workflowStateIdFor) as [
  ReturnType<typeof workflowStateIdFor>,
  ReturnType<typeof workflowStateIdFor>,
  ReturnType<typeof workflowStateIdFor>,
]
const WORKFLOW: Workflow = {
  open: [
    { id: B, name: "Backlog" },
    { id: D, name: "Doing" },
  ],
  archive: { id: X, name: "Done" },
}
const head = threadCardHead(K, {
  workflow: WORKFLOW,
  stateOf: new Map([[K, D]]),
  labels: new Map([[K, "Fix the sync bug"]]),
  status: new Map(),
  pips: new Set(),
  proposed: new Map(),
  ready: new Map(),
  work: new Map(),
})

describe("canvasColumnView", () => {
  test("its title, stored or not, its state by name, and Move to ▸ its thread card's", () => {
    const view = canvasColumnView({
      canvas: K,
      folded: false,
      head,
      mark: { canvas: K, title: "Fix the sync bug", by: ADA, at: 1 },
      summary: {
        line: "the sync drops a write",
        writers: [],
        newest: entryId("e"),
      },
      workflow: WORKFLOW,
      archived: false,
      trash: { rows: [], keepMs: WEEK },
    })
    expect(view).toMatchObject({
      label: "Fix the sync bug",
      titled: "Fix the sync bug",
      placeholder: "the sync drops a write",
      place: { name: "Doing", role: "task" },
      readOnly: false,
    })
    expect(view.moves.map(m => m.name)).toEqual(["Backlog", "Done"])
    expect(view.moves).toBe(head.moves)
  })

  test("before the host placed it, with no title, and archived: read only, nothing to move", () => {
    const view = canvasColumnView({
      canvas: K,
      folded: true,
      head: undefined,
      mark: undefined,
      summary: undefined,
      workflow: null,
      archived: true,
      trash: { rows: [], keepMs: WEEK },
    })
    expect(view).toMatchObject({
      folded: true,
      label: NO_TEXT,
      titled: null,
      place: null,
      moves: [],
      readOnly: true,
    })

    // Archived, it offers no move: Restore is the column's own (`readOnlyWords`).
    expect(
      canvasColumnView({
        canvas: K,
        folded: false,
        head,
        mark: undefined,
        summary: undefined,
        workflow: WORKFLOW,
        archived: true,
        trash: { rows: [], keepMs: WEEK },
      }).moves,
    ).toEqual([])
  })

  test("its words", () => {
    expect(boardPlaceWords({ name: "Topics", role: "topic" })).toEqual({
      line: "a topic, in Topics",
      moveLabel: "move this topic on the board",
    })
    expect(boardPlaceWords({ name: "Active", role: "task" }).line).toBe(
      "a task, in Active",
    )
    expect(boardPlaceWords({ name: "Done", role: "archived" })).toEqual({
      line: "archived, in Done",
      moveLabel: "move this canvas on the board",
    })
    expect(boardPlaceWords(null).line).toBe("not on the board yet")
    expect(pinnedCountWords(0)).toBeNull()
    expect(pinnedCountWords(2)).toBe("2 pinned")
  })
})

test("a strip's canvas column is first, folded by default, and no card's column", () => {
  const strip = buildTaskStrip(K, defaultView(null), [])
  expect(strip[0]).toEqual({ kind: "canvas", canvas: K, folded: true })
  const card = {
    kind: "notes",
    card: "n-x",
    folded: true,
    width: 1,
  } as unknown as CardColumn
  // @ts-expect-error: a card's column is never first
  const cardFirst: Strip = [card]
  // @ts-expect-error: and the canvas column is never among the cards
  const canvasAmong: readonly CardColumn[] = [strip[0]]
  expect([cardFirst, canvasAmong]).toHaveLength(2)
})

test("canvasTrash: the columns trashed from this canvas, newest first, with who trashed them and when", () => {
  const BEA = writerId("bea@x.io")
  const other = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000dd")
  const T1 = threadIdFor("old")
  const T2 = threadIdFor("new")
  const N = cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a1")
  const left = (canvas = K) =>
    ({ kind: "canvas", canvas, order: "a", width: 1 }) as const
  const cards: CardRecord[] = [
    {
      kind: "thread",
      id: T1,
      owner: ADA,
      placer: ADA,
      place: { kind: "trash", left: left() },
      content: UNTICKED,
    },
    {
      kind: "thread",
      id: T2,
      owner: ADA,
      placer: BEA,
      place: { kind: "trash", left: left() },
      content: UNTICKED,
    },
    {
      kind: "note-column",
      id: N,
      owner: ADA,
      placer: ADA,
      place: { kind: "trash", left: left(other) },
      content: UNTICKED,
    },
    {
      kind: "thread",
      id: threadIdFor("live"),
      owner: ADA,
      placer: ADA,
      place: left(),
      content: UNTICKED,
    },
  ]
  const event = (at: number) => ({
    kind: "moved" as const,
    by: ADA,
    from: null,
    to: { kind: "trash" as const },
    at,
  })
  const { rows } = canvasTrash({
    cards,
    histories: new Map([
      [T1, { card: T1, events: [event(0)] }],
      [T2, { card: T2, events: [event(3 * DAY)] }],
    ]),
    canvas: K,
    now: 4 * DAY,
    keepMs: WEEK,
    names: new Map([[T2, "amber-fox" as never]]),
    cardTitles: new Map(),
  })
  expect(rows).toEqual([
    { card: T2, title: "amber-fox", by: BEA, ageMs: DAY, deletesInMs: null },
    { card: T1, title: "a thread", by: ADA, ageMs: 4 * DAY, deletesInMs: null },
  ])
  const reader = { me: ADA, nameOf: new Map([[BEA, "Bea"]]) }
  expect(rows.map(r => trashWords(r, reader))).toEqual([
    "Bea · 1 d ago",
    "you · 4 d ago",
  ])
})

test("canvasTrash: a column whose deletion is close says when, by the keep it is given", () => {
  const T1 = threadIdFor("close")
  const cards: CardRecord[] = [
    {
      kind: "thread",
      id: T1,
      owner: ADA,
      placer: ADA,
      place: {
        kind: "trash",
        left: { kind: "canvas", canvas: K, order: "a", width: 1 },
      },
      content: UNTICKED,
    },
  ]
  const histories = new Map([
    [
      T1,
      {
        card: T1,
        events: [
          {
            kind: "moved" as const,
            by: ADA,
            from: null,
            to: { kind: "trash" as const },
            at: 0,
          },
        ],
      },
    ],
  ])
  const rowAt = (now: number, keepMs: number) =>
    canvasTrash({
      cards,
      histories,
      canvas: K,
      now,
      keepMs,
      names: new Map(),
      cardTitles: new Map(),
    }).rows[0]
  const reader = { me: ADA, nameOf: new Map() }
  // A week's keep warns in its last day, and not before.
  expect(rowAt(6 * DAY - 1, WEEK)?.deletesInMs).toBeNull()
  const lastDay = rowAt(WEEK - 3 * HOUR, WEEK)
  expect(lastDay?.deletesInMs).toBe(3 * HOUR)
  expect(lastDay && trashWords(lastDay, reader)).toBe("you · deleted in 3 h")
  // A keep of eight hours warns in its last two, not from the start.
  expect(rowAt(5 * HOUR, 8 * HOUR)?.deletesInMs).toBeNull()
  expect(rowAt(7 * HOUR, 8 * HOUR)?.deletesInMs).toBe(HOUR)
})

test("the trash's line says how long a column is kept, from the keep itself", () => {
  expect(trashKeepWords(WEEK)).toBe(
    "kept for a week after it is trashed, then deleted",
  )
  expect(trashKeepWords(30 * DAY)).toBe(
    "kept for 30 days after it is trashed, then deleted",
  )
})
