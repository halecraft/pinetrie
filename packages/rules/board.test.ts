import {
  type CanvasCard,
  type CanvasId,
  type CardId,
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  ERR,
  livePlace,
  type WorkflowEdit,
  type WorkflowStateId,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { canvasCard } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  boardCanvases,
  boardEnd,
  canvasRole,
  defaultWorkflow,
  planBoardMove,
  planWorkflowEdit,
  planWorkflowSeed,
  stateTransition,
  taskBoard,
  tasksInArchive,
  WORKFLOW as WORKFLOW_SPEC,
  type Workflow,
} from "./board.ts"
import type { CardHistoryRecord } from "./card-history.ts"
import { orderKey } from "./order.ts"
import { setRecord } from "./records.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const R = (n: number) =>
  canvasIdFor(`01a0ffd2-0000-7000-8000-${String(n).padStart(12, "0")}`)
const [BACKLOG, DOING, DONE] = ["b", "d", "x"].map(workflowStateIdFor) as [
  WorkflowStateId,
  WorkflowStateId,
  WorkflowStateId,
]
const WORKFLOW: Workflow = {
  open: [
    { id: BACKLOG, name: "Backlog" },
    { id: DOING, name: "Doing" },
  ],
  archive: { id: DONE, name: "Done" },
}
/** A canvas's card in `state` at rank `rank`, placed by `by`. */
const card = (
  canvas: CanvasId,
  state: WorkflowStateId,
  rank: number,
  by = BEA,
): CanvasCard => ({
  ...canvasCard(canvas, orderKey(rank), state, ADA),
  placer: by,
})
const columns = (board: ReturnType<typeof taskBoard>) =>
  Object.fromEntries(
    [...board.open, board.archive].map(c => [c.state.name, c.canvases]),
  )

describe("taskBoard", () => {
  test("each canvas's card by rank, then id; one in a state gone at the end of the first open state", () => {
    const cards = [
      card(R(1), DOING, 20),
      card(R(2), DOING, 10),
      card(R(3), DONE, 5),
      card(R(4), workflowStateIdFor("gone"), 1),
      card(R(6), BACKLOG, 3),
    ]
    expect(columns(taskBoard(WORKFLOW, cards))).toEqual({
      Backlog: [R(6), R(4)],
      Doing: [R(2), R(1)],
      Done: [R(3)],
    })
  })
  test("a canvas's card in a trash is on no board, and no canvas the session holds", () => {
    const onBoard = card(R(1), DOING, 1)
    const trashed: CardRecord = {
      ...onBoard,
      place: { kind: "trash", left: livePlace(onBoard.place) },
      placer: ADA,
    }
    expect(columns(taskBoard(WORKFLOW, [trashed]))).toEqual({
      Backlog: [],
      Doing: [],
      Done: [],
    })
    expect(boardCanvases([trashed, card(R(2), DOING, 1)])).toEqual(
      new Set([R(2)]),
    )
  })
})

describe("tasksInArchive", () => {
  const history = (
    canvas: CanvasId,
    ...events: [WorkflowStateId, typeof ADA, number][]
  ): [CardId, CardHistoryRecord] => [
    canvas,
    {
      card: canvas,
      events: events.map(([state, by, at]) => ({
        kind: "moved" as const,
        by,
        from: { kind: "board" as const, state: BACKLOG },
        to: { kind: "board" as const, state },
        at,
      })),
    },
  ]
  test("only the archive's canvases, with who moved each there and when, from its card's newest event into it", () => {
    expect(
      tasksInArchive(
        WORKFLOW,
        [card(R(1), DOING, 1), card(R(2), DONE, 1)],
        new Map([
          history(R(1), [DOING, ADA, 2]),
          history(R(2), [DONE, BEA, 3], [DOING, BEA, 4], [DONE, ADA, 7]),
        ]),
      ),
    ).toEqual(new Map([[R(2), { canvas: R(2), by: ADA, at: 7 }]]))
  })
  test("a card with no such event: its placer, at 0", () => {
    expect(tasksInArchive(WORKFLOW, [card(R(2), DONE, 1)], new Map())).toEqual(
      new Map([[R(2), { canvas: R(2), by: BEA, at: 0 }]]),
    )
  })
})

test.each([
  [BACKLOG, DOING, "within"],
  [DOING, DONE, "archive"],
  [DONE, BACKLOG, "restore"],
  [DONE, DONE, "within"],
] as const)("stateTransition %s to %s: %s", (from, to, want) => {
  expect(stateTransition(WORKFLOW, from, to)).toBe(want)
})

