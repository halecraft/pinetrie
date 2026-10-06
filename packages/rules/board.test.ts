import {
  type BoardPlace,
  ERR,
  type RootId,
  rootIdFor,
  type Workflow,
  type WorkflowEdit,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  archivedOf,
  boardOf,
  defaultWorkflow,
  placeStarted,
  planRootMove,
  planWorkflowEdit,
  planWorkflowSeed,
  transitionOf,
  WORKFLOW as WORKFLOW_SPEC,
} from "./board.ts"
import { orderKey } from "./order.ts"
import { setRecord } from "./records.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const R = (n: number) =>
  rootIdFor(`01a0ffd2-0000-7000-8000-${String(n).padStart(12, "0")}`)
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
const place = (
  root: RootId,
  state: typeof DOING,
  rank: number,
  by = BEA,
  at = 1,
): BoardPlace => ({ root, state, rank: orderKey(rank), by, at })
const placesOf = (...ps: BoardPlace[]) => new Map(ps.map(p => [p.root, p]))
const columns = (board: ReturnType<typeof boardOf>) =>
  Object.fromEntries(
    [...board.open, board.closed].map(c => [c.state.name, c.roots]),
  )

describe("boardOf", () => {
  test("by rank, then id; a root with no place, or in a state gone, at the end of the first open state", () => {
    const places = placesOf(
      place(R(1), DOING, 20),
      place(R(2), DOING, 10),
      place(R(3), DONE, 5),
      place(R(4), workflowStateIdFor("gone"), 1),
      place(R(6), BACKLOG, 3),
    )
    expect(
      columns(boardOf(WORKFLOW, places, [R(1), R(2), R(3), R(4), R(5), R(6)])),
    ).toEqual({
      Backlog: [R(6), R(4), R(5)],
      Doing: [R(2), R(1)],
      Done: [R(3)],
    })
  })
  test("a place for a root the board is not given shows nowhere", () => {
    expect(
      columns(boardOf(WORKFLOW, placesOf(place(R(1), DOING, 1)), [])),
    ).toEqual({ Backlog: [], Doing: [], Done: [] })
  })
})

test("archivedOf: only the closed state's roots, with who closed them and when", () => {
  expect(
    archivedOf(
      WORKFLOW,
      placesOf(place(R(1), DOING, 1), place(R(2), DONE, 1, ADA, 7)),
    ),
  ).toEqual(new Map([[R(2), { root: R(2), by: ADA, at: 7 }]]))
})

test.each([
  [BACKLOG, DOING, "within"],
  [DOING, DONE, "close"],
  [DONE, BACKLOG, "reopen"],
  [DONE, DONE, "within"],
] as const)("transitionOf %s to %s: %s", (from, to, want) => {
  expect(transitionOf(WORKFLOW, from, to)).toBe(want)
})

describe("planRootMove", () => {
  const roots = [R(1), R(2), R(3)]
  const places = placesOf(
    place(R(1), DOING, 10),
    place(R(2), DOING, 20),
    place(R(3), DONE, 5, ADA, 3),
  )
  const move = (over: Partial<Parameters<typeof planRootMove>[0]>) =>
    planRootMove({
      root: R(1),
      from: DOING,
      to: BACKLOG,
      before: null,
      by: ADA,
      now: 9,
      workflow: WORKFLOW,
      places,
      roots,
      names: new Map([[BEA, "Bea"]]),
      ...over,
    })

  test("to another open state: its place, by the mover, now", () => {
    expect(move({})).toMatchObject({
      kind: "write",
      transition: "within",
      places: [{ root: R(1), state: BACKLOG, by: ADA, at: 9 }],
    })
  })
  test("before a root: between its neighbours", () => {
    const plan = move({ root: R(2), to: DOING, before: R(1) })
    expect(plan.kind).toBe("write")
    if (plan.kind !== "write") return
    expect(plan.places).toHaveLength(1)
    expect((plan.places[0]?.rank ?? "") < orderKey(10)).toBe(true)
  })
  test("into the closed state closes it, and out of it reopens it", () => {
    expect(move({ to: DONE })).toMatchObject({ transition: "close" })
    expect(move({ root: R(3), from: DONE, to: DOING })).toMatchObject({
      transition: "reopen",
      places: [{ root: R(3), by: ADA, at: 9 }],
    })
  })
  test("a reorder within the closed state keeps who closed it and when", () => {
    const closed = placesOf(...places.values(), place(R(2), DONE, 9, BEA, 4))
    expect(
      move({ root: R(3), from: DONE, to: DONE, before: null, places: closed }),
    ).toMatchObject({ places: [{ root: R(3), by: ADA, at: 3 }] })
  })
  test("moved first: refused, naming who moved it and where", () => {
    expect(move({ from: BACKLOG })).toEqual({
      kind: "refused",
      code: ERR.ROOT_MOVED,
      message: "not moved: Bea moved it to Doing first",
    })
  })
  test("an unknown state, or a root the board lacks, is refused", () => {
    expect(move({ to: workflowStateIdFor("gone") })).toMatchObject({
      code: ERR.UNKNOWN_STATE,
    })
    expect(move({ root: R(9) })).toMatchObject({ code: ERR.UNKNOWN_TARGET })
  })
  test("where it already is: unchanged", () => {
    expect(move({ to: DOING, before: R(2) })).toEqual({ kind: "unchanged" })
    expect(move({ root: R(2), to: DOING })).toEqual({ kind: "unchanged" })
  })
  test("no room between its neighbours: the state renumbered, the others keeping who put them there", () => {
    const tight = placesOf(
      place(R(1), DOING, 10),
      place(R(2), DOING, 11),
      place(R(3), BACKLOG, 1),
    )
    const plan = move({
      root: R(3),
      from: BACKLOG,
      to: DOING,
      before: R(2),
      places: tight,
    })
    expect(plan.kind).toBe("write")
    if (plan.kind !== "write") return
    expect(plan.places.map(p => p.root)).toEqual([R(1), R(3), R(2)])
    expect(plan.places.map(p => p.rank)).toEqual(
      plan.places.map(p => p.rank).toSorted(),
    )
    expect(plan.places[2]).toMatchObject({ by: BEA, at: 1 })
  })
})

