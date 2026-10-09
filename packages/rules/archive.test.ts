import {
  type ArchivedTask,
  atEntry,
  type CardRecord,
  commitId,
  type EntryLike,
  ERR,
  entryId,
  type Intent,
  indexTree,
  type LaneView,
  noteColumnIdFor,
  type RevisionRecord,
  ROOT,
  rootIdFor,
  snapshotId,
  type TaskId,
  taskIdFor,
  textCardId,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { archivedIn, planArchive, writesIn } from "./archive.ts"
import { indexTasks, threadCardOf } from "./task.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const OTHER_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const OTHER_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000b")

const BEA = writerId("p-bea")

const entry = (id: string, parentId: string | null): EntryLike => ({
  id: entryId(id),
  parentId: parentId === null ? null : entryId(parentId),
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
    roots: [TEST_ROOT, OTHER_ROOT],
    stillHeld: new Set([OTHER_ROOT]),
    ...over,
  })

describe("planArchive (ADR-0116)", () => {
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
  describe("what follows the record, off the documents' keeper (ADR-0065)", () => {
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
    test("restore: each lane's ref back at its tip's nearest revision; none without a tip; nothing forgotten or deleted, nor unloaded", () => {
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
const NOTES_X = noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1")

describe("writesIn: the tasks a command writes in (ADR-0063, ADR-0116)", () => {
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
        at: atEntry(entryId("b")),
        thread: T_B,
      },
      carries: { kind: "message", command: null },
      unsent: null,
    },
    {
      kind: "note-column",
      id: NOTES_X,
      owner: BEA,
      placer: BEA,
      place: { kind: "canvas", task: OTHER_TASK, order: "z", width: 1 },
    },
  ]
  const tasks = indexTasks(cards, new Map())
  const at = (intent: Intent) => writesIn(intent, tasks, cards)
  const chat = (p: Intent & { kind: "chat" }) => p
  const atB = {
    kind: "composing",
    at: atEntry(entryId("b")),
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
            at: atEntry(entryId("a")),
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
      "a keep's moves into a fresh column of each of two tasks: both",
      {
        kind: "move",
        moves: [OTHER_TASK, TASK].map(task => ({
          card: textCardId(task),
          from: null,
          to: { kind: "fresh", column: "k", root: TEST_ROOT, task, at: ROOT },
        })),
        here: null,
      },
      [OTHER_TASK, TASK],
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
