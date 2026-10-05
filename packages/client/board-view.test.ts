import {
  type BoardPlace,
  type EntryId,
  entryId,
  laneNameForThread,
  type RootId,
  type RootSummary,
  rootIdFor,
  type Workflow,
  type WriterId,
  workflowStateIdFor,
  writerId,
} from "@pineta/core"
import { orderKeys } from "@pineta/rules"
import { describe, expect, test } from "vitest"
import type { Status } from "./attention.ts"
import {
  type BoardViewInput,
  boardView,
  CLOSED_RECENT,
  closedRows,
  nameStateIntent,
  removeWords,
} from "./board-view.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const [BACKLOG, DOING, DONE] = ["b", "d", "x"].map(workflowStateIdFor) as [
  ReturnType<typeof workflowStateIdFor>,
  ReturnType<typeof workflowStateIdFor>,
  ReturnType<typeof workflowStateIdFor>,
]
const WORKFLOW: Workflow = {
  open: [
    { id: BACKLOG, name: "Backlog" },
    { id: DOING, name: "Doing" },
  ],
  closed: { id: DONE, name: "Done" },
}
const ID = (n: number) =>
  rootIdFor(`01a0ffd2-0000-7000-8000-${String(n).padStart(12, "0")}`)
const E = (n: number) => entryId(`${n}-r`)
const keys = orderKeys(4)
const place = (n: number, state: typeof DOING, rank = 0): BoardPlace => ({
  root: ID(n),
  state,
  rank: keys[rank] ?? "",
  by: ADA,
  at: 1,
})
const summary = (
  n: number,
  writers: WriterId[],
  newest: string,
): RootSummary => ({
  root: E(n),
  first: E(n),
  messages: 1,
  newest: entryId(newest),
  writers,
})
// r1, r2 in Doing (r2 first); r3 in Backlog; r4, r5 in Done (r5 newer).
const input = (over: Partial<BoardViewInput> = {}): BoardViewInput => ({
  workflow: WORKFLOW,
  places: new Map(
    [
      place(1, DOING, 1),
      place(2, DOING, 0),
      place(3, BACKLOG),
      place(4, DONE),
      place(5, DONE, 1),
    ].map(p => [p.root, p]),
  ),
  rootEntries: new Map<RootId, EntryId>(
    [1, 2, 3, 4, 5].map(n => [ID(n), E(n)]),
  ),
  summaries: [
    summary(1, [ADA], "1"),
    summary(2, [BEA], "2"),
    summary(3, [ADA], "3"),
    summary(4, [ADA], "4"),
    summary(5, [BEA], "5"),
  ],
  labels: new Map([
    [E(4), "Old spike about SQLite"],
    [E(5), "Palette work"],
  ]),
  status: new Map(),
  cardRoots: new Set(),
  query: "",
  mine: false,
  me: ADA,
  work: new Map(),
  ...over,
})

