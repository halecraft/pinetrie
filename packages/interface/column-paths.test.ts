import {
  canvasIdFor,
  entryId,
  type ThreadId,
  threadIdFor,
} from "@pinetrie/core"
import {
  entryThread,
  indexTree,
  projectRail,
  threadEnd,
} from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import {
  branchColors,
  PENDING_TRACK,
  projectColumns,
  threadTrack,
  trackIndex,
} from "./column-paths.ts"
import {
  entriesById,
  entry,
  fromParents,
  personMessage,
  threadOfEntry,
} from "./fixtures.ts"

/**
 * A tree from `child: parent` pairs. Ids are uuidv7-like: the digit prefix
 * sorts by age, so "2-…" is older than "3-…". Every entry is a chat message.
 */
const tree = (parents: Record<string, string | null>) =>
  fromParents(parents, id => personMessage(id, { author: "A" }))

// An example: a trunk T1 -> T2 -> T3, a branch A off T1, a branch B off
// T2. The trunk's continuation is older than each branch.
const forks = tree({
  "1-t1": null,
  "2-t2": "1-t1",
  "3-t3": "2-t2",
  "4-a1": "1-t1",
  "5-a2": "4-a1",
  "6-b1": "2-t2",
  "7-b2": "6-b1",
})
const ids = (nodes: readonly { id: string }[]) => nodes.map(n => n.id)

describe("projectColumns", () => {
  const i = indexTree(forks)
  test("over two roots: each tree's shared part shown once, the trees apart", () => {
    const two = indexTree(
      tree({
        "1-t1": null,
        "2-t2": "1-t1",
        "3-t3": "2-t2",
        "6-b1": "2-t2",
        "7-b2": "6-b1",
        "8-r2": null,
        "9-c1": "8-r2",
      }),
    )
    const [t, other, b] = projectColumns(two, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("9-c1") },
      { anchor: entryId("7-b2") },
    ])
    expect(ids(t?.nodes ?? [])).toEqual(["1-t1", "2-t2", "3-t3"])
    expect([other?.forkFrom, ids(other?.nodes ?? [])]).toEqual([
      null,
      ["8-r2", "9-c1"],
    ])
    expect([b?.forkFrom, ids(b?.nodes ?? [])]).toEqual([
      "2-t2",
      ["6-b1", "7-b2"],
    ])
  })
  test("a column whose parent thread is on no column folds its path above its first message", () => {
    const [b] = projectColumns(i, [
      { anchor: entryId("7-b2"), foldAbove: threadOfEntry("6-b1") },
    ])
    expect([ids(b?.above ?? []), ids(b?.nodes ?? [])]).toEqual([
      ["1-t1", "2-t2"],
      ["6-b1", "7-b2"],
    ])
    const [, shared] = projectColumns(i, [
      { anchor: entryId("5-a2") },
      { anchor: entryId("7-b2"), foldAbove: threadOfEntry("6-b1") },
    ])
    expect([shared?.forkFrom, ids(shared?.above ?? [])]).toEqual(["1-t1", []])
  })
  test("a branch not yet sent from a thread in someone else's inventory leaves that thread's entries out", () => {
    const inInventory = entryThread(i, entryId("6-b1"))
    expect(inInventory).not.toBeNull()
    const [c] = projectColumns(i, [
      {
        anchor: entryId("7-b2"),
        ...(inInventory === null ? {} : { hide: inInventory }),
      },
    ])
    expect(ids(c?.nodes ?? [])).toEqual(["1-t1", "2-t2"])
  })
  test("a first column is its whole path", () => {
    const [c] = projectColumns(i, [{ anchor: entryId("3-t3") }])
    expect([c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([
      null,
      ["1-t1", "2-t2", "3-t3"],
    ])
  })
  test("a branch starts after the deepest message it shares with ANY column to its left", () => {
    const [, a, b] = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("5-a2") },
      { anchor: entryId("7-b2") },
    ])
    expect([a?.forkFrom, ids(a?.nodes ?? [])]).toEqual([
      "1-t1",
      ["4-a1", "5-a2"],
    ])
    // B shares only T1 with its neighbour A, but T2 with the trunk.
    expect([b?.forkFrom, ids(b?.nodes ?? [])]).toEqual([
      "2-t2",
      ["6-b1", "7-b2"],
    ])
  })
  test("making a branch main recomputes every fork point", () => {
    const [a, trunk] = projectColumns(i, [
      { anchor: entryId("5-a2") },
      { anchor: entryId("3-t3") },
    ])
    expect(ids(a?.nodes ?? [])).toEqual(["1-t1", "4-a1", "5-a2"])
    expect([trunk?.forkFrom, ids(trunk?.nodes ?? [])]).toEqual([
      "1-t1",
      ["2-t2", "3-t3"],
    ])
  })
  test("a column on another root shares nothing: no fork, its full path", () => {
    const other = indexTree({
      ...forks,
      ...tree({ "8-r1": null, "9-r2": "8-r1" }),
    })
    const [, c] = projectColumns(other, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("9-r2") },
    ])
    expect([c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([null, ["8-r1", "9-r2"]])
  })
  test("a column ends at its anchor: an unstarted thread's column has nothing of its own", () => {
    const [, c] = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("2-t2") },
    ])
    expect([c?.tipId, c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([
      "2-t2",
      "2-t2",
      [],
    ])
    // A new canvas's thread, at the root: nothing at all, and no fork.
    const [, root] = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: null },
    ])
    expect([root?.tipId, root?.forkFrom, root?.nodes]).toEqual([null, null, []])
  })
})

