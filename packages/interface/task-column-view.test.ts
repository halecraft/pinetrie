import {
  entryId,
  type Reorder,
  taskIdFor,
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
  pinnedCountWords,
  taskColumnView,
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

describe("taskColumnView (ADR-0116)", () => {
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

test("a strip's task column is first, folded by default, and no card (ADR-0116)", () => {
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
  const moved: Reorder = {
    // @ts-expect-error: nor does a reorder name it, which has no card's id
    card: K,
    at: { kind: "canvas", task: K },
    after: null,
    before: null,
  }
  expect([cardFirst, taskAmong, moved]).toHaveLength(3)
})
