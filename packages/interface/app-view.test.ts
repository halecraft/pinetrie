import {
  type ArchivedTask,
  entryId,
  indexTree,
  type LaneView,
  NO_CONTENT,
  type OfferRecord,
  rootIdFor,
  type ThreadId,
  taskIdFor,
  threadIdFor,
  type Workflow,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor, entriesOf, entry } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  type AppViewInput,
  appView,
  NO_RAIL,
  readOnlyWords,
  taskRail,
  taskWork,
  threadWork,
} from "./app-view.ts"
import { PENDING_TRACK } from "./column-paths.ts"
import { BOUND, type Column } from "./columns.ts"
import { threadOfEntry, tree } from "./fixtures.ts"
import { rootSeed, trackSlot } from "./palette.ts"
import { linkTo } from "./thread-link.ts"

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
  keys.map(key => ({
    key,
    anchor: entryId("r"),
    thread: threadIdFor(key),
    mode: BOUND,
  }))
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
const stage = (over: Partial<AppViewInput>) => appView(input(over)).stage

describe("appView's stage", () => {
  test("before anything is chosen, the page is connecting; nothing is its own", () => {
    expect(stage({ active: null }).kind).toBe("connecting")
    expect(stage({ active: { kind: "nothing" } }).kind).toBe("nothing")
  })

  test("a new tab has its own kind, and its one column closes the tab", () => {
    expect(stage({ active: { kind: "new", key: "t" } })).toEqual({
      kind: "new",
      key: "t",
      slots: [{ key: "a", closable: true, track: 3 }],
    })
  })

  test("in a task, only a branch not yet sent closes: a card's column folds (ADR-0116)", () => {
    const [a, b] = columns("a", "b")
    const fresh: Column = { ...(b as Column), mode: { kind: "fresh" } }
    const two = stage({ columns: [a as Column, fresh], tracks: [3] })
    expect(two.kind === "task" && two.slots).toEqual([
      { key: "a", closable: false, track: 3 },
      { key: "b", closable: true, track: PENDING_TRACK },
    ])
  })

  test("an archived task is read-only, with Restore to the first open state; one not archived is not", () => {
    const here = stage({ archived: new Map([[K, archived]]) })
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
    expect(stage({}).kind === "task" && stage({})).toMatchObject({
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
      ledger: lane === A ? { source: cardIdFor("ca"), start: [] } : null,
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
    {
      lane: A,
      root: "r1",
      end: "t1",
      source: cardIdFor("ca"),
    },
    { lane: D, root: "r2", end: "r2", source: null },
  ])
})

test("a task's rail is a forest: a tree for each root of its threads, in order, each cut to the paths to its threads, a fork elsewhere a stub; nothing off a task (ADR-0116, ADR-0117)", () => {
  // 1-r1 -> 2-a -> 3-b; 4-c, a branch at 2-a, is another thread; 5-r2 -> 6-d.
  const index = tree({
    "1-r1": null,
    "2-a": "1-r1",
    "3-b": "2-a",
    "4-c": "2-a",
    "5-r2": null,
    "6-d": "5-r2",
  })
  const ids = (rows: readonly { readonly id: string }[]) => rows.map(r => r.id)
  const task = { kind: "task", task: K } as const
  const [R1, R2] = [
    rootIdFor("01a0ffd2-0000-7000-8000-0000000000a1"),
    rootIdFor("01a0ffd2-0000-7000-8000-0000000000a2"),
  ]
  const roots = [
    { root: R1, entry: entryId("1-r1") },
    { root: R2, entry: entryId("5-r2") },
  ]
  const C = threadOfEntry("4-c")
  const elsewhere = taskIdFor("01a0ffd2-0000-7000-8000-0000000000ee")
  const linkOf = (thread: ThreadId) =>
    linkTo(
      thread,
      [
        {
          kind: "thread",
          id: C,
          owner: ADA,
          placer: ADA,
          place: { kind: "canvas", task: elsewhere, order: "1", width: 1 },
          content: NO_CONTENT,
        },
      ],
      ADA,
    )
  const rail = taskRail({
    index,
    active: task,
    roots,
    ends: new Map([
      [threadOfEntry("1-r1"), entryId("3-b")],
      [threadOfEntry("5-r2"), entryId("6-d")],
    ]),
    linkOf,
    seed: rootSeed(R1),
  })
  expect(ids(rail.rows)).toEqual(["1-r1", "2-a", "3-b", "5-r2", "6-d"])
  expect(rail.stubs).toMatchObject([
    {
      from: "2-a",
      at: "4-c",
      thread: C,
      link: { kind: "open", task: elsewhere },
    },
  ])
  // Each tree in its root's palette under the page's seed.
  const slotOf = (id: string) => {
    const row = rail.rows.find(r => r.id === id)
    return row === undefined ? null : trackSlot(rootSeed(R1), row.track)
  }
  expect([slotOf("1-r1"), slotOf("5-r2")]).toEqual([
    trackSlot(rootSeed(R1), 0),
    trackSlot(rootSeed(R2), 0),
  ])
  expect(
    taskRail({
      index,
      active: { kind: "new", key: "t" },
      roots,
      ends: new Map(),
      linkOf,
      seed: 0,
    }),
  ).toEqual(NO_RAIL)
})

test("a rail stub for a branch whose first run wrote a context entry above its prompt opens at its first message (ADR-0125)", () => {
  const T = threadIdFor("t")
  const B = threadIdFor("b")
  const index = indexTree(
    entriesOf([
      entry("1-r", null, { role: "chat", content: "1-r" }, { thread: T }),
      entry(
        "2-cb",
        "1-r",
        { role: "canvas", content: "<canvas>" },
        { thread: B },
      ),
      entry("3-b", "2-cb", { role: "chat", content: "3-b" }, { thread: B }),
    ]),
  )
  const R = rootIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
  const elsewhere = taskIdFor("01a0ffd2-0000-7000-8000-0000000000ee")
  const rail = taskRail({
    index,
    active: { kind: "task", task: K },
    roots: [{ root: R, entry: entryId("1-r") }],
    ends: new Map([[T, entryId("1-r")]]),
    linkOf: thread =>
      linkTo(
        thread,
        [
          {
            kind: "thread",
            id: B,
            owner: ADA,
            placer: ADA,
            place: { kind: "canvas", task: elsewhere, order: "1", width: 1 },
            content: NO_CONTENT,
          },
        ],
        ADA,
      ),
    seed: rootSeed(R),
  })
  expect(rail.stubs).toMatchObject([{ from: "1-r", at: "3-b", thread: B }])
})

test("threadWork and taskWork: each busy held lane's work, and each lane running anywhere, by thread; a task's is the most of its threads' (ADR-0091, ADR-0116)", () => {
  const [a, b, c, d] = ["a", "b", "c", "d"].map(threadIdFor) as [
    ThreadId,
    ThreadId,
    ThreadId,
    ThreadId,
  ]
  const lane = (name: ThreadId, over: Partial<LaneView>): LaneView => ({
    name,
    tip: entryId("e"),
    running: false,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
    heldBy: null,
    ...over,
  })
  const work = threadWork({
    lanes: [
      lane(a, { waiting: 1 }),
      lane(b, { waiting: 1, heldBy: ADA }),
      lane(c, {}),
    ],
    running: [{ lane: d }, { lane: a }],
  })
  expect(work).toEqual(
    new Map([
      [a, "running"],
      [b, "held"],
      [d, "running"],
    ]),
  )
  const K2 = taskIdFor("01a0ffd2-0000-7000-8000-00000000000b")
  expect(
    taskWork(
      // The most first, so a later, lesser thread cannot win by coming last.
      new Map([
        [c, "waiting"],
        [b, "held"],
        [d, "running"],
      ]),
      new Map([
        [b, K],
        [c, K],
        [d, K2],
      ]),
    ),
  ).toEqual(
    new Map([
      [K, "waiting"],
      [K2, "running"],
    ]),
  )
})
