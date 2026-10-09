import {
  type ArchivedTask,
  entryId,
  type LaneView,
  type OfferRecord,
  rootIdFor,
  type ThreadId,
  taskIdFor,
  threadIdFor,
  type Workflow,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type AppViewInput,
  appView,
  hereRail,
  readOnlyWords,
  workAnywhere,
} from "./app-view.ts"
import { PENDING_TRACK } from "./column-paths.ts"
import type { Column } from "./columns.ts"
import { tree } from "./fixtures.ts"

const ADA = writerId("ada@x.test")
const nameOf = new Map([[ADA, "Ada"]])
const K = taskIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const archived: ArchivedTask = { task: K, by: ADA, at: 1 }
const WORKFLOW: Workflow = {
  open: [
    { id: workflowStateIdFor("b"), name: "Backlog" },
    { id: workflowStateIdFor("d"), name: "Doing" },
  ],
  archive: { id: workflowStateIdFor("x"), name: "Done" },
}
const columns = (...keys: string[]): Column[] =>
  keys.map(key => ({ key, anchor: entryId("r") }))
const input = (over: Partial<AppViewInput>): AppViewInput => ({
  active: { kind: "task", task: K },
  columns: columns("a"),
  tracks: [3],
  archived: new Map(),
  workflow: WORKFLOW,
  nameOf,
  offers: new Map(),
  lanes: [],
  laneRoots: new Map(),
  ...over,
})
const workspace = (over: Partial<AppViewInput>) =>
  appView(input(over)).workspace

describe("appView's workspace", () => {
  test("before anything is chosen, the page is connecting; nothing is its own", () => {
    expect(workspace({ active: null }).kind).toBe("connecting")
    expect(workspace({ active: { kind: "nothing" } }).kind).toBe("nothing")
  })

  test("a new tab has its own kind, and its one column closes the tab", () => {
    expect(workspace({ active: { kind: "new", key: "t" } })).toEqual({
      kind: "new",
      key: "t",
      slots: [{ key: "a", position: 0, closable: true, track: 3 }],
    })
  })

  test("a task's only column offers no close; with two, both do", () => {
    const one = workspace({})
    const two = workspace({ columns: columns("a", "b"), tracks: [3] })
    expect(one.kind === "task" && one.slots.map(s => s.closable)).toEqual([
      false,
    ])
    expect(two.kind === "task" && two.slots).toEqual([
      { key: "a", position: 0, closable: true, track: 3 },
      { key: "b", position: 1, closable: true, track: PENDING_TRACK },
    ])
  })

  test("an archived task is read-only, with Restore to the first open state; one not archived is not", () => {
    const here = workspace({ archived: new Map([[K, archived]]) })
    expect(here.kind === "task" && here.readOnly).toEqual({
      label: "archived by Ada",
      action: {
        title: "Restore",
        intent: {
          kind: "moveTask",
          task: K,
          from: WORKFLOW.archive.id,
          to: WORKFLOW.open[0]?.id,
          before: null,
          closes: false,
        },
      },
    })
    expect(workspace({}).kind === "task" && workspace({})).toMatchObject({
      readOnly: null,
    })
  })
})

test("readOnlyWords offers no Restore before the board has states", () => {
  expect(readOnlyWords(archived, null, nameOf)).toEqual({
    label: "archived by Ada",
    action: null,
  })
})

test("the header's offers are the open ones, never one accepted work already holds: a held lane's at its tip, if it has one; another's at its root (ADR-0063)", () => {
  const A = threadIdFor("a")
  const B = threadIdFor("b")
  const C = threadIdFor("c")
  const D = threadIdFor("d")
  const E = threadIdFor("e")
  const offer = (
    lane: ThreadId,
    acceptedAs: string | null,
    files = ["a.txt"],
  ) =>
    ({
      lane,
      acceptedAs,
      files,
      edited: false,
      ledger: lane === A ? { source: "c-a", start: [] } : null,
    }) as unknown as OfferRecord
  const lane = (name: ThreadId, tip: string | null) =>
    ({ name, tip }) as unknown as LaneView
  const { offers } = appView(
    input({
      offers: new Map([
        [A, offer(A, null)],
        [B, offer(B, "accepted")],
        [C, offer(C, null)],
        [D, offer(D, null)],
        [E, offer(E, null, [])],
      ]),
      lanes: [lane(A, "t1"), lane(B, "t2"), lane(C, null)],
      laneRoots: new Map([
        [A, entryId("r1")],
        [B, entryId("r1")],
        [C, entryId("r1")],
        [D, entryId("r2")],
        [E, entryId("r2")],
      ]),
    }),
  )
  expect(offers).toEqual([
    { lane: A, root: "r1", end: "t1", source: "c-a" },
    { lane: D, root: "r2", end: "r2", source: null },
  ])
})

test("a task's rail draws its first root's tree only", () => {
  const index = tree({ r1: null, a: "r1", r2: null, b: "r2" })
  const ids = (rows: readonly { readonly id: string }[]) => rows.map(r => r.id)
  expect(
    ids(hereRail(index, { kind: "task", task: K }, entryId("r1"))),
  ).toEqual(["r1", "a"])
  expect(hereRail(index, { kind: "task", task: K }, null)).toEqual([])
  expect(hereRail(index, { kind: "new", key: "t" }, entryId("r1"))).toEqual([])
  expect(hereRail(index, null, null)).toEqual([])
})

test("workAnywhere: the held roots' work, and each lane running in a root this tab does not hold, by its root entry, running winning; a root with no entry yet is left out (ADR-0091)", () => {
  const held = rootIdFor("01a0ffd2-0000-7000-8000-000000000001")
  const unheld = rootIdFor("01a0ffd2-0000-7000-8000-000000000002")
  const unknown = rootIdFor("01a0ffd2-0000-7000-8000-000000000003")
  expect(
    workAnywhere({
      held: new Map([[entryId("r1"), "waiting"]]),
      running: [
        { lane: threadIdFor("a"), root: held },
        { lane: threadIdFor("b"), root: unheld },
        { lane: threadIdFor("c"), root: unknown },
      ],
      rootEntries: new Map([
        [held, entryId("r1")],
        [unheld, entryId("r2")],
      ]),
    }),
  ).toEqual(
    new Map([
      [entryId("r1"), "running"],
      [entryId("r2"), "running"],
    ]),
  )
})
