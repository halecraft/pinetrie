// Splitting a session stored as one document into a document per root
// (ADR-0063): every kept record lands in exactly one document.

import { expect, test } from "vitest"
import { physicalKey } from "../packages/schema/index.ts"
import {
  type OldState,
  type OldValue,
  planSplit,
  rootIdOf,
} from "./split-plan.ts"

const LANE_A = "t-01a0ffd2-0000-7000-8000-0000000000a1"
const LANE_B = "t-01a0ffd2-0000-7000-8000-0000000000b1"
const v = (
  namespace: string,
  key: string,
  value: unknown,
): [string, OldValue] => [
  physicalKey(namespace, key),
  { namespace, key, value },
]
const entry = (id: string, parentId: string | null) => ({ id, parentId })

const state: OldState = {
  entries: {
    a1: entry("a1", null),
    a2: entry("a2", "a1"),
    a3: entry("a3", "a1"), // a branch in root a
    b1: entry("b1", null),
  },
  usageRows: {
    u1: { entryId: "a2" },
    u2: { entryId: "gone" },
  },
  values: Object.fromEntries([
    v("pi.branch.tip", LANE_A, "a2"),
    v("pi.lane.config", LANE_A, { model: {} }),
    v("pi.branch.tip", LANE_B, "b1"),
    v("pi.result", "op-1", { tipId: "b1" }),
    v("pi.op.meta", "op-2", { lane: LANE_A }),
    v("pi.op.state", "op-2", { control: {} }),
    v("pi.op.tool_args", "op-2:call-1:0", {}),
    v("pineta.lane", LANE_A, {
      work: { kind: "own" },
      by: "w-ada",
      createdAt: 5,
    }),
    v("pineta.name", LANE_A, { name: "amber-fox", at: 1 }),
    v("pineta.revision", "a2", { lane: LANE_A, commit: null }),
    v("pineta.mark", "b1", { title: "Plans", by: "w-ada", at: 1 }),
    v("pineta.archive", "b1", { state: "archived", by: "w-ada", at: 1 }),
    v("pineta.project", "project", { kind: "lanes" }),
    v("pi.branch.tip", "t-nowhere", null),
    v("pi.pending.entry", "x", {}),
  ]),
  places: {
    c1: { kind: "drafting", at: "a3", lane: "" },
    c2: { kind: "queued", at: "a2", lane: LANE_A },
    c3: { kind: "fresh", at: "", lane: "" },
  },
}

const split = planSplit(state)
const A = rootIdOf("a1")
const B = rootIdOf("b1")

test("each root's entries and usage rows are in its own document", () => {
  expect(Object.keys(split.roots.get(A)?.entries ?? {}).sort()).toEqual([
    "a1",
    "a2",
    "a3",
  ])
  expect(Object.keys(split.roots.get(B)?.entries ?? {})).toEqual(["b1"])
  expect(Object.keys(split.roots.get(A)?.usageRows ?? {})).toEqual(["u1"])
  expect([...split.roots.keys()].sort()).toEqual([A, B].sort())
})

test("host records go by their home; pi's lane values by their lane's root", () => {
  const keys = (values: Record<string, OldValue>) =>
    Object.values(values)
      .map(x => `${x.namespace}:${x.key}`)
      .sort()
  expect(keys(split.roots.get(A)?.values ?? {})).toEqual([
    `pi.branch.tip:${LANE_A}`,
    `pi.lane.config:${LANE_A}`,
    "pi.op.meta:op-2",
    "pi.op.state:op-2",
    "pi.op.tool_args:op-2:call-1:0",
    "pineta.revision:a2",
  ])
  expect(keys(split.roots.get(B)?.values ?? {})).toEqual([
    `pi.branch.tip:${LANE_B}`,
    "pi.result:op-1",
    "pineta.mark:b1",
  ])
  expect(keys(split.session.values)).toEqual([
    "pineta.archive:b1",
    `pineta.lane:${LANE_A}`,
    `pineta.lane:${LANE_B}`,
    `pineta.name:${LANE_A}`,
    "pineta.project:project",
  ])
})

test("every lane's record names its root, an old one keeping its work", () => {
  const lane = (l: string) =>
    split.session.values[physicalKey("pineta.lane", l)]?.value
  expect(lane(LANE_A)).toEqual({
    work: { kind: "own" },
    by: "w-ada",
    createdAt: 5,
    root: A,
  })
  expect(lane(LANE_B)).toMatchObject({ work: null, root: B })
})

test("places at an entry gain their root; others none", () => {
  expect(split.places.c1?.root).toBe(A)
  expect(split.places.c2?.root).toBe(A)
  expect(split.places.c3?.root).toBe("")
})

test("what routes nowhere is dropped, and listed; everything else is kept once", () => {
  expect([...split.dropped].sort()).toEqual(
    [
      "usageRows:u2",
      `values:${physicalKey("pi.branch.tip", "t-nowhere")}`,
      `values:${physicalKey("pi.pending.entry", "x")}`,
    ].sort(),
  )
  const kept =
    Object.keys(split.session.values).length +
    [...split.roots.values()].reduce(
      (n, s) => n + Object.keys(s.values).length,
      0,
    )
  // Every value but the two dropped, and one new lane record (LANE_B's).
  expect(kept).toBe(Object.keys(state.values).length - 2 + 1)
})
