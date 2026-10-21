import {
  type CanvasId,
  canvasIdFor,
  ERR,
  threadIdFor,
  type WorkflowStateId,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import {
  type CanvasCard,
  type CardId,
  type CardRecord,
  cardIdOfKind,
  livePlace,
  makeCard,
  UNTICKED,
  type WorkflowEdit,
} from "@pinetrie/threads"
import { canvasCard } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import {
  boardCanvases,
  boardEnd,
  canvasRole,
  checkedWorkflow,
  defaultWorkflow,
  planBoardMove,
  planMoveToActive,
  planWorkflowChange,
  planWorkflowEdit,
  planWorkflowSeed,
  stateTransition,
  taskBoard,
  tasksInArchive,
  WORKFLOW as WORKFLOW_SPEC,
  type Workflow,
} from "./board.ts"
import type { CardHistoryRecord } from "./card-history.ts"
import { testWorkflow } from "./fixtures.ts"
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
const WORKFLOW: Workflow = testWorkflow(
  [
    { id: BACKLOG, name: "Backlog" },
    { id: DOING, name: "Doing" },
  ],
  { id: DONE, name: "Done" },
)
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
  test("each canvas's card by rank, then id; one in a state gone at the end of Topics", () => {
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
  test("a card in a state gone, drawn in Topics, is moved there, its state written and its flag kept", () => {
    const stale = [card(R(1), workflowStateIdFor("gone"), 1)]
    const plan = move({ from: BACKLOG, to: BACKLOG, cards: stale })
    expect(plan.kind).toBe("move")
    expect(written(plan)).toMatchObject([
      {
        place: { kind: "board", state: BACKLOG },
        content: { stateChanged: false },
      },
    ])
  })
  test("a move between states sets its stateChanged; a reorder does not", () => {
    expect(written(move({}))[0]?.content).toEqual({ stateChanged: true })
    expect(
      written(move({ canvas: R(2), to: DOING, before: R(1) }))[0]?.content,
    ).toEqual({ stateChanged: false })
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
  test("a new canvas with no state goes to the end of Topics, wherever it stands", () => {
    const later = testWorkflow(
      [
        { id: BACKLOG, name: "Backlog" },
        { id: DOING, name: "Doing", mark: "topics" },
      ],
      { id: DONE, name: "Done" },
    )
    for (const s of [null, workflowStateIdFor("gone"), DONE]) {
      expect(boardEnd(WORKFLOW, cards, s).state).toBe(BACKLOG)
      expect(boardEnd(later, cards, s)).toMatchObject({ state: DOING })
    }
    expect(boardEnd(later, cards, null).order > orderKey(10)).toBe(true)
  })
})

describe("planWorkflowEdit", () => {
  const LATER = workflowStateIdFor("l")
  const w = testWorkflow(
    [
      { id: BACKLOG, name: "Backlog", mark: "topics" },
      { id: DOING, name: "Doing", mark: "active" },
      { id: LATER, name: "Later" },
    ],
    { id: DONE, name: "Done" },
  )
  const board = taskBoard(w, [card(R(1), DOING, 1)])
  const edit = (e: WorkflowEdit, on = board) =>
    planWorkflowEdit(w, on, e, () => "new")
  /** Each state's name, with its mark after a colon. */
  const names = (plan: ReturnType<typeof edit>) =>
    plan.kind === "write"
      ? [
          ...plan.workflow.open.map(s =>
            s.mark === null ? s.name : `${s.name}:${s.mark}`,
          ),
          plan.workflow.archive.name,
        ]
      : plan.kind
  test.each([
    [
      "add, at the end",
      { action: "add", name: " Review ", before: null },
      ["Backlog:topics", "Doing:active", "Later", "Review", "Done"],
    ],
    [
      "add, before a state",
      { action: "add", name: "Ideas", before: BACKLOG },
      ["Ideas", "Backlog:topics", "Doing:active", "Later", "Done"],
    ],
    [
      "rename",
      { action: "rename", state: DOING, name: "Now" },
      ["Backlog:topics", "Now:active", "Later", "Done"],
    ],
    [
      "rename the archive",
      { action: "rename", state: DONE, name: "Shipped" },
      ["Backlog:topics", "Doing:active", "Later", "Shipped"],
    ],
    [
      "move, its mark with it",
      { action: "move", state: DOING, before: BACKLOG },
      ["Doing:active", "Backlog:topics", "Later", "Done"],
    ],
    [
      "remove an empty state",
      { action: "remove", state: LATER },
      ["Backlog:topics", "Doing:active", "Done"],
    ],
    [
      "rename to its own name",
      { action: "rename", state: DOING, name: "Doing" },
      "unchanged",
    ],
    [
      "mark Topics where it is",
      { action: "mark", state: BACKLOG, mark: "topics" },
      "unchanged",
    ],
    [
      "unmark Active",
      { action: "unmark-active" },
      ["Backlog:topics", "Doing", "Later", "Done"],
    ],
  ] as const)("%s", (_, e, want) => {
    expect(names(edit(e))).toEqual(want)
  })
  test("a mark moves from the state that held it", () => {
    expect(
      names(edit({ action: "mark", state: LATER, mark: "topics" })),
    ).toEqual(["Backlog", "Doing:active", "Later:topics", "Done"])
    expect(
      names(edit({ action: "mark", state: LATER, mark: "active" })),
    ).toEqual(["Backlog:topics", "Doing", "Later:active", "Done"])
  })
  test.each([
    [
      "an empty name",
      { action: "add", name: "  ", before: null },
      ERR.EMPTY_NAME,
    ],
    [
      "an unknown state",
      { action: "rename", state: workflowStateIdFor("gone"), name: "x" },
      ERR.UNKNOWN_STATE,
    ],
    [
      "moving the archive",
      { action: "move", state: DONE, before: null },
      ERR.STATE_ARCHIVE,
    ],
    [
      "removing the archive",
      { action: "remove", state: DONE },
      ERR.STATE_ARCHIVE,
    ],
    [
      "marking the archive",
      { action: "mark", state: DONE, mark: "active" },
      ERR.STATE_ARCHIVE,
    ],
    [
      "removing a state that holds a canvas",
      { action: "remove", state: DOING },
      ERR.STATE_NOT_EMPTY,
    ],
  ] as const)("refuses %s", (_, e, code) => {
    expect(edit(e)).toMatchObject({ kind: "refused", code })
  })
  test("the Topics state is not removed", () => {
    for (const cards of [[], [card(R(2), BACKLOG, 1)]])
      expect(
        edit({ action: "remove", state: BACKLOG }, taskBoard(w, cards)),
      ).toMatchObject({ kind: "refused", code: ERR.STATE_MARKED })
  })
  test("a mark is refused on the state holding the other mark", () => {
    expect(
      edit({ action: "mark", state: DOING, mark: "topics" }),
    ).toMatchObject({ kind: "refused", code: ERR.STATE_MARKED })
    expect(
      edit({ action: "mark", state: BACKLOG, mark: "active" }),
    ).toMatchObject({ kind: "refused", code: ERR.STATE_MARKED })
  })
  test("removing the empty Active state unmarks it", () => {
    const plan = edit({ action: "remove", state: DOING }, taskBoard(w, []))
    expect(names(plan)).toEqual(["Backlog:topics", "Later", "Done"])
    expect(plan.kind === "write" && plan.workflow.active).toBe(null)
  })
})

test("a new session marks Topics and Active", () => {
  let n = 0
  const w = defaultWorkflow(() => `${n++}`)
  expect(w.open.map(s => [s.name, s.mark])).toEqual([
    ["Topics", "topics"],
    ["Active", "active"],
  ])
  expect(w.archive.name).toBe("Archive")
  expect([w.topics.name, w.active?.name]).toEqual(["Topics", "Active"])
  expect(new Set([...w.open.map(s => s.id), w.archive.id]).size).toBe(3)
})

describe("checkedWorkflow", () => {
  const archive = { id: DONE, name: "Done" }
  const state = (id: WorkflowStateId, mark: "topics" | "active" | null) => ({
    id,
    name: id,
    mark,
  })
  test("a workflow without exactly one Topics is not made", () => {
    for (const open of [
      [state(BACKLOG, null), state(DOING, "active")],
      [state(BACKLOG, "topics"), state(DOING, "topics")],
      [
        state(BACKLOG, "topics"),
        state(DOING, "active"),
        state(R(1) as unknown as WorkflowStateId, "active"),
      ],
      [state(BACKLOG, "topics"), state(DONE, null)],
    ])
      expect(checkedWorkflow(open, archive)).toBeUndefined()
    const made = checkedWorkflow(
      [state(BACKLOG, null), state(DOING, "topics")],
      archive,
    )
    expect(made?.topics).toBe(made?.open[1])
    expect(made?.active).toBe(null)
  })
  test("a stored workflow with no Topics does not decode", () => {
    expect(
      WORKFLOW_SPEC.decode(
        { open: [{ id: BACKLOG, name: "Backlog" }], archive },
        "workflow",
      ),
    ).toBeUndefined()
    expect(
      WORKFLOW_SPEC.decode(WORKFLOW_SPEC.encode(WORKFLOW), "workflow"),
    ).toEqual(WORKFLOW)
  })
})

describe("canvasRole", () => {
  test("a canvas in the state marked Topics is a topic, wherever it stands", () => {
    const review = workflowStateIdFor("r")
    const w = testWorkflow(
      [
        { id: BACKLOG, name: "Backlog" },
        { id: DOING, name: "Doing", mark: "topics" },
        { id: review, name: "Review" },
      ],
      { id: DONE, name: "Done" },
    )
    expect([BACKLOG, DOING, review, DONE].map(s => canvasRole(w, s))).toEqual([
      "task",
      "topic",
      "task",
      "archived",
    ])
  })

  test("a state the workflow lacks reads as Topics: a topic", () => {
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

describe("planWorkflowChange", () => {
  test("refused before the host wrote a workflow; an edit is the workflow's write", () => {
    const edit = { action: "rename", state: BACKLOG, name: "Ideas" } as const
    expect(
      planWorkflowChange({ workflow: null, cards: [], edit, newId: () => "x" }),
    ).toMatchObject({ code: ERR.UNKNOWN_STATE })
    const planned = planWorkflowChange({
      workflow: WORKFLOW,
      cards: [],
      edit,
      newId: () => "x",
    })
    expect(planned).toEqual({
      kind: "write",
      writes: [
        setRecord(
          WORKFLOW_SPEC,
          testWorkflow(
            WORKFLOW.open.map(s =>
              s.id === BACKLOG ? { ...s, name: "Ideas" } : s,
            ),
            WORKFLOW.archive,
          ),
        ),
      ],
    })
  })
})

describe("planMoveToActive", () => {
  const THREAD = threadIdFor("0123456789abcdef")
  const onCanvas = (canvas: CanvasId): CardRecord =>
    makeCard(
      "thread",
      THREAD,
      { kind: "canvas", canvas, order: "a", width: 1 },
      UNTICKED,
      ADA,
    )
  const plan = (cards: readonly CardRecord[], workflow: Workflow = WORKFLOW) =>
    planMoveToActive({ workflow, cards, thread: THREAD })
  test("an agent's run moves a topic whose state never changed to the end of Active, its placer kept", () => {
    const steps = plan([
      card(R(1), BACKLOG, 5),
      card(R(2), DOING, 10),
      onCanvas(R(1)),
    ])
    const [moved] = steps.flatMap(s => (s.kind === "write" ? [s.record] : []))
    expect(moved).toMatchObject({
      id: R(1),
      placer: BEA,
      place: { kind: "board", state: DOING },
      content: { stateChanged: true },
    })
    expect(
      moved?.place.kind === "board" && moved.place.order > orderKey(10),
    ).toBe(true)
  })
  test("an agent's run moves no canvas whose state has changed", () => {
    const changed: CanvasCard = {
      ...card(R(1), BACKLOG, 5),
      content: { stateChanged: true },
    }
    expect(plan([changed, onCanvas(R(1))])).toEqual([])
  })
  test("an agent's run moves no canvas outside Topics", () => {
    const later = workflowStateIdFor("l")
    const three = testWorkflow(
      [
        { id: BACKLOG, name: "Backlog" },
        { id: DOING, name: "Doing" },
        { id: later, name: "Later" },
      ],
      { id: DONE, name: "Done" },
    )
    for (const state of [DOING, later])
      expect(plan([card(R(1), state, 5), onCanvas(R(1))], three)).toEqual([])
  })
  test("an agent's run moves nothing with Active unmarked", () => {
    const unmarked = testWorkflow(
      [
        { id: BACKLOG, name: "Backlog", mark: "topics" },
        { id: DOING, name: "Doing" },
      ],
      { id: DONE, name: "Done" },
    )
    expect(plan([card(R(1), BACKLOG, 5), onCanvas(R(1))], unmarked)).toEqual([])
  })
  test("an agent's run moves nothing for a thread in an inventory", () => {
    const held = makeCard(
      "thread",
      THREAD,
      { kind: "inventory", holder: ADA },
      UNTICKED,
      ADA,
    )
    expect(plan([card(R(1), BACKLOG, 5), held])).toEqual([])
  })
})
