import {
  type ArchivedRoot,
  atEntry,
  cardId,
  commitId,
  type EntryLike,
  ERR,
  entryId,
  type Intent,
  indexTree,
  type LaneView,
  laneNameForThread,
  type RevisionRecord,
  ROOT,
  type RootId,
  rootIdFor,
  snapshotId,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { archivedIn, planArchive, writesIn } from "./archive.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const BEA = writerId("p-bea")

const entry = (id: string, parentId: string | null): EntryLike => ({
  id: entryId(id),
  parentId: parentId === null ? null : entryId(parentId),
  type: "message",
  message: { role: "user", content: id },
})
/** Two roots, r1 -> a -> b and r2 -> c; and an orphan o whose parent is missing, with o -> d. */
const index = indexTree(
  Object.fromEntries(
    [
      entry("r1", null),
      entry("a", "r1"),
      entry("b", "a"),
      entry("r2", null),
      entry("c", "r2"),
      entry("o", "gone"),
      entry("d", "o"),
    ].map(e => [e.id, e]),
  ),
)

const archived = (root: RootId): ArchivedRoot => ({ root, by: BEA, at: 1 })

const lane = (tip: string, over: Partial<LaneView> = {}): LaneView => ({
  name: laneNameForThread(tip),
  tip: entryId(tip),
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
  ...over,
})

const plan = (
  over: Partial<Parameters<typeof planArchive>[0]> = {},
): ReturnType<typeof planArchive> =>
  planArchive({
    crossing: "close",
    root: entryId("r1"),
    index,
    lanes: [],
    own: [],
    revisions: new Map(),
    ...over,
  })

describe("planArchive", () => {
  test("a close tears down and unloads", () => {
    expect(plan()).toEqual({
      kind: "cross",
      teardown: { forget: [], refs: [], snapshots: [] },
      unload: true,
    })
  })
  test("refuses an entry that is not a root", () => {
    expect(plan({ root: entryId("a") })).toMatchObject({
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
    })
    expect(plan({ root: entryId("nope") })).toMatchObject({ kind: "refused" })
  })
  test("refuses while the agent works in the root, or cards wait there, held or not", () => {
    expect(plan({ lanes: [lane("b", { running: true })] })).toEqual({
      kind: "refused",
      code: ERR.ROOT_BUSY,
      message: "the agent is working here",
    })
    expect(plan({ lanes: [lane("a", { waiting: 1 })] })).toEqual({
      kind: "refused",
      code: ERR.ROOT_BUSY,
      message: "cards are queued here",
    })
    expect(plan({ lanes: [lane("a", { waiting: 1, heldBy: BEA })] })).toEqual({
      kind: "refused",
      code: ERR.ROOT_BUSY,
      message: "cards are queued here",
    })
  })
  test("work in another root does not stop it, and reopening is never busy", () => {
    expect(plan({ lanes: [lane("c", { running: true })] }).kind).toBe("cross")
    expect(
      plan({ crossing: "reopen", lanes: [lane("b", { running: true })] }),
    ).toMatchObject({ kind: "cross", unload: false })
  })
  describe("what follows the record, off the documents' keeper (ADR-0065)", () => {
    const [A, B] = [laneNameForThread("la"), laneNameForThread("lb")]
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
      [entryId("a"), revision("a", A, "c-a", "s-a1")],
      [entryId("b"), revision("b", A, null, "s-a2")],
      [entryId("c"), revision("c", B, "c-c", "s-c")],
    ])
    test("archive: its lanes forgotten, their refs deleted, every snapshot but each lane's newest, then unloaded", () => {
      expect(
        plan({
          own: [
            { lane: A, tip: entryId("b") },
            { lane: B, tip: null },
          ],
          revisions,
        }),
      ).toMatchObject({
        teardown: {
          forget: [A, B],
          refs: [
            { lane: A, commit: null },
            { lane: B, commit: null },
          ],
          snapshots: ["s-a1"],
        },
        unload: true,
      })
    })
    test("restore: each lane's ref back at its tip's nearest revision; none without a tip; nothing forgotten or deleted, nor unloaded", () => {
      expect(
        plan({
          crossing: "reopen",
          own: [
            { lane: A, tip: entryId("b") },
            { lane: B, tip: null },
          ],
          revisions,
        }),
      ).toMatchObject({
        teardown: {
          forget: [],
          refs: [{ lane: A, commit: "c-a" }],
          snapshots: [],
        },
        unload: false,
      })
    })
  })
})

const OTHER_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const LANE_X = laneNameForThread("x")

