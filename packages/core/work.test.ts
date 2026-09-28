import { describe, expect, test } from "vitest"
import {
  atEntry,
  commitId,
  type EntryLike,
  entryId,
  firstLine,
  foreignRoot,
  indexTree,
  isBusy,
  type LaneName,
  type LaneRecord,
  laneNameForThread,
  nearestRevision,
  promptOf,
  type RevisionRecord,
  ROOT,
  rewritePaths,
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

// Lane A: a person's prompt p1, an assistant message m1 whose tool call wrote
// files (its result r1), then m2, which changed nothing. Its revision records:
// the prompt (the files it started with) and m1 (after its calls).
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
    { entry: entryId("1-p1"), lane: A, commit: C1 },
    { entry: entryId("2-m1"), lane: A, commit: C2 },
    { entry: entryId("6-pb"), lane: B, commit: CB },
    { entry: entryId("8-pd"), lane: D, commit: null },
  ].map(r => [r.entry, r]),
)
const near = (id: string) =>
  nearestRevision(index, revisions, atEntry(entryId(id)))

describe("nearestRevision: the lane and the files above an entry", () => {
  test("an assistant message's own record gives its files", () => {
    expect(near("2-m1")).toEqual({ lane: A, commit: C2 })
  })
  test("a tool result, and a message that changed nothing, have the files above them", () => {
    expect(near("3-r1")).toEqual({ lane: A, commit: C2 })
    expect(near("4-m2")).toEqual({ lane: A, commit: C2 })
  })
  test("a conversation below a lane's message belongs to that lane, with its files", () => {
    expect(near("5-x1")).toEqual({ lane: A, commit: C2 })
  })
  test("a person's prompt gives the files from before the answer", () => {
    expect(near("1-p1")).toEqual({ lane: A, commit: C1 })
  })
  test("a branch lane's prompt claims its own entries, never its parent's", () => {
    expect(near("7-mb")).toEqual({ lane: B, commit: CB })
    expect(near("3-r1").lane).toBe(A)
  })
  test("a lane working directly is the lane above, but passed over for files", () => {
    expect(near("9-md")).toEqual({ lane: D, commit: CB })
  })
  test("nothing above the root, or a conversation no run has reached", () => {
    expect(nearestRevision(index, revisions, ROOT)).toEqual({
      lane: null,
      commit: null,
    })
    expect(nearestRevision(index, new Map(), atEntry(entryId("5-x1")))).toEqual(
      {
        lane: null,
        commit: null,
      },
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
  const workspaces = {
    kind: "workspaces" as const,
    root: "/p",
    rootDefault: "own" as const,
  }
  test("a choice wins over the lane above", () => {
    expect(
      workFor({
        choice: { kind: "direct", dir: "/x" },
        above: A,
        lanes,
        project: workspaces,
      }),
    ).toEqual({ kind: "direct", dir: "/x" })
  })
  test("with no choice, the lane above is inherited, its directory included", () => {
    expect(
      workFor({ choice: null, above: D, lanes, project: workspaces }),
    ).toEqual({
      kind: "direct",
      dir: "/tmp/elsewhere",
    })
  })
  test("with no lane above, the project's default", () => {
    expect(
      workFor({ choice: null, above: null, lanes, project: workspaces }),
    ).toEqual({
      kind: "own",
    })
  })
  test("PINETA_WORKSPACES=0 changes a root lane's default, never what may be chosen", () => {
    const directByDefault = { ...workspaces, rootDefault: "direct" as const }
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
  test("a project with no workspaces makes an own copy work directly in its root", () => {
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

describe("rewritePaths: whole path prefixes only", () => {
  const from = ["/r/workspace/t-a", "/r"]
  const to = "/r/workspace/t-b"
  test("a root followed by a separator, or by a non-path character, is replaced", () => {
    expect(rewritePaths("read /r/workspace/t-a/x.ts", from, to)).toBe(
      "read /r/workspace/t-b/x.ts",
    )
    expect(rewritePaths('{"path":"/r/packages/a.ts"}', from, to)).toBe(
      '{"path":"/r/workspace/t-b/packages/a.ts"}',
    )
    expect(rewritePaths("cd /r && ls", from, to)).toBe(
      "cd /r/workspace/t-b && ls",
    )
  })
  test("never inside a longer name, nor inside a longer path", () => {
    expect(rewritePaths("/r/workspace/t-ab/x", ["/r/workspace/t-a"], to)).toBe(
      "/r/workspace/t-ab/x",
    )
    expect(rewritePaths("/x/r/y", ["/r"], to)).toBe("/x/r/y")
    expect(rewritePaths("/rr/y", ["/r"], to)).toBe("/rr/y")
  })
  test("the longest root wins, so a lane inside the project maps whole", () => {
    expect(rewritePaths("/r/workspace/t-a/f", from, to)).toBe(
      "/r/workspace/t-b/f",
    )
  })
  test("the lane's own paths, inside the project, are left as they are", () => {
    expect(rewritePaths("/r/workspace/t-b/f and /r/g", from, to)).toBe(
      "/r/workspace/t-b/f and /r/workspace/t-b/g",
    )
  })
})

test("foreignRoot: the longest root decides, and the lane's own is never foreign", () => {
  const others = ["/r/workspace/t-a", "/r"]
  const own = "/r/workspace/t-b"
  expect(foreignRoot("/r/workspace/t-b/x.ts", others, own)).toBeNull()
  expect(foreignRoot("/r/workspace/t-a/x.ts", others, own)).toBe(
    "/r/workspace/t-a",
  )
  expect(foreignRoot("/r/packages/x.ts", others, own)).toBe("/r")
  expect(foreignRoot("/elsewhere/x.ts", others, own)).toBeNull()
  expect(foreignRoot("/rr/x.ts", others, own)).toBeNull()
})

test("isBusy: running, or with messages waiting", () => {
  const view = { name: A, tip: null, running: false, waiting: 0, askedBy: null }
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
