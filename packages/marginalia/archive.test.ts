import {
  type ArchiveRecord,
  atEntry,
  type EntryLike,
  ERR,
  entryId,
  type Intent,
  indexTree,
  type LaneView,
  laneNameForThread,
  type NoteRecord,
  noteId,
  ROOT,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  archivedAt,
  archiveRecords,
  decodeArchive,
  encodeArchive,
  planArchive,
  writesAt,
} from "./archive.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")

const entry = (id: string, parentId: string | null): EntryLike => ({
  id,
  parentId,
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
  tip,
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
    root: "r1",
    by: ADA,
    now: 5,
    index,
    lanes: [],
    archive: new Map(),
    ...over,
  })

describe("the record", () => {
  test("round-trips, and a malformed value is dropped", () => {
    const r = record("r1")
    expect(decodeArchive(encodeArchive(r))).toEqual(r)
    expect(
      decodeArchive({ ...encodeArchive(r), state: "gone" }),
    ).toBeUndefined()
    expect(decodeArchive({ ...encodeArchive(r), root: "" })).toBeUndefined()
    expect(decodeArchive("r1")).toBeUndefined()
  })
  test("records are keyed by their root; a bad one is skipped", () => {
    const map = archiveRecords([
      { value: encodeArchive(record("r1")) },
      { value: { nope: true } },
      { value: encodeArchive(record("r2", "restored")) },
    ])
    expect([...map.keys()]).toEqual(["r1", "r2"])
  })
})

describe("planArchive", () => {
  test("writes the record, by the sender, at now", () => {
    expect(plan()).toEqual({
      kind: "write",
      record: { root: "r1", state: "archived", by: ADA, at: 5 },
    })
  })
  test("refuses an entry that is not a root", () => {
    expect(plan({ root: "a" })).toMatchObject({
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
    })
    expect(plan({ root: "nope" })).toMatchObject({ kind: "refused" })
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
      message: "messages are waiting here",
    })
  })
  test("work in another root does not stop it, and restoring is never busy", () => {
    expect(plan({ lanes: [lane("c", { running: true })] }).kind).toBe("write")
    expect(
      plan({
        action: "restore",
        lanes: [lane("b", { running: true })],
        archive: new Map([["r1", record("r1")]]),
      }),
    ).toMatchObject({ kind: "write", record: { state: "restored" } })
  })
  test("the state it already has is unchanged", () => {
    expect(plan({ archive: new Map([["r1", record("r1")]]) })).toEqual({
      kind: "unchanged",
    })
    expect(plan({ action: "restore" })).toEqual({ kind: "unchanged" })
  })
})

describe("writesAt: the entry a command writes at", () => {
  const opened: NoteRecord = {
    id: noteId("n-2"),
    state: "open",
    entry: entryId("c"),
    openedBy: ADA,
    contributors: [],
    reopened: false,
    changedSinceDone: false,
  }
  const at = (intent: Intent) => writesAt(intent, [opened], [])
  const chat = (p: Intent & { kind: "chat" }) => p
  test.each([
    [
      "a chat at an entry",
      chat({
        kind: "chat",
        text: "x",
        at: atEntry(entryId("a")),
        mode: "reply",
        lane: null,
        asksAgent: false,
        mentions: [],
        work: null,
        card: null,
      }),
      "a",
    ],
    [
      "a chat at the root",
      chat({
        kind: "chat",
        text: "x",
        at: ROOT,
        mode: "branch",
        lane: null,
        asksAgent: false,
        mentions: [],
        work: null,
        card: null,
      }),
      null,
    ],
    [
      "a note opened",
      { kind: "note", action: { kind: "open", entry: entryId("c") } },
      "c",
    ],
    [
      "a note marked done: its message",
      { kind: "note", action: { kind: "done", note: noteId("n-2") } },
      "c",
    ],
    [
      "a note reopened that does not exist",
      { kind: "note", action: { kind: "reopen", note: noteId("n-9") } },
      null,
    ],
    ["a name", { kind: "name", name: "Ada" }, null],
    ["a stop", { kind: "stop", lane: laneNameForThread("x") }, null],
    [
      "an archive action",
      { kind: "archive", action: "archive", root: entryId("r1") },
      null,
    ],
    [
      "a mark: its entry",
      { kind: "mark", entry: entryId("b"), title: "Tab names" },
      "b",
    ],
  ] satisfies [string, Intent, string | null][])("%s", (_, intent, want) => {
    expect(at(intent)).toBe(want)
  })
})

describe("archivedAt", () => {
  const archive = new Map([
    ["r1", record("r1")],
    ["r2", record("r2", "restored")],
    ["o", record("o")],
  ])
  test("an entry in an archived root is refused, by its record", () => {
    expect(archivedAt(index, archive, "b")).toEqual(record("r1"))
  })
  test("a restored root, a root with no record, and no entry are allowed", () => {
    expect(archivedAt(index, archive, "c")).toBeNull()
    expect(archivedAt(index, new Map(), "b")).toBeNull()
    expect(archivedAt(index, archive, null)).toBeNull()
  })
  test("an orphan's tree is judged by the orphan's record", () => {
    expect(archivedAt(index, archive, "d")).toEqual(record("o"))
  })
})