describe("planBoardMove", () => {
  const cards = [
    card(R(1), DOING, 10),
    card(R(2), DOING, 20),
    card(R(3), DONE, 5),
  ]
  const move = (over: Partial<Parameters<typeof planBoardMove>[0]>) =>
    planBoardMove({
      canvas: R(1),
      from: DOING,
      to: BACKLOG,
      before: null,
      sender: ADA,
      workflow: WORKFLOW,
      cards,
      ...over,
    })
  const written = (plan: ReturnType<typeof move>) =>
    plan.kind === "move" || plan.kind === "reorder"
      ? plan.steps.flatMap(s => (s.kind === "write" ? [s.record] : []))
      : []

  test("to another state: a move of its card, its sender its placer", () => {
    const plan = move({})
    expect(plan).toMatchObject({ kind: "move", transition: "within" })
    expect(written(plan)).toMatchObject([
      { id: R(1), placer: ADA, place: { kind: "board", state: BACKLOG } },
    ])
  })
  test("within its state: a reorder, between its neighbours, its placer kept", () => {
    const plan = move({ canvas: R(2), to: DOING, before: R(1) })
    expect(plan.kind).toBe("reorder")
    const [moved] = written(plan)
    expect(moved).toMatchObject({ id: R(2), placer: BEA })
    expect(
      moved?.place.kind === "board" && moved.place.order < orderKey(10),
    ).toBe(true)
  })
  test("into the archive archives it, and out of it restores it", () => {
    expect(move({ to: DONE })).toMatchObject({ transition: "archive" })
    expect(move({ canvas: R(3), from: DONE, to: DOING })).toMatchObject({
      kind: "move",
      transition: "restore",
    })
  })
  test("moved first: refused `moved`, the card as it is saying who put it where", () => {
    expect(move({ from: BACKLOG })).toEqual({
      kind: "refused",
      code: "moved",
      now: cards[0],
    })
  })
  test("a state the workflow lacks is refused `no-place`; a canvas with no card on the board `gone`", () => {
    expect(move({ to: workflowStateIdFor("gone") })).toMatchObject({
      code: "no-place",
    })
    expect(move({ canvas: R(9) })).toMatchObject({ code: "gone", now: null })
    const note = cardIdOfKind(
      "note-column",
      "01a0ffd2-0000-7000-8000-000000000099",
    )
    expect(move({ canvas: note as unknown as CanvasId }).kind).toBe("refused")
  })
  test("where it already is: unchanged", () => {
    expect(move({ to: DOING, before: R(2) })).toEqual({ kind: "unchanged" })
    expect(move({ canvas: R(2), to: DOING })).toEqual({ kind: "unchanged" })
  })
  test("a card in a state gone, drawn in the first open state, is moved there, its state written", () => {
    const stale = [card(R(1), workflowStateIdFor("gone"), 1)]
    const plan = move({ from: BACKLOG, to: BACKLOG, cards: stale })
    expect(plan.kind).toBe("move")
    expect(written(plan)).toMatchObject([
      { place: { kind: "board", state: BACKLOG } },
    ])
  })
  test("no room between its neighbours: the fewest renumbered, each keeping who put it there", () => {
    const tight = [
      card(R(1), DOING, 10),
      card(R(2), DOING, 11),
      card(R(3), BACKLOG, 1),
    ]
    const plan = move({
      canvas: R(3),
      from: BACKLOG,
      to: DOING,
      before: R(2),
      cards: tight,
    })
    const records = written(plan)
    expect(records[0]).toMatchObject({ id: R(3), placer: ADA })
    expect(records.slice(1).every(c => c.placer === BEA)).toBe(true)
    const after = taskBoard(WORKFLOW, [
      ...tight.filter(c => !records.some(r => r.id === c.id)),
      ...records,
    ])
    expect(after.open[1]?.canvases).toEqual([R(1), R(3), R(2)])
  })
})

describe("boardEnd", () => {
  const cards = [card(R(1), DOING, 10)]
  test("at the end of the state it names", () => {
    const p = boardEnd(WORKFLOW, cards, DOING)
    expect(p.state).toBe(DOING)
    expect(p.order > orderKey(10)).toBe(true)
  })
  test("in the first open state when it names none, one gone, or the archive", () => {
    for (const s of [null, workflowStateIdFor("gone"), DONE])
      expect(boardEnd(WORKFLOW, cards, s).state).toBe(BACKLOG)
  })
})

describe("planWorkflowEdit", () => {
  const board = taskBoard(WORKFLOW, [card(R(1), DOING, 1)])
  const edit = (e: Partial<WorkflowEdit>) =>
    planWorkflowEdit(
      WORKFLOW,
      board,
      { action: "add", state: null, name: "", before: null, ...e },
      () => "new",
    )
  const names = (plan: ReturnType<typeof edit>) =>
    plan.kind === "write"
      ? [...plan.workflow.open.map(s => s.name), plan.workflow.archive.name]
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
      "rename the archive",
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
    ["moving the archive", { action: "move", state: DONE }, ERR.STATE_ARCHIVE],
    [
      "removing the archive",
      { action: "remove", state: DONE },
      ERR.STATE_ARCHIVE,
    ],
    [
      "removing a state that holds a canvas",
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
      archive: WORKFLOW.archive,
    }
    expect(
      planWorkflowEdit(
        one,
        taskBoard(one, []),
        { action: "remove", state: BACKLOG, name: "", before: null },
        () => "x",
      ),
    ).toMatchObject({ code: ERR.LAST_STATE })
  })
})

test("a new session's states are Topics, Active and Archive", () => {
  let n = 0
  const w = defaultWorkflow(() => `${n++}`)
  expect(w.open.map(s => s.name)).toEqual(["Topics", "Active"])
  expect(w.archive.name).toBe("Archive")
  expect(new Set([...w.open.map(s => s.id), w.archive.id]).size).toBe(3)
})

describe("canvasRole", () => {
  test("the first open state's canvases are topics, a later state's tasks, the archive's archived", () => {
    const review = workflowStateIdFor("r")
    const w = {
      ...WORKFLOW,
      open: [...WORKFLOW.open, { id: review, name: "Review" }],
    }
    expect([BACKLOG, DOING, review, DONE].map(s => canvasRole(w, s))).toEqual([
      "topic",
      "task",
      "task",
      "archived",
    ])
  })

  test("a state the workflow lacks reads as the first: a topic", () => {
    expect(canvasRole(WORKFLOW, workflowStateIdFor("gone"))).toBe("topic")
  })
})

test("planWorkflowSeed: a store with no workflow gets the default one, and one with a workflow nothing", () => {
  let n = 0
  const newId = () => `${n++}`
  const seed = planWorkflowSeed(null, newId)
  n = 0
  expect(seed).toEqual([setRecord(WORKFLOW_SPEC, defaultWorkflow(newId))])
  expect(planWorkflowSeed(defaultWorkflow(newId), newId)).toEqual([])
})