describe("a branch whose first entry is a context entry no column draws", () => {
  // Under 2-t2, branch B's first run wrote its canvas entry, then its prompt;
  // then the trunk's next run wrote its own canvas entry, prompt and reply.
  const T = threadIdFor("t")
  const B = threadIdFor("b")
  const canvas = (id: string, parent: string, thread: ThreadId) =>
    entry(
      id,
      parent,
      {
        role: "canvas",
        content: "",
        canvas: { canvas: canvasIdFor("c"), title: "c", lines: [], more: 0 },
      },
      { thread },
    )
  const said = (id: string, parent: string | null, thread: ThreadId) =>
    entry(id, parent, personMessage(id, { author: "A" }), { thread })
  const i = indexTree(
    entriesById([
      said("1-t1", null, T),
      said("2-t2", "1-t1", T),
      canvas("3-cb", "2-t2", B),
      said("4-b1", "3-cb", B),
      canvas("5-ct", "2-t2", T),
      said("6-t3", "5-ct", T),
      said("7-t4", "6-t3", T),
    ]),
  )
  test("the trunk's column runs to its own end, with only the branch as a closed branch", () => {
    const end = threadEnd(i, T)
    expect(end).toBe("7-t4")
    const [trunk] = projectColumns(i, [{ anchor: end }])
    expect(ids(trunk?.nodes ?? [])).toEqual(["1-t1", "2-t2", "6-t3", "7-t4"])
    const at = trunk?.nodes.find(n => n.id === "2-t2")
    expect(at?.branches).toEqual([{ rootId: "3-cb", messageCount: 1 }])
  })
  test("its column, its parent on no column, folds the path above its first message", () => {
    const [b] = projectColumns(i, [{ anchor: threadEnd(i, B), foldAbove: B }])
    expect([ids(b?.above ?? []), ids(b?.nodes ?? [])]).toEqual([
      ["1-t1", "2-t2"],
      ["4-b1"],
    ])
  })
})

describe("branchColors", () => {
  const i = indexTree(forks)
  const rail = trackIndex(projectRail(i, entryId("1-t1")))
  test("a column's colour is its last message's track; its fork dot matches", () => {
    const cols = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("5-a2") },
      { anchor: entryId("7-b2") },
    ])
    const c = branchColors(rail, cols)
    expect(c.track).toEqual([0, 1, 2])
    expect([...c.forks]).toEqual([
      ["1-t1", [1]],
      ["2-t2", [2]],
    ])
  })
  test("a fresh branch is pending until it has a message", () => {
    const cols = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("2-t2") },
    ])
    expect(branchColors(rail, cols).track).toEqual([0, PENDING_TRACK])
  })
  test("a folded strip ending where a column ends takes its colour", () => {
    const cols = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("7-b2") },
    ])
    const strips = [
      threadTrack(rail, entryId("3-t3")),
      threadTrack(rail, entryId("7-b2")),
    ]
    expect(strips).toEqual([0, 2])
    expect(strips).toEqual(branchColors(rail, cols).track)
  })
  test("a strip whose end is not on the rail, or has none, is pending", () => {
    expect(threadTrack(rail, entryId("nowhere"))).toBe(PENDING_TRACK)
    expect(threadTrack(rail, null)).toBe(PENDING_TRACK)
  })
})
