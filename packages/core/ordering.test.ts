// ADR-0013's safety claim, stated as tests. The derivation is pure so that
// these properties need no substrate to express.

import { orderNewEntries } from "@pinetrie/core"
import { describe, expect, test } from "vitest"

/** A tree as `id -> parentId`. `null` is a root. */
type Tree = Record<string, string | null>
const parentOf = (tree: Tree) => (id: string) => tree[id]

/** Every permutation of `xs`, for exhaustive small-input checks. */
function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]]
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [
      x,
      ...rest,
    ]),
  )
}

describe("orderNewEntries", () => {
  test("parents precede children", () => {
    const tree: Tree = { a: null, b: "a", c: "b", d: "c" }
    const { ordered, unresolved } = orderNewEntries(
      ["d", "b", "a", "c"],
      parentOf(tree),
    )
    expect(unresolved).toEqual([])
    for (const id of ordered) {
      const parent = tree[id]
      if (parent !== null && parent !== undefined) {
        expect(ordered.indexOf(parent)).toBeLessThan(ordered.indexOf(id))
      }
    }
  })

  test("ADR-0013: order is invariant under input permutation", () => {
    // Two replicas see the same delta in different orders. If they disagree
    // on the resulting sequence, stable cursors silently skip entries.
    const tree: Tree = { a: null, b: "a", c: "a", d: "b", e: null }
    const ids = ["a", "b", "c", "d", "e"]
    const expected = orderNewEntries(ids, parentOf(tree)).ordered

    const seen = new Set<string>()
    for (const perm of permutations(ids)) {
      seen.add(orderNewEntries(perm, parentOf(tree)).ordered.join(","))
    }
    expect([...seen]).toEqual([expected.join(",")])
    expect(seen.size).toBe(1) // 120 permutations, one answer
  })

  test("siblings break ties by smallest id, not arrival", () => {
    const tree: Tree = { root: null, z: "root", a: "root", m: "root" }
    const { ordered } = orderNewEntries(["root", "z", "m", "a"], parentOf(tree))
    expect(ordered).toEqual(["root", "a", "m", "z"])
  })

  test("the FRONTIER is sorted, not the input", () => {
    // Two roots b and d, where b's child c sorts between them. Sorting the
    // candidate list up front (a plausible and also-deterministic
    // implementation) yields b, d, c — c only becomes available after b is
    // taken, so it lands at the back. Sorting the frontier each round yields
    // b, c, d. A permutation test cannot tell these apart: both are stable.
    // Only pinning the expected order can.
    const tree: Tree = { b: null, d: null, c: "b" }
    const { ordered } = orderNewEntries(["d", "c", "b"], parentOf(tree))
    expect(ordered).toEqual(["b", "c", "d"])
  })

  test("a parent already sequenced (absent from the batch) is ready", () => {
    // `parentOf` returns a parent that is not among the candidates: the entry
    // is not blocked, because that parent already has its seq.
    const tree: Tree = { child: "older-entry" }
    const { ordered, unresolved } = orderNewEntries(["child"], parentOf(tree))
    expect(ordered).toEqual(["child"])
    expect(unresolved).toEqual([])
  })

  test("a cycle is reported as unresolved, not spun on", () => {
    const tree: Tree = { x: "y", y: "x" }
    const { ordered, unresolved } = orderNewEntries(["x", "y"], parentOf(tree))
    expect(ordered).toEqual([])
    expect([...unresolved].sort()).toEqual(["x", "y"])
  })

  test("a cycle does not strand entries that do not depend on it", () => {
    const tree: Tree = { x: "y", y: "x", ok: null }
    const { ordered, unresolved } = orderNewEntries(
      ["x", "ok", "y"],
      parentOf(tree),
    )
    expect(ordered).toEqual(["ok"])
    expect([...unresolved].sort()).toEqual(["x", "y"])
  })

  test("an empty batch is not an error", () => {
    expect(orderNewEntries([], parentOf({}))).toEqual({
      ordered: [],
      unresolved: [],
    })
  })

  test("duplicate candidates are sequenced once", () => {
    const tree: Tree = { a: null, b: "a" }
    const { ordered } = orderNewEntries(["b", "a", "b"], parentOf(tree))
    expect(ordered).toEqual(["a", "b"])
  })
})
