import {
  entryId,
  indexTree,
  rootIdFor,
  type ThreadRecord,
  taskIdFor,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { fromParents, threadOfEntry } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { threadCardOf } from "./fixtures.ts"
import { planOpenThread } from "./open.ts"
import { emptiedTasks, planTaskDelete } from "./root.ts"
import { rootsHeld, unstartedThreads } from "./task.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const NEW_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const NEW_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000d")
const ADA = writerId("ada@x.io")
// r -> a -> b: thread `r`; c, a branch at a, starts thread `c`.
const index = indexTree(fromParents({ r: null, a: "r", b: "a", c: "a" }))
const R = threadOfEntry("r")
const NEW = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const record = (thread: typeof R, root = ROOT): ThreadRecord => ({
  thread,
  root,
  by: ADA,
  createdAt: 1,
  origin: { kind: "root" },
})
const onCanvas = threadCardOf({ thread: R, task: TASK, by: ADA, cards: [] })
const STATE = workflowStateIdFor("d")
const WORKFLOW = {
  open: [{ id: STATE, name: "Doing" }],
  archive: { id: workflowStateIdFor("x"), name: "Done" },
}
const plan = (
  open: Partial<Parameters<typeof planOpenThread>[0]["open"]> = {},
  over: Partial<Parameters<typeof planOpenThread>[0]> = {},
) =>
  planOpenThread({
    open: {
      thread: NEW,
      root: ROOT,
      at: entryId("b"),
      task: TASK,
      state: null,
      ...open,
    },
    sender: ADA,
    cards: [onCanvas],
    threads: new Map([[R, record(R)]]),
    roots: new Set([ROOT]),
    tasks: new Set([TASK]),
    index,
    workflow: WORKFLOW,
    board: new Map(),
    now: 7,
    ...over,
  })

describe("planOpenThread (ADR-0126)", () => {
  test("a branch: its record forks at its entry, its card just after the thread it forks from, and no task is written", () => {
    const opened = plan()
    expect(opened.kind).toBe("open")
    if (opened.kind !== "open") return
    expect(opened.records).toMatchObject([
      {
        namespace: "pinetrie.thread",
        key: NEW,
        value: {
          root: ROOT,
          by: ADA,
          createdAt: 7,
          origin: { kind: "fork", at: "b", how: "branch" },
        },
      },
    ])
    expect(opened.steps.at(-1)).toMatchObject({
      kind: "write",
      record: {
        kind: "thread",
        id: NEW,
        place: { kind: "canvas", task: TASK, width: 1 },
      },
    })
  })

  test("a new tab: a new root's first thread, in a new task written with its board place", () => {
    const opened = plan(
      { root: NEW_ROOT, at: null, task: NEW_TASK, state: STATE },
      { index: null },
    )
    expect(
      opened.kind === "open" && opened.records.map(r => r.namespace),
    ).toEqual(["pinetrie.thread", "pinetrie.task", "pinetrie.board"])
    expect(opened.kind === "open" && opened.records[0]).toMatchObject({
      value: { root: NEW_ROOT, origin: { kind: "root" } },
    })
    expect(opened.kind === "open" && opened.steps.at(-1)).toMatchObject({
      record: { id: NEW, place: { kind: "canvas", task: NEW_TASK } },
    })
  })

  test.each([
    ["its id names a recorded thread", plan({ thread: R }), "taken"],
    ["its entry is in no root it holds", plan({ at: entryId("x") }), "unknown"],
    ["its task is not the session's", plan({ task: NEW_TASK }), "unknown"],
    [
      "a new tab's root is in use",
      plan({ at: null, task: NEW_TASK }, { index: null }),
      "taken",
    ],
    [
      "a new tab's task is in use",
      plan({ root: NEW_ROOT, at: null }, { index: null }),
      "taken",
    ],
  ] as const)("refused: %s", (_, planned, why) => {
    expect(planned).toEqual({ kind: "refused", why })
  })
})

describe("unstartedThreads (ADR-0126)", () => {
  test("a thread with no entry: a branch at its fork when its fork is held here, a new root's while the directory names no root of it", () => {
    const threads = new Map<typeof R, ThreadRecord>([
      [R, record(R)],
      [
        NEW,
        {
          ...record(NEW),
          origin: { kind: "fork", at: entryId("b"), how: "branch" },
        },
      ],
      [threadIdFor("tab"), record(threadIdFor("tab"), NEW_ROOT)],
      [
        threadIdFor("far"),
        {
          ...record(threadIdFor("far")),
          origin: { kind: "fork", at: entryId("far"), how: "copy" },
        },
      ],
    ])
    expect(unstartedThreads(threads, index, new Set([ROOT]))).toEqual(
      new Map([
        [NEW, { root: ROOT, fork: "b" }],
        [threadIdFor("tab"), { root: NEW_ROOT, fork: null }],
      ]),
    )
    // Its first entry written, and its root in the directory: started.
    expect(
      unstartedThreads(threads, index, new Set([ROOT, NEW_ROOT])).has(
        threadIdFor("tab"),
      ),
    ).toBe(false)
  })
})

describe("closing a new tab before its first send (ADR-0126)", () => {
  const tab = threadCardOf({ thread: NEW, task: NEW_TASK, by: ADA, cards: [] })
  const trashed = {
    ...tab,
    place: { kind: "trash", holder: ADA, task: NEW_TASK },
  } as const
  const threads = new Map([[NEW, record(NEW, NEW_ROOT)]])
  test("its thread to the trash leaves its task empty: the task goes", () => {
    expect(
      emptiedTasks({
        before: [tab],
        after: [trashed],
        threads,
        started: new Set([ROOT]),
      }),
    ).toEqual([NEW_TASK])
    expect(planTaskDelete(NEW_TASK).map(w => [w.kind, w.namespace])).toEqual([
      ["delete", "pinetrie.task"],
      ["delete", "pinetrie.board"],
      ["delete", "pinetrie.mark"],
    ])
  })
  test("never a task that holds another card, nor one whose root has started, nor a branch's", () => {
    const other = threadCardOf({
      thread: R,
      task: NEW_TASK,
      by: ADA,
      cards: [tab],
    })
    const cases = [
      { after: [trashed, other] },
      { started: new Set([NEW_ROOT]) },
      {
        threads: new Map([
          [
            NEW,
            {
              ...record(NEW, NEW_ROOT),
              origin: { kind: "fork", at: entryId("b"), how: "branch" },
            } as ThreadRecord,
          ],
        ]),
      },
    ]
    for (const over of cases)
      expect(
        emptiedTasks({
          before: [tab],
          after: [trashed],
          threads,
          started: new Set([ROOT]),
          ...over,
        }),
      ).toEqual([])
  })
})

test("rootsHeld: a root with a thread on an open canvas or in an inventory; never one the directory does not name yet, an unstarted new tab's (ADR-0126)", () => {
  const tab = threadCardOf({ thread: NEW, task: NEW_TASK, by: ADA, cards: [] })
  const threads = new Map([
    [R, record(R)],
    [NEW, record(NEW, NEW_ROOT)],
  ])
  expect(
    rootsHeld([onCanvas, tab], threads, new Set(), new Set([ROOT])),
  ).toEqual(new Set([ROOT]))
  expect(
    rootsHeld([onCanvas, tab], threads, new Set(), new Set([ROOT, NEW_ROOT])),
  ).toEqual(new Set([ROOT, NEW_ROOT]))
  expect(
    rootsHeld([onCanvas, tab], threads, new Set([TASK]), new Set([ROOT])),
  ).toEqual(new Set())
})