describe("planWorkflowEdit", () => {
  const board = boardOf(WORKFLOW, placesOf(place(R(1), DOING, 1)), [R(1)])
  const edit = (e: Partial<WorkflowEdit>) =>
    planWorkflowEdit(
      WORKFLOW,
      board,
      { action: "add", state: null, name: "", before: null, ...e },
      () => "new",
    )
  const names = (plan: ReturnType<typeof edit>) =>
    plan.kind === "write"
      ? [...plan.workflow.open.map(s => s.name), plan.workflow.closed.name]
      : plan.kind
  test.each([
    [
      "add, at the end",
      { name: " Review " },
      ["Backlog", "Doing", "Review", "Done"],
    ],
    [
      "add, before a state",
      { name: "Ideas", before: BACKLOG },
      ["Ideas", "Backlog", "Doing", "Done"],
    ],
    [
      "rename",
      { action: "rename", state: DOING, name: "Now" },
      ["Backlog", "Now", "Done"],
    ],
    [
      "rename the closed state",
      { action: "rename", state: DONE, name: "Shipped" },
      ["Backlog", "Doing", "Shipped"],
    ],
    [
      "move",
      { action: "move", state: DOING, before: BACKLOG },
      ["Doing", "Backlog", "Done"],
    ],
    [
      "remove an empty state",
      { action: "remove", state: BACKLOG },
      ["Doing", "Done"],
    ],
    [
      "rename to its own name",
      { action: "rename", state: DOING, name: "Doing" },
      "unchanged",
    ],
  ] as const)("%s", (_, e, want) => {
    expect(names(edit(e as Partial<WorkflowEdit>))).toEqual(want)
  })
  test.each([
    ["an empty name", { name: "  " }, ERR.EMPTY_NAME],
    [
      "an unknown state",
      { action: "rename", state: workflowStateIdFor("gone"), name: "x" },
      ERR.UNKNOWN_STATE,
    ],
    [
      "moving the closed state",
      { action: "move", state: DONE },
      ERR.STATE_CLOSED,
    ],
    [
      "removing the closed state",
      { action: "remove", state: DONE },
      ERR.STATE_CLOSED,
    ],
    [
      "removing a state that holds a root",
      { action: "remove", state: DOING },
      ERR.STATE_NOT_EMPTY,
    ],
  ] as const)("refuses %s", (_, e, code) => {
    expect(edit(e as Partial<WorkflowEdit>)).toMatchObject({
      kind: "refused",
      code,
    })
  })
  test("refuses removing the only open state", () => {
    const one: Workflow = {
      open: [WORKFLOW.open[0] ?? { id: BACKLOG, name: "" }],
      closed: WORKFLOW.closed,
    }
    expect(
      planWorkflowEdit(
        one,
        boardOf(one, new Map(), []),
        { action: "remove", state: BACKLOG, name: "", before: null },
        () => "x",
      ),
    ).toMatchObject({ code: ERR.LAST_STATE })
  })
})

describe("placeStarted", () => {
  const places = placesOf(place(R(1), DOING, 10))
  const start = (state: typeof DOING | null) =>
    placeStarted({
      root: R(2),
      state,
      by: ADA,
      now: 4,
      workflow: WORKFLOW,
      places,
    })
  test("at the end of the state it names", () => {
    const p = start(DOING)
    expect(p).toMatchObject({ state: DOING, by: ADA, at: 4 })
    expect(p.rank > orderKey(10)).toBe(true)
  })
  test("in the first open state when it names none, one gone, or the closed one", () => {
    for (const s of [null, workflowStateIdFor("gone"), DONE])
      expect(start(s).state).toBe(BACKLOG)
  })
})

test("defaultWorkflow: Backlog and Doing, then Done, closed", () => {
  let n = 0
  const w = defaultWorkflow(() => `${n++}`)
  expect(w.open.map(s => s.name)).toEqual(["Backlog", "Doing"])
  expect(w.closed.name).toBe("Done")
  expect(new Set([...w.open.map(s => s.id), w.closed.id]).size).toBe(3)
})

test("planWorkflowSeed: a store with no workflow gets the default one, and one with a workflow nothing", () => {
  let n = 0
  const newId = () => `${n++}`
  const seed = planWorkflowSeed(null, newId)
  n = 0
  expect(seed).toEqual([setRecord(WORKFLOW_SPEC, defaultWorkflow(newId))])
  expect(planWorkflowSeed(defaultWorkflow(newId), newId)).toEqual([])
})
