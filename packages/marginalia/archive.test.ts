import {
  type ArchiveRecord,
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
  type RootRecord,
  rootIdFor,
  snapshotId,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  ARCHIVE,
  archivedAt,
  archivedIn,
  planArchive,
  writesIn,
} from "./archive.ts"
import { recordsOf, setRecord } from "./records.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const ADA = writerId("p-ada")
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

const record = (
  root: string,
  state: ArchiveRecord["state"] = "archived",
): ArchiveRecord => ({ root: entryId(root), state, by: BEA, at: 1 })

const lane = (tip: string, over: Partial<LaneView> = {}): LaneView => ({
  name: laneNameForThread(tip),
  tip: entryId(tip),
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  ...over,
})

const plan = (
  over: Partial<Parameters<typeof planArchive>[0]> = {},
): ReturnType<typeof planArchive> =>
  planArchive({
    action: "archive",
    root: entryId("r1"),
    by: ADA,
    now: 5,
    index,
    lanes: [],
    archive: new Map(),
    own: [],
    revisions: new Map(),
    ...over,
  })

describe("the record", () => {
  test("round-trips, and a malformed value is dropped", () => {
    const r = record("r1")
    const contents = ARCHIVE.encode(r) as object
    expect(ARCHIVE.decode(contents, r.root)).toEqual(r)
    expect(
      ARCHIVE.decode({ ...contents, state: "gone" }, r.root),
    ).toBeUndefined()
    expect(ARCHIVE.decode(contents, "")).toBeUndefined()
    expect(ARCHIVE.decode("r1", r.root)).toBeUndefined()
  })
  test("records are keyed by their root; a bad one is skipped", () => {
    const map = recordsOf(ARCHIVE, [
      setRecord(ARCHIVE, record("r1")),
      { key: "r3", value: { nope: true } },
      setRecord(ARCHIVE, record("r2", "restored")),
    ])
    expect([...map.keys()]).toEqual(["r1", "r2"])
  })
})

describe("planArchive", () => {
  test("writes the record, by the sender, at now", () => {
    expect(plan()).toEqual({
      kind: "write",
      record: { root: "r1", state: "archived", by: ADA, at: 5 },
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
  test("refuses while the agent works in the root, or messages wait there", () => {
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
  })
  test("work in another root does not stop it, and restoring is never busy", () => {
    expect(plan({ lanes: [lane("c", { running: true })] }).kind).toBe("write")
    expect(
      plan({
        action: "restore",
        lanes: [lane("b", { running: true })],
        archive: new Map([[entryId("r1"), record("r1")]]),
      }),
    ).toMatchObject({ kind: "write", record: { state: "restored" } })
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
          action: "restore",
          archive: new Map([[entryId("r1"), record("r1")]]),
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
  test("the state it already has is unchanged", () => {
    expect(plan({ archive: new Map([[entryId("r1"), record("r1")]]) })).toEqual(
      {
        kind: "unchanged",
      },
    )
    expect(plan({ action: "restore" })).toEqual({ kind: "unchanged" })
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
        reserved: null,
        base: null,
      }),
      TEST_ROOT,
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
        reserved: null,
        base: null,
      }),
      null,
    ],
    ["a name", { kind: "name", name: "Ada" }, null],
    ["a stop", { kind: "stop", lane: laneNameForThread("x") }, null],
    ["a reservation", { kind: "reserve", lane: laneNameForThread("x") }, null],
    [
      "an archive action",
      { kind: "archive", action: "archive", root: entryId("r1") },
      null,
    ],
    [
      "a mark: its root",
      {
        kind: "mark",
        root: TEST_ROOT,
        entry: entryId("b"),
        title: "Tab names",
      },
      TEST_ROOT,
    ],
    [
      "an offer: its lane's root",
      { kind: "offer", lane: LANE_X, action: "refresh", to: null, seen: null },
      OTHER_ROOT,
    ],
    [
      "a move into a thread: its root",
      {
        kind: "move",
        move: {
          card: cardId("c"),
          from: null,
          to: {
            kind: "drafting",
            root: TEST_ROOT,
            at: atEntry(entryId("b")),
            lane: null,
          },
        },
      },
      TEST_ROOT,
    ],
    [
      "a move into an inventory",
      {
        kind: "move",
        move: {
          card: cardId("c"),
          from: {
            kind: "drafting",
            root: TEST_ROOT,
            at: atEntry(entryId("b")),
            lane: null,
          },
          to: { kind: "inventory", holder: writerId("ada@x.io") },
        },
      },
      null,
    ],
  ] satisfies [string, Intent, RootId | null][])("%s", (_, intent, want) => {
    expect(at(intent)).toBe(want)
  })
})

describe("archivedAt", () => {
  const archive = new Map([
    [entryId("r1"), record("r1")],
    [entryId("r2"), record("r2", "restored")],
    [entryId("o"), record("o")],
  ])
  test("an entry in an archived root is refused, by its record", () => {
    expect(archivedAt(index, archive, entryId("b"))).toEqual(record("r1"))
  })
  test("a restored root, a root with no record, and no entry are allowed", () => {
    expect(archivedAt(index, archive, entryId("c"))).toBeNull()
    expect(archivedAt(index, new Map(), entryId("b"))).toBeNull()
    expect(archivedAt(index, archive, null)).toBeNull()
  })
  test("an orphan's tree is judged by the orphan's record", () => {
    expect(archivedAt(index, archive, entryId("d"))).toEqual(record("o"))
  })
})

describe("archivedIn: a root's archive record, found by its root entry", () => {
  const archive = new Map([
    [entryId("r1"), record("r1")],
    [entryId("r2"), record("r2", "restored")],
  ])
  const dir = (root: RootId, entry: string): [RootId, RootRecord] => [
    root,
    {
      root,
      entry: entryId(entry),
      first: entryId(entry),
      firstLine: entry,
      title: null,
      messages: 1,
      newest: entryId(entry),
      writers: [],
      mentions: [],
      images: [],
    },
  ]
  const roots = new Map([dir(TEST_ROOT, "r1"), dir(OTHER_ROOT, "r2")])
  test("an archived root refuses; a restored one, an unknown one and none do not", () => {
    expect(archivedIn(TEST_ROOT, roots, archive)).toEqual(record("r1"))
    expect(archivedIn(OTHER_ROOT, roots, archive)).toBeNull()
    expect(archivedIn(rootIdFor("gone"), roots, archive)).toBeNull()
    expect(archivedIn(null, roots, archive)).toBeNull()
  })
})
