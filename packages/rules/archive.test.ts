import {
  type ArchivedTask,
  type CardRecord,
  cardIdOfKind,
  commitId,
  type EntryLike,
  ERR,
  entryId,
  type Intent,
  indexTree,
  type LaneView,
  NO_CONTENT,
  type RevisionRecord,
  rootIdFor,
  snapshotId,
  type TaskId,
  taskIdFor,
  textCardId,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor, FIXTURE_THREAD } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { archivedIn, planArchive, planLanesGone, writesIn } from "./archive.ts"
import { threadCardOf } from "./fixtures.ts"
import { indexTasks } from "./task.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const OTHER_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const OTHER_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000b")

const BEA = writerId("p-bea")

const entry = (id: string, parentId: string | null): EntryLike => ({
  id: entryId(id),
  parentId: parentId === null ? null : entryId(parentId),
  thread: FIXTURE_THREAD,
  type: "message",
  message: { role: "user", content: id },
})
/** One root, r1 -> a -> b. */
const index = indexTree(
  Object.fromEntries(
    [entry("r1", null), entry("a", "r1"), entry("b", "a")].map(e => [e.id, e]),
  ),
)

const archived = (task: TaskId): ArchivedTask => ({ task, by: BEA, at: 1 })

const lane = (name: string, over: Partial<LaneView> = {}): LaneView => ({
  name: threadIdFor(name),
  tip: entryId("b"),
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
  ...over,
})

/** The task's thread: `mine`; `theirs`, below, is another task's, in the same root. */
const MINE = threadIdFor("mine")

const plan = (
  over: Partial<Parameters<typeof planArchive>[0]> = {},
): ReturnType<typeof planArchive> =>
  planArchive({
    crossing: "archive",
    threads: [MINE],
    lanes: [],
    own: [],
    revisions: new Map(),
    trees: [],
    roots: [TEST_ROOT, OTHER_ROOT],
    stillHeld: new Set([OTHER_ROOT]),
    ...over,
  })

describe("planArchive", () => {
  test("archiving tears down and lets go of the roots nothing else holds a thread of", () => {
    expect(plan()).toEqual({
      kind: "cross",
      teardown: { forget: [], refs: [], snapshots: [] },
      unload: [TEST_ROOT],
    })
  })
  test("refuses while an agent of its threads works, or cards wait there, held or not", () => {
    expect(plan({ lanes: [lane("mine", { running: true })] })).toEqual({
      kind: "refused",
      code: ERR.TASK_BUSY,
      message: "an agent is working here",
    })
    expect(plan({ lanes: [lane("mine", { waiting: 1 })] })).toEqual({
      kind: "refused",
      code: ERR.TASK_BUSY,
      message: "cards are queued here",
    })
    expect(
      plan({ lanes: [lane("mine", { waiting: 1, heldBy: BEA })] }),
    ).toEqual({
      kind: "refused",
      code: ERR.TASK_BUSY,
      message: "cards are queued here",
    })
  })
  test("work in another task's thread does not stop it, even in the same root; restoring is never busy", () => {
    expect(plan({ lanes: [lane("theirs", { running: true })] }).kind).toBe(
      "cross",
    )
    expect(
      plan({ crossing: "restore", lanes: [lane("mine", { running: true })] }),
    ).toMatchObject({ kind: "cross", unload: [] })
  })
  describe("what follows the record, off the documents' keeper", () => {
    const [A, B] = [threadIdFor("la"), threadIdFor("lb")]
    const revision = (
      entry: string,
      lane: typeof A,
      commit: string | null,
      snapshot: string | null,
    ): RevisionRecord => ({
      entry: entryId(entry),
      lane,
      commit: commit === null ? null : commitId(commit),
      snapshot: snapshot === null ? null : snapshotId(snapshot),
      paths: [],
      conflicts: [],
      ignored: null,
      recipe: null,
    })
    const revisions = new Map([
      [
        entryId("a"),
        revision("a", A, "c0000000-0000-7000-8000-00000000000a", "s-a1"),
      ],
      [entryId("b"), revision("b", A, null, "s-a2")],
      [
        entryId("r1"),
        revision("r1", B, "c0000000-0000-7000-8000-00000000000c", "s-c"),
      ],
    ])
    const own = [
      { lane: A, tip: entryId("b"), index },
      { lane: B, tip: null, index },
    ]
    test("archive: its lanes forgotten, their refs deleted, every snapshot but each lane's newest", () => {
      expect(plan({ own, revisions })).toMatchObject({
        teardown: {
          forget: [A, B],
          refs: [
            { lane: A, commit: null },
            { lane: B, commit: null },
          ],
          snapshots: ["s-a1"],
        },
        unload: [TEST_ROOT],
      })
    })
    test("archive keeps the snapshot nearest each thread's end, a copy's files", () => {
      // A conversation thread from `a`, which A's turn there recorded.
      const T = threadIdFor("talk")
      const forked = indexTree(
        Object.fromEntries(
          [
            entry("r1", null),
            entry("a", "r1"),
            entry("b", "a"),
            { ...entry("c", "a"), thread: T },
          ].map(e => [e.id, e]),
        ),
      )
      expect(plan({ own, revisions, trees: [forked] })).toMatchObject({
        teardown: { snapshots: [] },
      })
    })
    test("restore: each lane's ref back at its tip's nearest revision", () => {
      expect(plan({ crossing: "restore", own, revisions })).toMatchObject({
        teardown: {
          forget: [],
          refs: [{ lane: A, commit: "c0000000-0000-7000-8000-00000000000a" }],
          snapshots: [],
        },
        unload: [],
      })
    })
  })
})

