import { threadIdFor } from "@pinetrie/core"
import { entrySnapshotId } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import type { SnapshotRow } from "./snapshot-index.ts"
import {
  abandonedInnerProjects,
  DELETIONS_PER_STEP,
  deletableLanes,
  INDEX_ROOTS_PER_STEP,
  planUpkeepStep,
  type UpkeepFacts,
} from "./upkeep.ts"

const LIVE = threadIdFor("00000001-0000-7000-8000-000000000000")
const GONE = threadIdFor("00000002-0000-7000-8000-000000000000")
const RUNNING = threadIdFor("00000003-0000-7000-8000-000000000000")

const FACTS: UpkeepFacts = {
  listing: { snapshots: [], lanes: [], nested: [] },
  rows: [],
  complete: true,
  unread: [],
  live: new Set([LIVE]),
  running: new Set([RUNNING]),
  budget: Number.MAX_SAFE_INTEGER,
  room: null,
}

describe("deletableLanes", () => {
  test("a lane with no record, or in an archived canvas, goes; a live or running one, or a name no thread's, stays", () => {
    expect(
      deletableLanes({
        lanes: [LIVE, GONE, RUNNING, "base-scratch-0123456789abcdef"],
        live: new Set([LIVE]),
        running: new Set([RUNNING]),
      }),
    ).toEqual([GONE])
  })
})

describe("abandonedInnerProjects", () => {
  const nested = (lane: string) => ({
    lane,
    projects: [
      { key: "a000000000000000", root: "/workspace/app" },
      { key: "b000000000000000", root: "/tmp/pinetrie-folder-x" },
      { key: "c000000000000000", root: null },
      { key: "d000000000000000", root: "/workspaces" },
    ],
  })

  test("a stopped nested lane's inner projects off its disk go; one on its disk stays", () => {
    expect(
      abandonedInnerProjects({ nested: [nested(GONE)], running: new Set() }),
    ).toEqual([
      { lane: GONE, key: "b000000000000000" },
      { lane: GONE, key: "c000000000000000" },
      { lane: GONE, key: "d000000000000000" },
    ])
  })

  test("a running nested lane's inner projects all stay", () => {
    expect(
      abandonedInnerProjects({
        nested: [nested(RUNNING)],
        running: new Set([RUNNING]),
      }),
    ).toEqual([])
  })
})

describe("planUpkeepStep", () => {
  test("an incomplete index is filled a batch of roots a step, and deletes nothing", () => {
    const roots = Array.from(
      { length: INDEX_ROOTS_PER_STEP + 2 },
      (_, i) => `r-${i}`,
    )
    const facts = {
      ...FACTS,
      complete: false,
      listing: { ...FACTS.listing, lanes: [GONE] },
    }
    expect(planUpkeepStep({ ...facts, unread: roots })).toEqual({
      kind: "fill",
      roots: roots.slice(0, INDEX_ROOTS_PER_STEP),
      complete: false,
    })
    expect(
      planUpkeepStep({ ...facts, unread: roots.slice(INDEX_ROOTS_PER_STEP) }),
    ).toEqual({
      kind: "fill",
      roots: roots.slice(INDEX_ROOTS_PER_STEP),
      complete: true,
    })
  })

  test("a step deletes at most its limit, lanes and inner projects after snapshots, and says more remain", () => {
    const snapshots = Array.from({ length: DELETIONS_PER_STEP - 1 }, (_, i) =>
      entrySnapshotId(i + 1),
    )
    const step = planUpkeepStep({
      ...FACTS,
      listing: {
        snapshots,
        lanes: [GONE, threadIdFor("00000004-0000-7000-8000-000000000000")],
        nested: [],
      },
    })
    expect(step).toMatchObject({
      kind: "delete",
      lanes: [GONE],
      innerProjects: [],
      more: true,
    })
    if (step.kind === "delete")
      expect(step.snapshots).toHaveLength(DELETIONS_PER_STEP - 1)
  })

  test("a kept row whose snapshot is not listed has vanished: marked, not deleted", () => {
    const listed = entrySnapshotId(1)
    const gone = entrySnapshotId(2)
    const kept = (snapshot: typeof listed): SnapshotRow => ({
      snapshot,
      lane: LIVE,
      changed: 0,
      used: 1,
      branched: false,
      state: "kept",
    })
    const step = planUpkeepStep({
      ...FACTS,
      listing: { ...FACTS.listing, snapshots: [listed] },
      rows: [
        kept(listed),
        kept(gone),
        { ...kept(entrySnapshotId(3)), state: "reserved" },
      ],
    })
    expect(step).toMatchObject({
      kind: "delete",
      vanished: [gone],
      snapshots: [],
    })
  })
})
