import { describe, expect, test } from "vitest"
import {
  atEntry,
  commitId,
  type EntryLike,
  entryId,
  firstLine,
  firstPromptOf,
  hostPathInLane,
  indexTree,
  isBusy,
  type LaneName,
  type LaneRecord,
  laneNameForThread,
  nearestRevision,
  promptOf,
  type RevisionRecord,
  ROOT,
  snapshotId,
  turnEntry,
  workFor,
  writerId,
} from "./index.ts"

/** An entry with a role, under `parent`. */
const at = (
  id: string,
  parentId: string | null,
  role: string,
  extra: object = {},
): EntryLike => ({
  id,
  parentId,
  type: "message",
  message: { role, content: id, ...extra },
})

const A = laneNameForThread("a")
const B = laneNameForThread("b")
const D = laneNameForThread("d")
const C1 = commitId("c1")
const C2 = commitId("c2")
const CB = commitId("cb")
const S1 = snapshotId("1-p1")
const S2 = snapshotId("2-m1")
const S4 = snapshotId("4-m2")
const SB = snapshotId("6-pb")

// Lane A: a person's prompt p1, an assistant message m1 whose tool call wrote
// tracked files (its result r1), then m2, whose calls changed only ignored
// files. Its revision records: the prompt (the disk it started with), m1 (a
// commit and a snapshot) and m2 (a snapshot only).
// Below m1: a conversation (x1), and lane B's prompt pb with its answer mb.
// Below mb: lane D, working directly, with its prompt pd and answer md.
const entries: Record<string, EntryLike> = Object.fromEntries(
  [
    at("1-p1", null, "chat"),
    at("2-m1", "1-p1", "assistant", {
      content: [{ type: "toolCall", id: "call-1", name: "write" }],
    }),
    at("3-r1", "2-m1", "toolResult", { toolCallId: "call-1" }),
    at("4-m2", "3-r1", "assistant"),
    at("5-x1", "3-r1", "chat"),
    at("6-pb", "3-r1", "chat"),
    at("7-mb", "6-pb", "assistant"),
    at("8-pd", "7-mb", "chat"),
    at("9-md", "8-pd", "assistant"),
    at("a-ld", "9-md", "land"),
  ].map(e => [e.id, e]),
)
const index = indexTree(entries)
const revisions: ReadonlyMap<string, RevisionRecord> = new Map(
  [
    { entry: entryId("1-p1"), lane: A, commit: C1, snapshot: S1 },
    { entry: entryId("2-m1"), lane: A, commit: C2, snapshot: S2 },
    { entry: entryId("4-m2"), lane: A, commit: null, snapshot: S4 },
    { entry: entryId("6-pb"), lane: B, commit: CB, snapshot: SB },
    { entry: entryId("8-pd"), lane: D, commit: null, snapshot: null },
  ].map(r => [r.entry, r]),
)
const near = (id: string) =>
  nearestRevision(index, revisions, atEntry(entryId(id)))

describe("firstPromptOf: a lane's own first prompt (ADR-0039)", () => {
  test("a branch's first prompt is its own, below its parent's", () => {
    expect(firstPromptOf(index, revisions, B, "7-mb")).toBe("6-pb")
    expect(firstPromptOf(index, revisions, D, "a-ld")).toBe("8-pd")
  })
  test("the root lane's first prompt is the root's", () => {
    expect(firstPromptOf(index, revisions, A, "4-m2")).toBe("1-p1")
  })
  test("no run of the lane on the path, or no tip: none", () => {
    expect(firstPromptOf(index, revisions, B, "4-m2")).toBeNull()
    expect(firstPromptOf(index, revisions, B, null)).toBeNull()
  })
})

describe("nearestRevision: the lane, commit and disk above an entry", () => {
  test("an assistant message's own record gives its commit and disk", () => {
    expect(near("2-m1")).toEqual({ lane: A, commit: C2, snapshot: S2 })
  })
  test("a tool result has the record above it", () => {
    expect(near("3-r1")).toEqual({ lane: A, commit: C2, snapshot: S2 })
  })
  test("a turn that changed only ignored files: its disk, and the commit above", () => {
    expect(near("4-m2")).toEqual({ lane: A, commit: C2, snapshot: S4 })
  })
  test("a conversation below a lane's message belongs to that lane", () => {
    expect(near("5-x1")).toEqual({ lane: A, commit: C2, snapshot: S2 })
  })
  test("a person's prompt gives the disk from before the answer", () => {
    expect(near("1-p1")).toEqual({ lane: A, commit: C1, snapshot: S1 })
  })
  test("a branch lane's prompt claims its own entries, never its parent's", () => {
    expect(near("7-mb")).toEqual({ lane: B, commit: CB, snapshot: SB })
    expect(near("3-r1").lane).toBe(A)
  })
  test("a lane working directly is the lane above, but passed over for commit and disk", () => {
    expect(near("9-md")).toEqual({ lane: D, commit: CB, snapshot: SB })
  })
  test("a record from before lane containers has a commit and no disk", () => {
    const old = new Map([
      ["1-p1", { entry: entryId("1-p1"), lane: A, commit: C1, snapshot: null }],
    ])
    expect(nearestRevision(index, old, atEntry(entryId("3-r1")))).toEqual({
      lane: A,
      commit: C1,
      snapshot: null,
    })
  })
  test("nothing above the root, or a conversation no run has reached", () => {
    const none = { lane: null, commit: null, snapshot: null }
    expect(nearestRevision(index, revisions, ROOT)).toEqual(none)
    expect(nearestRevision(index, new Map(), atEntry(entryId("5-x1")))).toEqual(
      none,
    )
  })
})

