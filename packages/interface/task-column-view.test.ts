import {
  type CardRecord,
  cardIdOfKind,
  entryId,
  NO_CONTENT,
  taskIdFor,
  threadIdFor,
  type Workflow,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type CardColumn,
  defaultView,
  type Strip,
  stripOf,
} from "./canvas-columns.ts"
import { NO_TEXT } from "./root-label.ts"
import {
  boardStateWords,
  canvasTrash,
  pinnedCountWords,
  taskColumnView,
  trashKeepWords,
  trashWords,
} from "./task-column-view.ts"
import { threadCardHead } from "./thread-card.ts"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const WEEK = 7 * DAY

const ADA = writerId("ada@x.io")
const K = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
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
  work: new Map(),
})

describe("taskColumnView", () => {
  test("its title, stored or not, its state by name, and Move to ▸ its thread card's", () => {
    const view = taskColumnView({
      task: K,
      folded: false,
      head,
      mark: { task: K, title: "Fix the sync bug", by: ADA, at: 1 },
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
      state: "Doing",
      readOnly: false,
    })
    expect(view.moves.map(m => m.name)).toEqual(["Backlog", "Done"])
    expect(view.moves).toBe(head.moves)
  })

  test("before the host placed it, with no title, and archived: read only, nothing to move", () => {
    const view = taskColumnView({
      task: K,
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
      state: null,
      moves: [],
      readOnly: true,
    })

    // Archived, it offers no move: Restore is the column's own (`readOnlyWords`).
    expect(
      taskColumnView({
        task: K,
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
    expect(boardStateWords("Doing")).toBe("in Doing")
    expect(boardStateWords(null)).toBe("not on the board yet")
    expect(pinnedCountWords(0)).toBeNull()
    expect(pinnedCountWords(2)).toBe("2 pinned")
  })
})

test("a strip's task column is first, folded by default, and no card's column", () => {
  const strip = stripOf(K, defaultView(null), [])
  expect(strip[0]).toEqual({ kind: "task", task: K, folded: true })
  const card = {
    kind: "notes",
    card: "n-x",
    folded: true,
    width: 1,
  } as unknown as CardColumn
  // @ts-expect-error: a card's column is never first
  const cardFirst: Strip = [card]
  // @ts-expect-error: and the task column is never among the cards
  const taskAmong: readonly CardColumn[] = [strip[0]]
  expect([cardFirst, taskAmong]).toHaveLength(2)
})

test("canvasTrash: the columns trashed from this canvas, newest first, with who trashed them and when", () => {
  const BEA = writerId("bea@x.io")
  const other = taskIdFor("01a0ffd2-0000-7000-8000-0000000000dd")
  const T1 = threadIdFor("old")
  const T2 = threadIdFor("new")
  const N = cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a1")
  const left = (task = K) =>
    ({ kind: "canvas", task, order: "a", width: 1 }) as const
  const cards: CardRecord[] = [
    {
      kind: "thread",
      id: T1,
      owner: ADA,
      placer: ADA,
      place: { kind: "trash", left: left() },
      content: NO_CONTENT,
    },
    {
      kind: "thread",
      id: T2,
      owner: ADA,
      placer: BEA,
      place: { kind: "trash", left: left() },
      content: NO_CONTENT,
    },
    {
      kind: "note-column",
      id: N,
      owner: ADA,
      placer: ADA,
      place: { kind: "trash", left: left(other) },
      content: NO_CONTENT,
    },
    {
      kind: "thread",
      id: threadIdFor("live"),
      owner: ADA,
      placer: ADA,
      place: left(),
      content: NO_CONTENT,
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
    task: K,
    now: 4 * DAY,
    keepMs: WEEK,
    names: new Map([[T2, "amber-fox" as never]]),
    noteTitles: new Map(),
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
        left: { kind: "canvas", task: K, order: "a", width: 1 },
      },
      content: NO_CONTENT,
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
      task: K,
      now,
      keepMs,
      names: new Map(),
      noteTitles: new Map(),
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
