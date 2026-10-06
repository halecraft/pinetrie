import { entryId, indexTree, projectRail } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { branchColors, PENDING_TRACK, projectColumns } from "./column-paths.ts"
import { fromParents } from "./fixtures.ts"

/**
 * A tree from `child: parent` pairs. Ids are uuidv7-like: the digit prefix
 * sorts by age, so "2-…" is older than "3-…". Every entry is a chat message.
 */
const tree = (parents: Record<string, string | null>) =>
  fromParents(parents, id => ({ role: "chat", content: id, author: "A" }))

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

describe("projectColumns", () => {
  const i = indexTree(forks)
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
      { anchor: entryId("4-a1") },
      { anchor: entryId("6-b1") },
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
      { anchor: entryId("4-a1") },
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
      { anchor: entryId("8-r1") },
    ])
    expect([c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([null, ["8-r1", "9-r2"]])
  })
  test("an anchored column (fresh, or bound to a lane) ends at its anchor and follows nothing", () => {
    const [, c] = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("2-t2"), anchored: true },
    ])
    expect([c?.tipId, c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([
      "2-t2",
      "2-t2",
      [],
    ])
    // A fresh column at the root: nothing at all, and no fork.
    const [, root] = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: null, anchored: true },
    ])
    expect([root?.tipId, root?.forkFrom, root?.nodes]).toEqual([null, null, []])
  })
})

describe("branchColors", () => {
  const i = indexTree(forks)
  const rail = projectRail(i, entryId("1-t1"))
  test("a column's colour is its last message's track; its fork dot matches", () => {
    const cols = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("4-a1") },
      { anchor: entryId("6-b1") },
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
      { anchor: entryId("2-t2"), anchored: true },
    ])
    expect(branchColors(rail, cols).track).toEqual([0, PENDING_TRACK])
  })
})
