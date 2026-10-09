// The spine: the tip path, plus the branches that leave it.
//
// A linear fixture cannot test this. With one child per node the spine is a
// straight line and every assertion passes vacuously, so the fork cases carry
// the weight.

import { describe, expect, test } from "vitest"
import { entriesOf, entry } from "./fixtures.ts"
import { entryId, indexTree, projectSpine, projectTranscript } from "./index.ts"

const msg = (id: string, parentId: string | null, text: string) =>
  entry(id, parentId, {
    role: id.startsWith("a") ? "assistant" : "user",
    content: text,
  })

/** A chain a -> b -> c, with d and e forking off b. */
const forked = entriesOf([
  msg("a1", null, "root"),
  msg("b1", "a1", "trunk one"),
  msg("c1", "b1", "trunk two"),
  msg("d1", "b1", "aside one"),
  msg("e1", "d1", "aside two"),
])

describe("projectSpine", () => {
  test("a linear chain has a spine and no branches", () => {
    const linear = entriesOf([
      msg("a1", null, "root"),
      msg("b1", "a1", "trunk one"),
      msg("c1", "b1", "trunk two"),
    ])
    const { spine, orphans, cycles } = projectSpine(
      indexTree(linear),
      entryId("c1"),
    )
    expect(spine.map(n => n.id)).toEqual(["a1", "b1", "c1"])
    expect(spine.every(n => n.branches.length === 0)).toBe(true)
    expect([orphans, cycles]).toEqual([[], []])
  })

  test("the spine equals projectTranscript; branches are the extra", () => {
    // The two projections must never disagree about what is on the path.
    const { spine } = projectSpine(indexTree(forked), entryId("c1"))
    expect(
      spine.map(n => ({
        id: n.id,
        thread: n.thread,
        role: n.role,
        text: n.text,
      })),
    ).toEqual(projectTranscript(indexTree(forked), entryId("c1")))
  })

  test("a fork appears as a branch on its parent, not on the spine", () => {
    const { spine } = projectSpine(indexTree(forked), entryId("c1"))
    expect(spine.map(n => n.id)).toEqual(["a1", "b1", "c1"])
    const b1 = spine.find(n => n.id === "b1")
    expect(b1?.branches.map(b => b.rootId)).toEqual(["d1"])
    expect(spine.flatMap(n => n.branches).map(b => b.rootId)).not.toContain(
      "c1",
    )
  })

  test("messageCount covers the whole subtree, not just its root", () => {
    const { spine } = projectSpine(indexTree(forked), entryId("c1"))
    const branch = spine.find(n => n.id === "b1")?.branches[0]
    expect(branch?.messageCount).toBe(2) // d1 and e1
  })

  test("branches sort by ascending rootId, not insertion order", () => {
    const many = entriesOf([
      msg("a1", null, "root"),
      msg("b1", "a1", "trunk"),
      msg("z9", "a1", "z"),
      msg("m5", "a1", "m"),
      msg("c3", "a1", "c"),
    ])
    const { spine } = projectSpine(indexTree(many), entryId("b1"))
    expect(spine.find(n => n.id === "a1")?.branches.map(b => b.rootId)).toEqual(
      ["c3", "m5", "z9"],
    )
  })

  test("an orphan parent is reported, not silently dropped", () => {
    const orphaned = entriesOf([
      msg("a1", null, "root"),
      msg("x1", "missing", "lost"),
    ])
    const { orphans } = projectSpine(indexTree(orphaned), entryId("a1"))
    expect(orphans).toEqual(["x1"])
  })

  test("a cycle is reported and the walk terminates", () => {
    const cyclic = entriesOf([msg("p", "q", "p"), msg("q", "p", "q")])
    const { cycles } = projectSpine(indexTree(cyclic), entryId("p"))
    expect(cycles.length).toBeGreaterThan(0)
  })

  test("non-message entries are dropped from the spine", () => {
    const mixed = entriesOf([
      msg("a1", null, "root"),
      entry("s1", "a1", undefined, { type: "compaction" }),
      msg("c1", "s1", "after"),
    ])
    const { spine } = projectSpine(indexTree(mixed), entryId("c1"))
    expect(spine.map(n => n.id)).toEqual(["a1", "c1"])
  })

  test("a null tip yields an empty spine, not a throw", () => {
    expect(projectSpine(indexTree(forked), null)).toEqual({
      spine: [],
      orphans: [],
      cycles: [],
    })
  })
})
