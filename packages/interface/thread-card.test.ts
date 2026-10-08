import {
  type EntryId,
  entryId,
  type RootId,
  rootIdFor,
  type Workflow,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { boardView } from "./board-view.ts"
import { tree } from "./fixtures.ts"
import { initialLayout, layoutReducer, resolveLayout } from "./layout.ts"
import { sidebarView } from "./sidebar-view.ts"
import {
  type ThreadCardFacts,
  threadCardHead,
  threadCardHeads,
} from "./thread-card.ts"

const R1 = entryId("r1")
const ID1 = rootIdFor("01a0ffd2-0000-7000-8000-000000000001")
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
  archive: { id: DONE, name: "Done" },
}
const facts = (over: Partial<ThreadCardFacts> = {}): ThreadCardFacts => ({
  workflow: WORKFLOW,
  rootIds: new Map([[R1, ID1]]),
  stateOf: new Map([[R1, DOING]]),
  labels: new Map([[R1, "Tab names"]]),
  status: new Map(),
  pips: new Set([R1]),
  offered: new Map([[R1, ["amber-fox"]]]),
  work: new Map([[R1, "running"]]),
  ...over,
})

describe("threadCardHead (ADR-0111)", () => {
  test("its label, ⇡, your pip, and Move to ▸ each other state; into the archive refused while the agent works, naming the offers it withdraws", () => {
    const head = threadCardHead(R1, facts())
    expect(head).toMatchObject({
      root: ID1,
      entry: R1,
      label: "Tab names",
      status: null,
      ready: ["amber-fox"],
      pip: true,
      state: DOING,
    })
    expect(head.moves.map(m => [m.name, m.closes, m.busy, m.drops])).toEqual([
      ["Backlog", false, null, []],
      ["Done", true, "running", ["amber-fox"]],
    ])
    expect(head.moves[1]?.intent).toEqual({
      kind: "moveRoot",
      root: ID1,
      from: DOING,
      to: DONE,
      before: null,
      closes: true,
    })
  })

  test("a root with no id yet, or no place: its signals, and no moves", () => {
    expect(threadCardHead(R1, facts({ rootIds: new Map() }))).toMatchObject({
      root: null,
      moves: [],
    })
    expect(threadCardHead(R1, facts({ stateOf: new Map() })).moves).toEqual([])
  })

  test("the board and the sidebar draw a root from the same header", () => {
    const heads = threadCardHeads([R1], facts())
    const layout = resolveLayout(
      layoutReducer(initialLayout(), {
        kind: "show",
        here: { kind: "root", root: R1 },
      }),
      { index: tree({ r1: null }), lanes: [], archived: new Set(), list: [R1] },
    )
    const sidebar = sidebarView({
      layout,
      active: { kind: "root", root: R1 },
      heads,
      lines: new Map(),
      marks: new Map(),
      archived: new Set(),
      unsent: {
        roots: new Set(),
        newTabs: new Set(),
        ends: new Set(),
        elsewhere: false,
      },
      arrivals: { arrived: new Map(), done: new Map() },
      sprites: new Map(),
    })
    const board = boardView({
      workflow: WORKFLOW,
      places: new Map(),
      rootEntries: new Map<RootId, EntryId>([[ID1, R1]]),
      summaries: [],
      heads,
      lines: new Map(),
      search: null,
      me: writerId("a@x.test"),
    })
    const item = sidebar.items[0]
    const card = board.open.flatMap(c => c.items)[0]
    expect(item?.kind === "root" ? item.head : null).toBe(heads.get(R1))
    expect(card?.head).toBe(heads.get(R1))
  })
})
