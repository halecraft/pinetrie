import {
  ERR,
  entryId,
  laneNameForThread,
  runId,
  type Workflow,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { BOARD, setRecord, WORKFLOW } from "@pinetrie/rules"
import { beginRun, writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import {
  basics,
  methods,
  putLane,
  putValue,
  ROOT_ID,
  record,
  row,
  writeDirectory,
  writesOf,
} from "../fakes.ts"
import { type BoardDeps, handleRootMove, handleWorkflow } from "./board.ts"

const [DOING, DONE] = [workflowStateIdFor("d"), workflowStateIdFor("x")]
const WORKFLOW_NOW: Workflow = {
  open: [{ id: DOING, name: "Doing" }],
  closed: { id: DONE, name: "Done" },
}
const ADA = writerId("ada@example.com")

/** A root with one message, in Doing, on a board with Doing and Done. */
function setUp() {
  const b = basics()
  const root = entryId("e-1")
  writeEntry(b.root, row(root, null))
  writeDirectory(b)
  putValue(b, setRecord(WORKFLOW, WORKFLOW_NOW))
  putValue(
    b,
    setRecord(BOARD, {
      root: ROOT_ID,
      state: DOING,
      rank: "a",
      by: ADA,
      at: 0,
    }),
  )
  const records = record<BoardDeps["records"]>({ writeValues: async () => {} })
  const work = record<BoardDeps["work"]>({
    repo: null,
    teardown: async () => {},
  })
  const deps: BoardDeps = {
    basics: b,
    records: records.port,
    work: work.port,
    keeper: createKeeper(),
  }
  return { b, root, records, work, deps }
}

const toDone = {
  kind: "move-root",
  root: ROOT_ID,
  from: DOING,
  to: DONE,
  before: null,
} as const

test("a root the agent works in is not closed, and nothing is written", async () => {
  const { b, root, records, deps } = setUp()
  const lane = laneNameForThread("0123456789abcdef")
  putLane(b, lane, root)
  writeLaneTip(b.root, lane, root)
  beginRun(b.live, lane, runId("r-1"))
  const out = await handleRootMove(deps, ADA, toDone)
  expect(out).toMatchObject({ kind: "refused", code: ERR.ROOT_BUSY })
  expect(records.calls).toEqual([])
})

test("an idle root moved to Done: its place written, then torn down and unloaded", async () => {
  const { records, work, deps } = setUp()
  const out = await handleRootMove(deps, ADA, toDone)
  expect(out).toEqual({ kind: "moved-root" })
  expect(writesOf(records.calls)).toMatchObject([
    { namespace: "pinetrie.board", key: ROOT_ID, value: { state: DONE } },
  ])
  expect(methods(work.calls)).toEqual(["teardown"])
})

test("a move within open states writes only the place, and opens no root", async () => {
  const { b, records, work, deps } = setUp()
  const review = workflowStateIdFor("r")
  putValue(
    b,
    setRecord(WORKFLOW, {
      ...WORKFLOW_NOW,
      open: [...WORKFLOW_NOW.open, { id: review, name: "Review" }],
    }),
  )
  const out = await handleRootMove(deps, ADA, { ...toDone, to: review })
  expect(out).toEqual({ kind: "moved-root" })
  expect(writesOf(records.calls)).toHaveLength(1)
  expect(work.calls).toEqual([])
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
  expect(writesOf(records.calls)).toMatchObject([
    { namespace: "pinetrie.workflow", value: { closed: { name: "Shipped" } } },
  ])
})
