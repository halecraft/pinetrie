// The spine: the tip path, plus the branches that leave it.
//
// A linear fixture cannot test this. With one child per node the spine is a
// straight line and every assertion passes vacuously, so the fork cases carry
// the weight.

import { type EntryLike, projectSpine, projectTranscript } from "@pineta/core"
import { describe, expect, test } from "vitest"

const msg = (id: string, parentId: string | null, text: string): EntryLike => ({
  id,
  parentId,
  type: "message",
  message: { role: id.startsWith("a") ? "assistant" : "user", content: text },
})

/** A chain a -> b -> c, with d and e forking off b. */
const forked: Record<string, EntryLike> = {
  a1: msg("a1", null, "root"),
  b1: msg("b1", "a1", "trunk one"),
  c1: msg("c1", "b1", "trunk two"),
  d1: msg("d1", "b1", "aside one"),
  e1: msg("e1", "d1", "aside two"),
}

describe("projectSpine", () => {
  test("a linear chain has a spine and no branches", () => {
    const linear = { a1: forked.a1, b1: forked.b1, c1: forked.c1 }
    const { spine, orphans, cycles } = projectSpine(
      linear as Record<string, EntryLike>,
      "c1",
    )
    expect(spine.map(n => n.id)).toEqual(["a1", "b1", "c1"])
    expect(spine.every(n => n.branches.length === 0)).toBe(true)
    expect([orphans, cycles]).toEqual([[], []])
  })

  test("the spine equals projectTranscript; branches are the extra", () => {
    // The two projections must never disagree about what is on the path.
    const { spine } = projectSpine(forked, "c1")
    expect(spine.map(n => ({ id: n.id, role: n.role, text: n.text }))).toEqual(
      projectTranscript(forked, "c1"),
    )
  })

  test("a fork appears as a branch on its parent, not on the spine", () => {
    const { spine } = projectSpine(forked, "c1")
    expect(spine.map(n => n.id)).toEqual(["a1", "b1", "c1"])
    const b1 = spine.find(n => n.id === "b1")
    expect(b1?.branches.map(b => b.rootId)).toEqual(["d1"])
    expect(spine.flatMap(n => n.branches).map(b => b.rootId)).not.toContain(
      "c1",
    )
  })

  test("messageCount covers the whole subtree, not just its root", () => {
    const { spine } = projectSpine(forked, "c1")
    const branch = spine.find(n => n.id === "b1")?.branches[0]
    expect(branch?.messageCount).toBe(2) // d1 and e1
  })

  test("tipId is the deepest descendant, so read() re-roots correctly", () => {
    const { spine } = projectSpine(forked, "c1")
    expect(spine.find(n => n.id === "b1")?.branches[0]?.tipId).toBe("e1")
  })

  test("branches sort by ascending rootId, not insertion order", () => {
    const many: Record<string, EntryLike> = {
      a1: msg("a1", null, "root"),
      b1: msg("b1", "a1", "trunk"),
      z9: msg("z9", "a1", "z"),
      m5: msg("m5", "a1", "m"),
      c3: msg("c3", "a1", "c"),
    }
    const { spine } = projectSpine(many, "b1")
    expect(spine.find(n => n.id === "a1")?.branches.map(b => b.rootId)).toEqual(
      ["c3", "m5", "z9"],
    )
  })

  test("an orphan parent is reported, not silently dropped", () => {
    const orphaned: Record<string, EntryLike> = {
      a1: msg("a1", null, "root"),
      x1: msg("x1", "missing", "lost"),
    }
    const { orphans } = projectSpine(orphaned, "a1")
    expect(orphans).toEqual(["x1"])
  })

  test("a cycle is reported and the walk terminates", () => {
    const cyclic: Record<string, EntryLike> = {
      p: { ...msg("p", "q", "p"), parentId: "q" },
      q: { ...msg("q", "p", "q"), parentId: "p" },
    }
    const { cycles } = projectSpine(cyclic, "p")
    expect(cycles.length).toBeGreaterThan(0)
  })

  test("non-message entries are dropped from the spine", () => {
    const mixed: Record<string, EntryLike> = {
      a1: msg("a1", null, "root"),
      s1: { id: "s1", parentId: "a1", type: "compaction" },
      c1: msg("c1", "s1", "after"),
    }
    const { spine } = projectSpine(mixed, "c1")
    expect(spine.map(n => n.id)).toEqual(["a1", "c1"])
  })

  test("a null tip yields an empty spine, not a throw", () => {
    expect(projectSpine(forked, null)).toEqual({
      spine: [],
      orphans: [],
      cycles: [],
    })
  })
})