describe("boardView", () => {
  test("each open state a column, in order, by rank; the closed state apart; the strip says each", () => {
    const view = boardView(input())
    expect(
      view.open.map(c => [c.state.name, c.items.map(t => t.entry)]),
    ).toEqual([
      ["Backlog", [E(3)]],
      ["Doing", [E(2), E(1)]],
    ])
    expect(view.closed.count).toBe(2)
    expect(view.strip.map(s => [s.name, s.count, s.closed])).toEqual([
      ["Backlog", 1, false],
      ["Doing", 2, false],
      ["Done", 2, true],
    ])
  })

  test("an item holds your card exactly when its root does; ＋ on a column lands in its state", () => {
    const view = boardView(input({ cardRoots: new Set([E(1)]) }))
    const doing = view.open[1]
    expect(doing?.items.map(t => t.card)).toEqual([false, true])
    expect(doing?.add.agent).toEqual({
      kind: "newTab",
      asksAgent: true,
      state: DOING,
    })
  })

  test("a column's mark and the strip's are its roots' highest; the closed state has none", () => {
    const item = {
      lane: laneNameForThread("a"),
      root: E(1),
      end: E(1),
      level: "needsYou" as const,
      raised: { kind: "offer" as const, source: "c" },
    }
    const status = new Map<EntryId, Status>([
      [E(1), { kind: "needsYou", item }],
      [E(3), { kind: "working" }],
      [E(4), { kind: "needsYou", item }],
    ])
    const view = boardView(input({ status }))
    expect(view.open.map(c => c.mark)).toEqual([null, "needsYou"])
    expect(view.strip.map(s => s.mark)).toEqual([null, "needsYou", null])
  })

  test("an item's ⋯ moves it to every other state; into the closed state, refused while its agent works", () => {
    const view = boardView(input({ work: new Map([[E(2), "running"]]) }))
    const [first] = view.open[1]?.items ?? []
    expect(first?.moves.map(m => [m.name, m.closes, m.busy])).toEqual([
      ["Backlog", false, null],
      ["Done", true, "running"],
    ])
    expect(first?.moves[1]?.intent).toEqual({
      kind: "moveRoot",
      root: ID(2),
      from: DOING,
      to: DONE,
      before: null,
      closes: true,
    })
  })

  test("an item moves up or down its state, by Move up and Move down; the ends offer neither", () => {
    const [first, second] = boardView(input()).open[1]?.items ?? []
    expect(first?.up).toBeNull()
    expect(first?.down).toEqual({
      kind: "moveRoot",
      root: ID(2),
      from: DOING,
      to: DOING,
      before: null,
      closes: false,
    })
    expect(second?.up).toEqual({
      kind: "moveRoot",
      root: ID(1),
      from: DOING,
      to: DOING,
      before: ID(2),
      closes: false,
    })
    expect(second?.down).toBeNull()
  })

  test("a column moves left or right one place; one holding a root, or the only open one, says why it cannot be removed", () => {
    const [backlog, doing] = boardView(input()).open
    expect(backlog?.left).toBeNull()
    expect(backlog?.right).toEqual({
      kind: "editWorkflow",
      edit: { action: "move", state: BACKLOG, name: "", before: null },
    })
    expect(doing?.left).toEqual({
      kind: "editWorkflow",
      edit: { action: "move", state: DOING, name: "", before: BACKLOG },
    })
    expect(doing?.right).toBeNull()
    expect(backlog?.remove.why).toBe("holds a root: move it first")
    expect(removeWords(0, 1)).toBe("the board needs one open state")
    expect(removeWords(0, 2)).toBeNull()
    expect(removeWords(3, 2)).toBe("holds 3 roots: move them first")
  })
})

describe("closedRows", () => {
  const rows = (over: Partial<BoardViewInput>) =>
    boardView(input(over)).closed.rows.map(t => t.entry)
  test("newest activity first", () => {
    expect(rows({})).toEqual([E(5), E(4)])
  })
  test("search is case-insensitive over each root's label, not its messages (ADR-0063)", () => {
    expect(rows({ query: "palette" })).toEqual([E(5)])
    expect(rows({ query: "SQLITE" })).toEqual([E(4)])
    expect(rows({ query: "nothing" })).toEqual([])
  })
  test("mine keeps the roots you wrote in", () => {
    expect(rows({ mine: true })).toEqual([E(4)])
    expect(rows({ mine: true, me: BEA })).toEqual([E(5)])
  })
  test("with no query, only the most recent few", () => {
    const item = (n: number) =>
      ({
        ...boardView(input()).closed.rows[0],
        entry: E(n),
        root: ID(n),
        label: `r${n}`,
        writers: [],
      }) as never
    const many = Array.from({ length: CLOSED_RECENT + 3 }, (_, n) => item(n))
    const summaries = new Map()
    expect(
      closedRows({ items: many, summaries, query: "", mine: false, me: ADA }),
    ).toHaveLength(CLOSED_RECENT)
    expect(
      closedRows({ items: many, summaries, query: "r", mine: false, me: ADA }),
    ).toHaveLength(CLOSED_RECENT + 3)
  })
})

test("nameStateIntent: a name for a state renames it; for none, adds one", () => {
  expect(nameStateIntent(DOING, "Now")).toEqual({
    kind: "editWorkflow",
    edit: { action: "rename", state: DOING, name: "Now", before: null },
  })
  expect(nameStateIntent(null, "Review")).toEqual({
    kind: "editWorkflow",
    edit: { action: "add", state: null, name: "Review", before: null },
  })
})
