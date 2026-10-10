import {
  entryId,
  taskIdFor,
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
const K1 = taskIdFor("01a0ffd2-0000-7000-8000-000000000001")
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
  stateOf: new Map([[K1, DOING]]),
  labels: new Map([[K1, "Tab names"]]),
  status: new Map(),
  pips: new Set([K1]),
  offered: new Map([[K1, ["amber-fox"]]]),
  work: new Map([[K1, "running"]]),
  ...over,
})

describe("threadCardHead (ADR-0111, ADR-0116)", () => {
  test("its label, ⇡, your pip, and Move to ▸ each other state; into the archive refused while the agent works, naming the offers it withdraws", () => {
    const head = threadCardHead(K1, facts())
    expect(head).toMatchObject({
      task: K1,
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
      kind: "moveTask",
      task: K1,
      from: DOING,
      to: DONE,
      before: null,
      closes: true,
    })
  })

  test("a task with no signals of its threads has none; one with no place, no moves", () => {
    expect(
      threadCardHead(
        K1,
        facts({ pips: new Set(), offered: new Map(), work: new Map() }),
      ),
    ).toMatchObject({ status: null, ready: [], pip: false })
    expect(threadCardHead(K1, facts({ stateOf: new Map() })).moves).toEqual([])
  })

  test("the board and the sidebar draw a task from the same header", () => {
    const heads = threadCardHeads([K1], facts())
    const layout = resolveLayout(
      layoutReducer(initialLayout(), {
        kind: "show",
        here: { kind: "task", task: K1 },
      }),
      {
        index: tree({ r1: null }),
        lanes: [],
        archived: new Set(),
        list: [K1],
        canvases: new Map(),
        unstarted: new Map(),
        holders: new Map(),
      },
    )
    const sidebar = sidebarView({
      layout,
      active: { kind: "task", task: K1 },
      heads,
      summaries: new Map(),
      marks: new Map(),
      archived: new Set(),
      arrivals: { arrived: new Map(), done: new Map() },
      sprites: new Map(),
    })
    const board = boardView({
      workflow: WORKFLOW,
      places: new Map(),
      summaries: new Map([[K1, { line: "", writers: [], newest: R1 }]]),
      heads,
      search: null,
      me: writerId("a@x.test"),
    })
    const item = sidebar.items[0]
    const card = board.open.flatMap(c => c.items)[0]
    expect(item?.kind === "task" ? item.head : null).toBe(heads.get(K1))
    expect(card?.head).toBe(heads.get(K1))
  })
})
