import {
  type ArchivedCanvas,
  type CanvasId,
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  type EntryLike,
  ERR,
  entryId,
  type Gated,
  indexTree,
  type LaneView,
  NO_CONTENT,
  pointId,
  type RevisionRecord,
  rootIdFor,
  type Send,
  snapshotId,
  textCardId,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor, FIXTURE_THREAD } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { archivedIn, planArchive, planLanesGone, writesIn } from "./archive.ts"
import { indexCanvases } from "./canvas-index.ts"
import { landedThreadCard } from "./fixtures.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const OTHER_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const OTHER_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000b")

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

const archived = (canvas: CanvasId): ArchivedCanvas => ({
  canvas,
  by: BEA,
  at: 1,
})

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

/** The canvas's thread: `mine`; `theirs`, below, is another canvas's, in the same root. */
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
    verdicts: new Map(),
    ...over,
  })

describe("planArchive", () => {
  test("archiving tears down", () => {
    expect(plan()).toEqual({
      kind: "cross",
      teardown: { forget: [], refs: [], snapshots: [] },
      verdicts: [],
    })
  })
  test("archiving settles its threads' pending verdicts as unclassified; another canvas's stay pending", () => {
    const verdict = (name: string, kind: "pending" | "unclassified") => ({
      lane: threadIdFor(name),
      ask: entryId("a"),
      end: entryId("b"),
      verdict: { kind },
    })
    const verdicts = new Map(
      [verdict("mine", "pending"), verdict("theirs", "pending")].map(v => [
        v.lane,
        v,
      ]),
    )
    expect(plan({ verdicts })).toMatchObject({
      verdicts: [verdict("mine", "unclassified")],
    })
    expect(plan({ verdicts, crossing: "restore" })).toMatchObject({
      verdicts: [],
    })
  })
  test("refuses while an agent of its threads works, or cards wait there, held or not", () => {
    expect(plan({ lanes: [lane("mine", { running: true })] })).toEqual({
      kind: "refused",
      code: ERR.CANVAS_BUSY,
      message: "an agent is working here",
    })
    expect(plan({ lanes: [lane("mine", { waiting: 1 })] })).toEqual({
      kind: "refused",
      code: ERR.CANVAS_BUSY,
      message: "cards are queued here",
    })
    expect(
      plan({ lanes: [lane("mine", { waiting: 1, heldBy: BEA })] }),
    ).toEqual({
      kind: "refused",
      code: ERR.CANVAS_BUSY,
      message: "cards are queued here",
    })
  })
  test("work in another canvas's thread does not stop it, even in the same root; restoring is never busy", () => {
    expect(plan({ lanes: [lane("theirs", { running: true })] }).kind).toBe(
      "cross",
    )
    expect(
      plan({ crossing: "restore", lanes: [lane("mine", { running: true })] }),
    ).toMatchObject({ kind: "cross" })
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
      point: commit === null ? null : pointId(commit),
      snapshot: snapshot === null ? null : snapshotId(snapshot),
      paths: [],
      conflicts: [],
      disk: null,
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
            { lane: A, point: null },
            { lane: B, point: null },
          ],
          snapshots: ["s-a1"],
        },
      })
    })
    test("archive keeps the snapshot nearest each thread's end, a copy's files", () => {
      // A chat from `a`, which A's turn there recorded.
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
          refs: [{ lane: A, point: "c0000000-0000-7000-8000-00000000000a" }],
          snapshots: [],
        },
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

describe("writesIn: the canvases a command writes in", () => {
  // LANE_X's card is on OTHER_CANVAS, T_B's on CANVAS.
  const cards: CardRecord[] = [
    landedThreadCard({
      thread: LANE_X,
      canvas: OTHER_CANVAS,
      by: BEA,
      cards: [],
    }),
    landedThreadCard({ thread: T_B, canvas: CANVAS, by: BEA, cards: [] }),
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
      place: { kind: "canvas", canvas: OTHER_CANVAS, order: "z", width: 1 },
      content: NO_CONTENT,
    },
  ]
  const canvases = indexCanvases(cards, new Map())
  const at = (intent: Gated) => writesIn(intent, canvases, cards)
  const said = (p: Send) => p
  const atB = {
    kind: "composing",
    thread: T_B,
  } as const
  test.each([
    [
      "a chat at a thread's end: the thread's canvas",
      said({
        kind: "send",
        text: "x",
        root: TEST_ROOT,
        at: { kind: "end", thread: T_B, seen: entryId("b") },
        mentions: [],
        card: null,
        pinned: [],
        base: null,
        state: null,
      }),
      [CANVAS],
    ],
    [
      "a branch: the canvas its card goes in",
      said({
        kind: "send",
        text: "x",
        root: OTHER_ROOT,
        at: {
          kind: "branch",
          thread: threadIdFor("new"),
          at: null,
          canvas: OTHER_CANVAS,
        },
        mentions: [],
        card: null,
        pinned: [],
        base: null,
        state: null,
      }),
      [OTHER_CANVAS],
    ],
    [
      "a popped send: its thread's canvas",
      said({
        kind: "send",
        text: "x",
        root: TEST_ROOT,
        at: { kind: "queue", thread: T_B },
        mentions: [],
        card: null,
        pinned: [],
        base: null,
        state: null,
      }),
      [CANVAS],
    ],
    ["a name", { kind: "name", name: "Ada" }, []],
    ["a stop", { kind: "stop", lane: LANE_X }, []],
    [
      "a carry-on: its lane's canvas",
      { kind: "carry-on", lane: LANE_X },
      [OTHER_CANVAS],
    ],
    [
      "a queue's hold: its lane's canvas",
      { kind: "queue-hold", lane: LANE_X, held: true },
      [OTHER_CANVAS],
    ],
    [
      "unqueue all: its lane's canvas",
      { kind: "unqueue-all", lane: LANE_X },
      [OTHER_CANVAS],
    ],
    [
      "a reorder: the canvas of the place it names",
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
      [OTHER_CANVAS],
    ],
    ["a reservation", { kind: "reserve", lane: threadIdFor("x") }, []],
    [
      "a copy: the canvas its card lands in, never its source's, which may be archived",
      {
        kind: "copy-thread",
        source: LANE_X,
        end: entryId("b"),
        move: {
          card: threadIdFor("copy"),
          from: null,
          to: { kind: "canvas-at", canvas: CANVAS, after: null },
        },
      },
      [CANVAS],
    ],
    [
      "a move on the board: none, so an archived canvas can be restored",
      {
        kind: "move-canvas",
        canvas: CANVAS,
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
      "a mark: its canvas",
      {
        kind: "mark",
        of: { kind: "canvas", canvas: CANVAS },
        title: "Tab names",
      },
      [CANVAS],
    ],
    [
      "a note column's title: its column's canvas",
      {
        kind: "mark",
        of: { kind: "note-column", column: NOTES_X },
        title: "Ideas",
      },
      [OTHER_CANVAS],
    ],
    ["a retitle: its canvas", { kind: "retitle", canvas: CANVAS }, [CANVAS]],
    [
      "proposed changes: its lane's canvas",
      {
        kind: "proposed",
        lane: LANE_X,
        action: "refresh",
        to: null,
        seen: null,
      },
      [OTHER_CANVAS],
    ],
    [
      "a card made at a thread: its canvas",
      {
        kind: "move",
        moves: [{ card: textCardId("c"), from: null, to: atB }],
        here: null,
      },
      [CANVAS],
    ],
    [
      "a move out of a canvas, into an inventory: the canvas it leaves",
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
      [CANVAS],
    ],
    [
      "a thread opened: the canvas its card lands in",
      {
        kind: "open-thread",
        thread: threadIdFor("new"),
        root: TEST_ROOT,
        canvas: OTHER_CANVAS,
        start: { kind: "new-root", after: null },
      },
      [OTHER_CANVAS],
    ],
    [
      "an undo of moves outside any canvas: none",
      { kind: "undo-move", canvas: null, direction: "undo" },
      [],
    ],
    [
      "an undo of moves: its canvas",
      { kind: "undo-move", canvas: OTHER_CANVAS, direction: "undo" },
      [OTHER_CANVAS],
    ],
  ] satisfies [string, Gated, readonly CanvasId[]][])(
    "%s",
    (_, intent, want) => {
      expect(at(intent)).toEqual(want)
    },
  )
})

describe("archivedIn", () => {
  const archive = new Map([[CANVAS, archived(CANVAS)]])
  test("a written canvas that is archived refuses, by who archived it", () => {
    expect(archivedIn([OTHER_CANVAS, CANVAS], archive)).toEqual(
      archived(CANVAS),
    )
  })
  test("canvases not archived, and none, do not", () => {
    expect(archivedIn([OTHER_CANVAS], archive)).toBeNull()
    expect(archivedIn([], archive)).toBeNull()
  })
})

test("planLanesGone: a deleted thread's lanes forgotten, their refs deleted, no snapshot kept with no revision", () => {
  expect(planLanesGone([LANE_X], new Map(), [])).toEqual({
    forget: [LANE_X],
    refs: [{ lane: LANE_X, point: null }],
    snapshots: [],
  })
  expect(planLanesGone([], new Map(), [])).toEqual({
    forget: [],
    refs: [],
    snapshots: [],
  })
})
