import {
  ERR,
  entryId,
  runId,
  threadIdFor,
  type Workflow,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { readPlaces } from "@pinetrie/reads"
import { pendingVerdict, setRecord, VERDICT, WORKFLOW } from "@pinetrie/rules"
import { beginRun, writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import {
  basics,
  CANVAS_ID,
  methods,
  NO_BLANK_CARDS,
  putCanvas,
  putLane,
  putValue,
  record,
  row,
  stepKeeper,
  writeDirectory,
  writtenValues,
} from "../fakes.ts"
import { type BoardDeps, handleCanvasMove, handleWorkflow } from "./board.ts"
import { type CardCommands, settled } from "./cards.ts"

/** The canvas's one thread. */
const THREAD_1 = threadIdFor("0123456789abcdef")

const [DOING, DONE] = [workflowStateIdFor("d"), workflowStateIdFor("x")]
const WORKFLOW_NOW: Workflow = {
  open: [{ id: DOING, name: "Doing" }],
  archive: { id: DONE, name: "Done" },
}
const ADA = writerId("ada@example.com")

/** A canvas of one root with one message, in Doing, on a board with Doing and Done. */
function setUp() {
  const b = basics()
  const root = entryId("e-1")
  writeEntry(b.root, row(root, null))
  writeDirectory(b)
  putCanvas(b, THREAD_1, CANVAS_ID, undefined, DOING)
  putValue(b, setRecord(WORKFLOW, WORKFLOW_NOW))
  const records = record<BoardDeps["records"]>({ writeValues: async () => {} })
  const work = record<BoardDeps["work"]>({
    destination: null,
    teardown: async () => {},
  })
  const moves = record<Pick<CardCommands, "placeCanvas">>({
    placeCanvas: async () => settled({ kind: "moved" }, 1),
  })
  const histories = record<BoardDeps["histories"]>({
    unloadCanvas: async () => {},
  })
  const deps: BoardDeps = {
    basics: b,
    records: records.port,
    work: work.port,
    keeper: stepKeeper(b),
    cards: NO_BLANK_CARDS,
    moves: () => moves.port,
    histories: histories.port,
  }
  return { b, root, records, work, moves, histories, deps }
}

const toDone = {
  kind: "move-canvas",
  canvas: CANVAS_ID,
  from: DOING,
  to: DONE,
  before: null,
} as const

test("a canvas an agent of its threads works in is not archived, and nothing is written", async () => {
  const { b, root, records, moves, deps } = setUp()
  const lane = THREAD_1
  putLane(b, lane, root)
  writeLaneTip(b.root, lane, root)
  beginRun(b.live, lane, runId("r-1"))
  const out = await handleCanvasMove(deps, ADA, toDone)
  expect(out.outcome).toMatchObject({ kind: "refused", code: ERR.CANVAS_BUSY })
  expect(records.calls).toEqual([])
  expect(moves.calls).toEqual([])
})

test("an idle canvas moved to Done: its card's move written, then torn down", async () => {
  const { moves, work, deps } = setUp()
  const out = await handleCanvasMove(deps, ADA, toDone)
  expect(out.outcome).toEqual({ kind: "moved" })
  expect(moves.calls).toMatchObject([
    {
      method: "placeCanvas",
      args: [
        ADA,
        {
          kind: "move",
          transition: "archive",
          steps: [
            {
              record: {
                id: CANVAS_ID,
                place: { kind: "board", state: DONE },
              },
            },
          ],
        },
      ],
    },
  ])
  expect(methods(work.calls)).toEqual(["teardown"])
})

test("archiving lets go of the canvas's stacks of moves, after its teardown; a move within open states does not", async () => {
  const { work, histories, deps } = setUp()
  await handleCanvasMove(deps, ADA, toDone)
  expect(histories.calls).toEqual([
    { method: "unloadCanvas", args: [CANVAS_ID] },
  ])
  expect(methods(work.calls)).toEqual(["teardown"])
  const open = setUp()
  const review = workflowStateIdFor("r")
  putValue(
    open.b,
    setRecord(WORKFLOW, {
      ...WORKFLOW_NOW,
      open: [...WORKFLOW_NOW.open, { id: review, name: "Review" }],
    }),
  )
  await handleCanvasMove(open.deps, ADA, { ...toDone, to: review })
  expect(open.histories.calls).toEqual([])
})

test("an idle canvas moved to Done with its last run's verdict pending leaves it unclassified", async () => {
  const { b, records, deps } = setUp()
  const pending = pendingVerdict(THREAD_1, entryId("e-1"), entryId("e-1"))
  putValue(b, setRecord(VERDICT, pending))
  await handleCanvasMove(deps, ADA, toDone)
  expect(writtenValues(records.calls)).toEqual([
    setRecord(VERDICT, { ...pending, verdict: { kind: "unclassified" } }),
  ])
})

test("a move from a state the canvas has left is refused `moved`, saying where it is and who put it there", async () => {
  const { moves, deps } = setUp()
  const out = await handleCanvasMove(deps, ADA, { ...toDone, from: DONE })
  expect(out.outcome).toMatchObject({
    kind: "unmoved",
    code: "moved",
    place: { kind: "board", state: DOING },
  })
  expect(moves.calls).toEqual([])
})

test("a move within open states writes only its card, and opens no root", async () => {
  const { b, moves, work, deps } = setUp()
  const review = workflowStateIdFor("r")
  putValue(
    b,
    setRecord(WORKFLOW, {
      ...WORKFLOW_NOW,
      open: [...WORKFLOW_NOW.open, { id: review, name: "Review" }],
    }),
  )
  const out = await handleCanvasMove(deps, ADA, { ...toDone, to: review })
  expect(out.outcome).toEqual({ kind: "moved" })
  expect(methods(moves.calls)).toEqual(["placeCanvas"])
  expect(work.calls).toEqual([])
  expect(readPlaces(b.places).some(c => c.id === CANVAS_ID)).toBe(true)
})

test("a workflow edit writes the workflow; a refusal writes nothing", async () => {
  const { records, deps } = setUp()
  expect(
    await handleWorkflow(deps, {
      kind: "workflow",
      edit: { action: "remove", state: DOING, name: "", before: null },
    }),
  ).toMatchObject({ kind: "refused", code: ERR.STATE_NOT_EMPTY })
  expect(records.calls).toEqual([])
  expect(
    await handleWorkflow(deps, {
      kind: "workflow",
      edit: { action: "rename", state: DONE, name: "Shipped", before: null },
    }),
  ).toEqual({ kind: "workflow-changed" })
  expect(writtenValues(records.calls)).toMatchObject([
    { namespace: "pinetrie.workflow", value: { archive: { name: "Shipped" } } },
  ])
})
