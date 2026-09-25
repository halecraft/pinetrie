import { describe, expect, test } from "vitest"
import {
  agentActivity,
  ancestry,
  branchColors,
  type EntryLike,
  followTip,
  indexTree,
  PENDING_TRACK,
  projectColumns,
  projectRail,
} from "./index.ts"

/**
 * A tree from `child: parent` pairs. Ids are uuidv7-like: the digit prefix
 * sorts by age, so "2-…" is older than "3-…". Every entry is a chat message.
 */
const tree = (
  parents: Record<string, string | null>,
): Record<string, EntryLike> =>
  Object.fromEntries(
    Object.entries(parents).map(([id, parentId]) => [
      id,
      {
        id,
        parentId,
        type: "message",
        message: { role: "chat", content: id, author: "A" },
      },
    ]),
  )

// The plan's example: a trunk T1 -> T2 -> T3, a branch A off T1, a branch B off
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

describe("indexTree and ancestry", () => {
  test("children are sorted by id, whatever the insertion order", () => {
    const shuffled = Object.fromEntries(Object.entries(forks).toReversed())
    expect(indexTree(shuffled).childrenOf.get("1-t1")).toEqual(["2-t2", "4-a1"])
  })
  test("roots, orphans and leaves are reported", () => {
    const i = indexTree({
      ...forks,
      ...tree({ "9-x": "missing", "8-r": null }),
    })
    expect([i.roots, i.orphans]).toEqual([["1-t1", "8-r"], ["9-x"]])
    expect(i.leaves).toEqual(["3-t3", "5-a2", "7-b2", "8-r", "9-x"])
  })
  test("a cycle stops ancestry and is reported", () => {
    const cyclic = tree({ x: "y", y: "x" })
    expect(ancestry(indexTree(cyclic), "x")).toEqual({
      path: ["x", "y"],
      cycleAt: "x",
    })
  })
})

describe("followTip: the view follows the thread you are reading", () => {
  const entries = tree({
    "1-a1": null,
    "2-a2": "1-a1",
    "3-b2": "1-a1",
    "4-a3": "2-a2",
  })
  test("follows a newer reply below what you read, whichever lane wrote it", () => {
    expect(followTip(indexTree(entries), "2-a2")).toBe("4-a3")
  })
  test("never jumps to a branch that is not below you", () => {
    const newer = { ...entries, ...tree({ "5-b3": "3-b2" }) }
    expect(followTip(indexTree(newer), "2-a2")).toBe("4-a3")
  })
  test("with nothing chosen, follows the newest leaf overall", () => {
    expect(followTip(indexTree(entries), null)).toBe("4-a3")
  })
  test("a cycle stops the walk rather than spinning", () => {
    expect(followTip(indexTree(tree({ w: "x", x: "y", y: "x" })), "z")).toBe(
      "z",
    )
  })
  test("walking down from an entry on a cycle ends", () => {
    // Going down, a cycle is reachable only from inside it: each entry has one
    // parent, so no chain leaves a cycle to reach it from outside.
    // Every entry on a cycle has a child, so there is no leaf below: `at` stands.
    expect(followTip(indexTree(tree({ x: "y", y: "x" })), "x")).toBe("x")
  })
  test("a fresh branch stays at its anchor until a new child exists", () => {
    const i = indexTree(entries)
    expect(followTip(i, "1-a1", ["2-a2", "3-b2"])).toBe("1-a1")
    const grown = indexTree({
      ...entries,
      ...tree({ "6-n1": "1-a1", "7-n2": "6-n1" }),
    })
    expect(followTip(grown, "1-a1", ["2-a2", "3-b2"])).toBe("7-n2")
  })
})

describe("projectColumns", () => {
  const i = indexTree(forks)
  test("a first column is its whole path", () => {
    const [c] = projectColumns(i, [{ anchor: "3-t3" }])
    expect([c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([
      null,
      ["1-t1", "2-t2", "3-t3"],
    ])
  })
  test("a branch starts after the deepest message it shares with ANY column to its left", () => {
    const [, a, b] = projectColumns(i, [
      { anchor: "3-t3" },
      { anchor: "4-a1" },
      { anchor: "6-b1" },
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
      { anchor: "4-a1" },
      { anchor: "3-t3" },
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
      { anchor: "3-t3" },
      { anchor: "8-r1" },
    ])
    expect([c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([null, ["8-r1", "9-r2"]])
  })
  test("a fresh branch has no messages and forks from its anchor", () => {
    const [, c] = projectColumns(i, [
      { anchor: "3-t3" },
      { anchor: "2-t2", exclude: ["3-t3", "6-b1"] },
    ])
    expect([c?.forkFrom, ids(c?.nodes ?? [])]).toEqual(["2-t2", []])
  })
})

describe("projectRail", () => {
  const rows = projectRail(indexTree(forks))
  const trackOf = (id: string) => rows.find(r => r.id === id)?.track
  test("the oldest child continues its parent's track; a younger one takes a new track", () => {
    expect([trackOf("1-t1"), trackOf("2-t2"), trackOf("3-t3")]).toEqual([
      0, 0, 0,
    ])
    expect(trackOf("4-a1")).toBe(1)
    expect(trackOf("6-b1")).toBe(2)
  })
  test("rows are depth-first, children in id order, each with its parent's track", () => {
    expect(ids(rows)).toEqual([
      "1-t1",
      "2-t2",
      "3-t3",
      "6-b1",
      "7-b2",
      "4-a1",
      "5-a2",
    ])
    expect(rows.find(r => r.id === "6-b1")).toMatchObject({
      parentId: "2-t2",
      parentTrack: 0,
    })
  })
  test("the same entries in another insertion order give the same rows", () => {
    const shuffled = Object.fromEntries(Object.entries(forks).toReversed())
    expect(projectRail(indexTree(shuffled))).toEqual(rows)
  })
  test("each root starts a track, reusing tracks its predecessors freed", () => {
    const two = projectRail(indexTree({ ...forks, ...tree({ "8-r1": null }) }))
    expect(two.find(r => r.id === "8-r1")).toMatchObject({
      track: 0,
      parentId: null,
    })
  })
  test("a non-message entry has no row; its child attaches to the message above", () => {
    const withCompaction = {
      ...forks,
      "8-c": { id: "8-c", parentId: "3-t3", type: "compaction" },
      ...tree({ "9-after": "8-c" }),
    }
    const r = projectRail(indexTree(withCompaction))
    expect(r.some(x => x.id === "8-c")).toBe(false)
    expect(r.find(x => x.id === "9-after")).toMatchObject({
      parentId: "3-t3",
      track: 0,
    })
  })
})

describe("colour and the agent", () => {
  const i = indexTree(forks)
  const rail = projectRail(i)
  test("a column's colour is its last message's track; its fork dot matches", () => {
    const cols = projectColumns(i, [
      { anchor: "3-t3" },
      { anchor: "4-a1" },
      { anchor: "6-b1" },
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
      { anchor: "3-t3" },
      { anchor: "2-t2", exclude: ["3-t3", "6-b1"] },
    ])
    expect(branchColors(rail, cols).track).toEqual([0, PENDING_TRACK])
  })
  test("the agent is idle unless running with a tip; replying reads its path", () => {
    expect(agentActivity(i, "5-a2", false)).toEqual({ kind: "idle" })
    const a = agentActivity(i, "5-a2", true)
    expect(a.kind === "replying" ? [...a.path] : []).toEqual([
      "5-a2",
      "4-a1",
      "1-t1",
    ])
  })
})