describe("workFor: the choice, then the lane above, then the project's default", () => {
  const record = (lane: LaneName, work: LaneRecord["work"]): LaneRecord => ({
    lane,
    work,
    by: writerId("x"),
    createdAt: 0,
  })
  const lanes = new Map([
    [A, record(A, { kind: "own" })],
    [D, record(D, { kind: "direct", dir: "/tmp/elsewhere" })],
  ])
  const lanesProject = {
    kind: "lanes" as const,
    root: "/p",
    rootDefault: "own" as const,
  }
  test("a choice wins over the lane above", () => {
    expect(
      workFor({
        choice: { kind: "direct", dir: "/x" },
        above: A,
        lanes,
        project: lanesProject,
      }),
    ).toEqual({ kind: "direct", dir: "/x" })
  })
  test("with no choice, the lane above is inherited, its directory included", () => {
    expect(
      workFor({ choice: null, above: D, lanes, project: lanesProject }),
    ).toEqual({
      kind: "direct",
      dir: "/tmp/elsewhere",
    })
  })
  test("with no lane above, the project's default", () => {
    expect(
      workFor({ choice: null, above: null, lanes, project: lanesProject }),
    ).toEqual({
      kind: "own",
    })
  })
  test("PINETA_LANES=0 changes a root lane's default, never what may be chosen", () => {
    const directByDefault = { ...lanesProject, rootDefault: "direct" as const }
    expect(
      workFor({ choice: null, above: null, lanes, project: directByDefault }),
    ).toEqual({ kind: "direct", dir: "/p" })
    expect(
      workFor({
        choice: { kind: "own" },
        above: null,
        lanes,
        project: directByDefault,
      }),
    ).toEqual({ kind: "own" })
    expect(
      workFor({ choice: null, above: A, lanes, project: directByDefault }),
    ).toEqual({
      kind: "own",
    })
  })
  test("a project with no lanes of their own makes an own copy work directly in its root", () => {
    const direct = { kind: "direct" as const, root: "/p", reason: "no git" }
    expect(
      workFor({ choice: { kind: "own" }, above: A, lanes, project: direct }),
    ).toEqual({
      kind: "direct",
      dir: "/p",
    })
  })
  test("no project: the host has no tools", () => {
    expect(workFor({ choice: null, above: A, lanes, project: null })).toBeNull()
  })
})

describe("a turn's entry, and a run's prompt", () => {
  test("turnEntry: from a tool result, the message that made the call; else the entry", () => {
    expect(turnEntry(index, "3-r1")).toBe("2-m1")
    expect(turnEntry(index, "1-p1")).toBe("1-p1")
    expect(turnEntry(index, "4-m2")).toBe("4-m2")
  })
  test("promptOf: the nearest person's, user or land message at or above", () => {
    expect(promptOf(index, "4-m2")).toBe("1-p1")
    expect(promptOf(index, "9-md")).toBe("8-pd")
    expect(promptOf(index, "a-ld")).toBe("a-ld")
    expect(promptOf(index, null)).toBeNull()
  })
})

test("isBusy: running, or with messages waiting", () => {
  const view = {
    name: A,
    tip: null,
    running: false,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
  }
  expect(isBusy(view)).toBe(false)
  expect(isBusy({ ...view, running: true })).toBe(true)
  expect(isBusy({ ...view, waiting: 1 })).toBe(true)
})

test("firstLine: the first non-empty line, cut with an ellipsis only when longer", () => {
  expect(firstLine("\n  Plan the release \nand more", 40)).toBe(
    "Plan the release",
  )
  expect(firstLine("abcdef", 3)).toBe("abc…")
  expect(firstLine("abc", 3)).toBe("abc")
  expect(firstLine("  \n ", 3)).toBe("")
})

test("hostPathInLane: a granted host path sits under /mnt/host at its own path", () => {
  expect(hostPathInLane("/Users/ada/skills/plan")).toBe(
    "/mnt/host/Users/ada/skills/plan",
  )
})
