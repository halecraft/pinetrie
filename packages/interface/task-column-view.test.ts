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
  trashWords,
} from "./task-column-view.ts"
import { threadCardHead } from "./thread-card.ts"

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
  offered: new Map(),
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
      trash: [],
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
      trash: [],
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
        trash: [],
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

test("canvasTrash: the columns trashed from this canvas, newest first, with who trashed them and the days left", () => {
  const DAY = 24 * 60 * 60 * 1000
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
  const rows = canvasTrash({
    cards,
    histories: new Map([
      [T1, { card: T1, events: [event(0)] }],
      [T2, { card: T2, events: [event(3 * DAY)] }],
    ]),
    task: K,
    now: 4 * DAY,
    names: new Map([[T2, "amber-fox" as never]]),
    noteTitles: new Map(),
  })
  expect(rows).toEqual([
    { card: T2, title: "amber-fox", by: BEA, deletesInDays: 6 },
    { card: T1, title: "a thread", by: ADA, deletesInDays: 3 },
  ])
  const reader = { me: ADA, nameOf: new Map([[BEA, "Bea"]]) }
  expect(rows.map(r => trashWords(r, reader))).toEqual([
    "Bea trashed it · deleted in 6 days",
    "you trashed it · deleted in 3 days",
  ])
})