const LANE_X = threadIdFor("x")
const T_B = threadIdFor("b-thread")
const NOTES_X = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000a1",
)

describe("writesIn: the tasks a command writes in", () => {
  // LANE_X's card is on OTHER_TASK's canvas, T_B's on TASK's.
  const cards: CardRecord[] = [
    threadCardOf({ thread: LANE_X, task: OTHER_TASK, by: BEA, cards: [] }),
    threadCardOf({ thread: T_B, task: TASK, by: BEA, cards: [] }),
    {
      kind: "text",
      id: cardIdFor("c106"),
      owner: BEA,
      placer: BEA,
      place: {
        kind: "composing",
        thread: T_B,
      },
      content: { command: null, unsent: null, origin: null },
    },
    {
      kind: "note-column",
      id: NOTES_X,
      owner: BEA,
      placer: BEA,
      place: { kind: "canvas", task: OTHER_TASK, order: "z", width: 1 },
      content: NO_CONTENT,
    },
  ]
  const tasks = indexTasks(cards, new Map())
  const at = (intent: Intent) => writesIn(intent, tasks, cards)
  const chat = (p: Intent & { kind: "chat" }) => p
  const atB = {
    kind: "composing",
    thread: T_B,
  } as const
  test.each([
    [
      "a chat at a thread's end: the thread's task",
      chat({
        kind: "chat",
        text: "x",
        root: TEST_ROOT,
        at: { kind: "end", thread: T_B, seen: entryId("b") },
        asksAgent: false,
        mentions: [],
        card: null,
        pinned: [],
        base: null,
        state: null,
      }),
      [TASK],
    ],
    [
      "a branch: the task its card goes in",
      chat({
        kind: "chat",
        text: "x",
        root: OTHER_ROOT,
        at: {
          kind: "branch",
          thread: threadIdFor("new"),
          at: null,
          task: OTHER_TASK,
        },
        asksAgent: false,
        mentions: [],
        card: null,
        pinned: [],
        base: null,
        state: null,
      }),
      [OTHER_TASK],
    ],
    ["a name", { kind: "name", name: "Ada" }, []],
    ["a stop", { kind: "stop", lane: LANE_X }, []],
    [
      "a carry-on: its lane's task",
      { kind: "carry-on", lane: LANE_X },
      [OTHER_TASK],
    ],
    [
      "a queue's hold: its lane's task",
      { kind: "queue-hold", lane: LANE_X, held: true },
      [OTHER_TASK],
    ],
    [
      "unqueue all: its lane's task",
      { kind: "unqueue-all", lane: LANE_X },
      [OTHER_TASK],
    ],
    [
      "a reorder: the task of the place it names",
      {
        kind: "reorder",
        reorder: {
          card: cardIdFor("c1"),
          at: {
            kind: "queued",
            thread: LANE_X,
            seen: "",
          },
          after: null,
          before: cardIdFor("c2"),
        },
      },
      [OTHER_TASK],
    ],
    ["a reservation", { kind: "reserve", lane: threadIdFor("x") }, []],
    [
      "a copy: the task its card lands in, never its source's, which may be archived",
      {
        kind: "copy-thread",
        source: LANE_X,
        end: entryId("b"),
        move: {
          card: threadIdFor("copy"),
          from: null,
          to: { kind: "canvas-at", task: TASK, after: null },
        },
      },
      [TASK],
    ],
    [
      "a move on the board: none, so an archived task can be restored",
      {
        kind: "move-task",
        task: TASK,
        from: workflowStateIdFor("a"),
        to: workflowStateIdFor("b"),
        before: null,
      },
      [],
    ],
    [
      "a change to the workflow",
      {
        kind: "workflow",
        edit: { action: "add", state: null, name: "Review", before: null },
      },
      [],
    ],
    [
      "a mark: its task",
      { kind: "mark", of: { kind: "task", task: TASK }, title: "Tab names" },
      [TASK],
    ],
    [
      "a note column's title: its column's task",
      {
        kind: "mark",
        of: { kind: "note-column", column: NOTES_X },
        title: "Ideas",
      },
      [OTHER_TASK],
    ],
    ["a retitle: its task", { kind: "retitle", task: TASK }, [TASK]],
    [
      "an offer: its lane's task",
      { kind: "offer", lane: LANE_X, action: "refresh", to: null, seen: null },
      [OTHER_TASK],
    ],
    [
      "a card made at a thread: its task",
      {
        kind: "move",
        moves: [{ card: textCardId("c"), from: null, to: atB }],
        here: null,
      },
      [TASK],
    ],
    [
      "a move out of a task, into an inventory: the task it leaves",
      {
        kind: "move",
        moves: [
          {
            card: cardIdFor("c106"),
            from: atB,
            to: { kind: "inventory", holder: writerId("ada@x.io") },
          },
        ],
        here: null,
      },
      [TASK],
    ],
    [
      "a thread opened: the task its card lands in",
      {
        kind: "open-thread",
        thread: threadIdFor("new"),
        root: TEST_ROOT,
        at: null,
        task: OTHER_TASK,
        state: null,
      },
      [OTHER_TASK],
    ],
    [
      "an undo of moves outside any task: none",
      { kind: "undo-move", task: null, direction: "undo" },
      [],
    ],
    [
      "an undo of moves: its task",
      { kind: "undo-move", task: OTHER_TASK, direction: "undo" },
      [OTHER_TASK],
    ],
  ] satisfies [
    string,
    Intent,
    readonly TaskId[],
  ][])("%s", (_, intent, want) => {
    expect(at(intent)).toEqual(want)
  })
})

describe("archivedIn", () => {
  const archive = new Map([[TASK, archived(TASK)]])
  test("a written task that is archived refuses, by who archived it", () => {
    expect(archivedIn([OTHER_TASK, TASK], archive)).toEqual(archived(TASK))
  })
  test("tasks not archived, and none, do not", () => {
    expect(archivedIn([OTHER_TASK], archive)).toBeNull()
    expect(archivedIn([], archive)).toBeNull()
  })
})

test("planLanesGone: a deleted thread's lanes forgotten, their refs deleted, no snapshot kept with no revision", () => {
  expect(planLanesGone([LANE_X], new Map(), [])).toEqual({
    forget: [LANE_X],
    refs: [{ lane: LANE_X, commit: null }],
    snapshots: [],
  })
  expect(planLanesGone([], new Map(), [])).toEqual({
    forget: [],
    refs: [],
    snapshots: [],
  })
})