describe("writesIn: the root a command writes in (ADR-0063)", () => {
  const at = (intent: Intent) =>
    writesIn(intent, lane => (lane === LANE_X ? OTHER_ROOT : null))
  const chat = (p: Intent & { kind: "chat" }) => p
  test.each([
    [
      "a chat at an entry",
      chat({
        kind: "chat",
        text: "x",
        root: TEST_ROOT,
        at: atEntry(entryId("a")),
        mode: "reply",
        lane: null,
        asksAgent: false,
        mentions: [],
        work: null,
        card: null,
        pinned: [],
        reserved: null,
        base: null,
        state: null,
      }),
      [TEST_ROOT],
    ],
    [
      "a chat at the root",
      chat({
        kind: "chat",
        text: "x",
        root: OTHER_ROOT,
        at: ROOT,
        mode: "branch",
        lane: null,
        asksAgent: false,
        mentions: [],
        work: null,
        card: null,
        pinned: [],
        reserved: null,
        base: null,
        state: null,
      }),
      [],
    ],
    ["a name", { kind: "name", name: "Ada" }, []],
    ["a stop", { kind: "stop", lane: laneNameForThread("x") }, []],
    [
      "a carry-on: its lane's root",
      { kind: "carry-on", lane: LANE_X },
      [OTHER_ROOT],
    ],
    [
      "a queue's hold: its lane's root",
      { kind: "queue-hold", lane: LANE_X, held: true },
      [OTHER_ROOT],
    ],
    [
      "unqueue all: its lane's root",
      { kind: "unqueue-all", lane: LANE_X },
      [OTHER_ROOT],
    ],
    [
      "a reorder: the root of the place it names",
      {
        kind: "reorder",
        reorder: {
          card: cardId("c-1"),
          at: {
            kind: "queued",
            root: TEST_ROOT,
            at: atEntry(entryId("a")),
            lane: LANE_X,
            seen: "",
          },
          after: null,
          before: cardId("c-2"),
        },
      },
      [TEST_ROOT],
    ],
    ["a reservation", { kind: "reserve", lane: laneNameForThread("x") }, []],
    [
      "a move on the board",
      {
        kind: "move-root",
        root: TEST_ROOT,
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
      "a mark: its root",
      {
        kind: "mark",
        root: TEST_ROOT,
        entry: entryId("b"),
        title: "Tab names",
      },
      [TEST_ROOT],
    ],
    ["a retitle: its root", { kind: "retitle", root: TEST_ROOT }, [TEST_ROOT]],
    [
      "an offer: its lane's root",
      { kind: "offer", lane: LANE_X, action: "refresh", to: null, seen: null },
      [OTHER_ROOT],
    ],
    [
      "a move into a thread: its root",
      {
        kind: "move",
        moves: [
          {
            card: cardId("c"),
            from: null,
            to: {
              kind: "drafting",
              root: TEST_ROOT,
              at: atEntry(entryId("b")),
              lane: null,
            },
          },
        ],
      },
      [TEST_ROOT],
    ],
    [
      "a pin: the root of the thread it is pinned at",
      {
        kind: "move",
        moves: [
          {
            card: cardId("c"),
            from: {
              kind: "drafting",
              root: TEST_ROOT,
              at: atEntry(entryId("b")),
              lane: null,
            },
            to: {
              kind: "pinned",
              root: TEST_ROOT,
              at: atEntry(entryId("b")),
              lane: null,
            },
          },
        ],
      },
      [TEST_ROOT],
    ],
    [
      "a move into an inventory",
      {
        kind: "move",
        moves: [
          {
            card: cardId("c"),
            from: {
              kind: "drafting",
              root: TEST_ROOT,
              at: atEntry(entryId("b")),
              lane: null,
            },
            to: { kind: "inventory", holder: writerId("ada@x.io") },
          },
        ],
      },
      [],
    ],
    [
      "a keep's moves into a fresh column of each of two roots: both",
      {
        kind: "move",
        moves: [OTHER_ROOT, TEST_ROOT].map(root => ({
          card: cardId(root),
          from: null,
          to: { kind: "fresh", column: "k", root, at: ROOT },
        })),
      },
      [OTHER_ROOT, TEST_ROOT],
    ],
    [
      "an undo of moves: its root",
      { kind: "undo-move", root: OTHER_ROOT, direction: "undo" },
      [OTHER_ROOT],
    ],
  ] satisfies [
    string,
    Intent,
    readonly RootId[],
  ][])("%s", (_, intent, want) => {
    expect(at(intent)).toEqual(want)
  })
})

describe("archivedIn", () => {
  const archive = new Map([[TEST_ROOT, archived(TEST_ROOT)]])
  test("a written root that is archived refuses, by who archived it", () => {
    expect(archivedIn([OTHER_ROOT, TEST_ROOT], archive)).toEqual(
      archived(TEST_ROOT),
    )
  })
  test("roots not archived, and none, do not", () => {
    expect(archivedIn([OTHER_ROOT], archive)).toBeNull()
    expect(archivedIn([], archive)).toBeNull()
  })
})
