import type { DiskChange, PathFact } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type MergeFacts,
  type PathFacts,
  pathsToCompare,
  pathsToGather,
  planPathMerge,
} from "./merge.ts"

const absent: PathFact = { kind: "absent" }
const dir: PathFact = { kind: "dir" }
const text = (size = 3, exec = false): PathFact => ({
  kind: "file",
  exec,
  text: true,
  size,
})
const binary: PathFact = { kind: "file", exec: false, text: false, size: 3 }
const link = (target: string): PathFact => ({ kind: "symlink", target })

const change = (
  path: string,
  kind: DiskChange["kind"] = "file",
): DiskChange => ({
  path,
  change: "changed",
  kind,
})

/** Facts for a merge: each path's three facts, each side's changed paths, and what is alike. */
function merge(
  paths: Record<string, PathFacts>,
  ours: readonly string[],
  theirs: readonly string[],
  same: readonly string[] = [],
): MergeFacts {
  return {
    ours: ours.map(p => change(p)),
    theirs: theirs.map(p => change(p)),
    facts: new Map(Object.entries(paths)),
    same: new Set(same),
  }
}

describe("planPathMerge", () => {
  test("a path only theirs changed takes theirs", () => {
    const f = { base: text(), ours: text(), theirs: text(5) }
    expect(planPathMerge(merge({ a: f }, [], ["a"]))).toEqual({
      steps: [{ kind: "take", path: "a" }],
      conflicts: [],
    })
  })

  test("a path only theirs deleted is deleted", () => {
    const f = { base: text(), ours: text(), theirs: absent }
    expect(planPathMerge(merge({ a: f }, [], ["a"])).steps).toEqual([
      { kind: "delete", path: "a" },
    ])
  })

  test("a path only ours changed needs no step", () => {
    expect(planPathMerge(merge({}, ["a"], []))).toEqual({
      steps: [],
      conflicts: [],
    })
  })

  test("the same change on both sides is taken once", () => {
    const f = { base: text(), ours: text(5), theirs: text(5) }
    expect(planPathMerge(merge({ a: f }, ["a"], ["a"], ["a"]))).toEqual({
      steps: [],
      conflicts: [],
    })
  })

  test("text changed on both sides is merged by text", () => {
    const f = { base: text(), ours: text(4), theirs: text(5) }
    expect(planPathMerge(merge({ a: f }, ["a"], ["a"])).steps).toEqual([
      { kind: "text", path: "a" },
    ])
  })

  test("a binary changed on both sides is a conflict, ours kept", () => {
    const f = { base: binary, ours: binary, theirs: binary }
    expect(planPathMerge(merge({ a: f }, ["a"], ["a"]))).toEqual({
      steps: [],
      conflicts: ["a"],
    })
  })

  test("a deletion against a change is a conflict", () => {
    const f = { base: text(), ours: absent, theirs: text(5) }
    expect(planPathMerge(merge({ a: f }, ["a"], ["a"])).conflicts).toEqual([
      "a",
    ])
    const g = { base: text(), ours: text(5), theirs: absent }
    expect(planPathMerge(merge({ a: g }, ["a"], ["a"])).conflicts).toEqual([
      "a",
    ])
  })

  test("symlinks to one target are alike; to two, a conflict", () => {
    const one = { base: link("x"), ours: link("y"), theirs: link("y") }
    expect(planPathMerge(merge({ a: one }, ["a"], ["a"])).conflicts).toEqual([])
    const two = { base: link("x"), ours: link("y"), theirs: link("z") }
    expect(planPathMerge(merge({ a: two }, ["a"], ["a"])).conflicts).toEqual([
      "a",
    ])
  })

  test("the executable bit is its own field: theirs' mode and ours' content both kept", () => {
    const f = { base: text(), ours: text(5), theirs: text(3, true) }
    expect(planPathMerge(merge({ a: f }, ["a"], ["a"]))).toEqual({
      steps: [
        { kind: "text", path: "a" },
        { kind: "mode", path: "a", exec: true },
      ],
      conflicts: [],
    })
    const ours = { base: text(), ours: text(3, true), theirs: text(5) }
    expect(planPathMerge(merge({ a: ours }, ["a"], ["a"])).steps).toEqual([
      { kind: "text", path: "a" },
    ])
  })

  test("a take of content the disk holds is dropped, its mode still taken", () => {
    const f = { base: text(), ours: text(), theirs: text(3, true) }
    expect(planPathMerge(merge({ a: f }, [], ["a"], ["a"])).steps).toEqual([
      { kind: "mode", path: "a", exec: true },
    ])
    const alike = { base: text(), ours: text(), theirs: text() }
    expect(planPathMerge(merge({ a: alike }, [], ["a"], ["a"])).steps).toEqual(
      [],
    )
  })

  test("a directory theirs made is taken whole, nothing under it on its own", () => {
    const d = { base: absent, ours: absent, theirs: dir }
    const f = { base: absent, ours: absent, theirs: text() }
    expect(
      planPathMerge(merge({ d, "d/f": f }, [], ["d", "d/f"])).steps,
    ).toEqual([{ kind: "take", path: "d" }])
  })

  describe("the tree check", () => {
    test("a file theirs adds under what ours made a file conflicts at the top", () => {
      const d = { base: absent, ours: text(), theirs: dir }
      const f = { base: absent, ours: absent, theirs: text() }
      expect(
        planPathMerge(merge({ d, "d/f": f }, ["d"], ["d", "d/f"])),
      ).toEqual({ steps: [], conflicts: ["d"] })
    })

    test("a file theirs adds in a directory ours replaced by a file conflicts there", () => {
      const d = { base: dir, ours: text(), theirs: dir }
      const f = { base: absent, ours: absent, theirs: text() }
      expect(planPathMerge(merge({ d, "d/f": f }, ["d"], ["d/f"]))).toEqual({
        steps: [],
        conflicts: ["d"],
      })
    })

    test("theirs deleting a directory ours changed inside conflicts at the directory", () => {
      const d = { base: dir, ours: dir, theirs: absent }
      expect(planPathMerge(merge({ d }, ["d/x"], ["d"]))).toEqual({
        steps: [],
        conflicts: ["d"],
      })
    })

    test("theirs making a file where ours added under the directory conflicts", () => {
      const d = { base: dir, ours: dir, theirs: text() }
      expect(planPathMerge(merge({ d }, ["d/new"], ["d"])).conflicts).toEqual([
        "d",
      ])
    })

    test("a directory made on both sides at one path is a conflict", () => {
      const d = { base: absent, ours: dir, theirs: dir }
      expect(planPathMerge(merge({ d }, ["d"], ["d"])).conflicts).toEqual(["d"])
    })
  })
})

describe("what is gathered", () => {
  test("ours' paths far from theirs are not gathered; near ones are", () => {
    const ours = ["far/x", "d", "e/sub/y", "a"].map(p => change(p))
    const theirs = ["d/f", "e", "a"].map(p => change(p))
    expect(pathsToGather(ours, theirs)).toEqual([
      "a",
      "d",
      "d/f",
      "e",
      "e/sub/y",
    ])
  })

  test("content is compared only where both hold a file of one size", () => {
    const facts = new Map<string, PathFacts>([
      ["a", { base: text(), ours: text(3), theirs: text(3) }],
      ["b", { base: text(), ours: text(3), theirs: text(4) }],
      ["c", { base: text(), ours: link("x"), theirs: text(3) }],
    ])
    expect(
      pathsToCompare(
        ["a", "b", "c"].map(p => change(p)),
        facts,
      ),
    ).toEqual(["a"])
  })
})
