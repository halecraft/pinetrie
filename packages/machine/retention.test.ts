import {
  type SnapshotId,
  snapshotId,
  snapshotOwner,
  type ThreadId,
  threadIdFor,
} from "@pinetrie/core"
import { entrySnapshotId, SNAPSHOT_NAMES } from "@pinetrie/core/fixtures"
import fc from "fast-check"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  isProtected,
  newestByLane,
  partitionByOwner,
  planEntryRetention,
  RETENTION,
  type RetentionFacts,
} from "./retention.ts"
import { ROW_STATES, type SnapshotRow, snapshotCost } from "./snapshot-index.ts"

const LANE = threadIdFor("00000001-0000-7000-8000-000000000000")
const LANES: readonly ThreadId[] = [
  LANE,
  threadIdFor("00000002-0000-7000-8000-000000000000"),
  threadIdFor("00000003-0000-7000-8000-000000000000"),
]

const row = (
  snapshot: SnapshotId,
  more: Partial<SnapshotRow> = {},
): SnapshotRow => ({
  snapshot,
  lane: LANE,
  changed: 0,
  used: 1,
  branched: false,
  state: "kept",
  ...more,
})

const FACTS: RetentionFacts = {
  rows: [],
  complete: true,
  budget: Number.MAX_SAFE_INTEGER,
  room: null,
  limit: 200,
}

/** A listing of every owner's names, and rows for some of its entries. */
const SCENE = fc
  .record({
    entries: fc.uniqueArray(SNAPSHOT_NAMES.entry, { maxLength: 12 }),
    others: fc.array(
      fc.oneof(
        SNAPSHOT_NAMES["folder-state"],
        SNAPSHOT_NAMES.base,
        SNAPSHOT_NAMES.unknown,
      ),
      { maxLength: 8 },
    ),
    complete: fc.boolean(),
    budget: fc.nat({ max: 400_000 }),
    room: fc.option(fc.record({ unallocated: fc.nat(), minimum: fc.nat() })),
    limit: fc.integer({ min: 0, max: 6 }),
  })
  .chain(s =>
    fc
      .tuple(
        ...s.entries.map(() =>
          fc.option(
            fc.record({
              lane: fc.constantFrom(...LANES),
              changed: fc.nat({ max: 50 }),
              used: fc.nat({ max: 20 }),
              branched: fc.boolean(),
              state: fc.constantFrom(...ROW_STATES),
            }),
          ),
        ),
      )
      .map(rows => ({
        ...s,
        rows: rows.flatMap((r, i) =>
          r === null
            ? []
            : [{ ...r, snapshot: snapshotId(s.entries[i] ?? "") }],
        ),
      })),
  )

/** The upkeep's own way to the entry rule: the listing split by owner first. */
type Scene = typeof SCENE extends fc.Arbitrary<infer T> ? T : never

const planned = (s: Scene) => {
  const names = [...s.entries, ...s.others]
  return RETENTION.entry(partitionByOwner(names).entry, {
    rows: s.rows,
    complete: s.complete,
    budget: s.budget,
    room: s.room,
    limit: s.limit,
  })
}

describe("the retention table", () => {
  afterEach(() => vi.useRealTimers())

  test("no plan deletes another owner's name, a protected row, an unindexed name before the index is complete, or more than its limit", () => {
    fc.assert(
      fc.property(SCENE, s => {
        const out = planned(s)
        const rows = new Map(s.rows.map(r => [r.snapshot as string, r]))
        const newest = newestByLane(s.rows)
        expect(out.length).toBeLessThanOrEqual(s.limit)
        for (const id of out) {
          expect(snapshotOwner(id)).toBe("entry")
          const r = rows.get(id)
          if (r === undefined) expect(s.complete).toBe(true)
          else {
            expect(r.state).not.toBe("reserved")
            if (r.state === "kept") expect(isProtected(r, newest)).toBe(false)
          }
        }
      }),
    )
  })

  test("a plan is the same whatever the clock says", () => {
    fc.assert(
      fc.property(SCENE, fc.nat(), fc.nat(), (s, t1, t2) => {
        vi.useFakeTimers({ now: t1 })
        const first = planned(s)
        vi.setSystemTime(t2)
        expect(planned(s)).toEqual(first)
      }),
    )
  })

  test("only entries have a rule that deletes", () => {
    const names = ["base", `turn-${entrySnapshotId(1)}`, "x"]
    for (const owner of ["folder-state", "base", "unknown"] as const)
      expect(RETENTION[owner](names, { ...FACTS, budget: 0 })).toEqual([])
  })
})

describe("planEntryRetention", () => {
  const A = entrySnapshotId(1)
  const B = entrySnapshotId(2)
  const C = entrySnapshotId(3)
  const D = entrySnapshotId(4)
  const E = entrySnapshotId(5)

  test("rows marked to delete go first, then a deleted row whose name is still listed, then names with no row, then the least recently used", () => {
    const out = planEntryRetention([A, B, C, D, E], {
      ...FACTS,
      budget: 0,
      rows: [
        row(A, { state: "kept", used: 2 }),
        row(B, { state: "to-delete" }),
        row(C, { state: "deleted" }),
        row(E, { state: "kept", used: 3 }),
      ],
    })
    // D has no row; E is its lane's newest, and stays.
    expect(out).toEqual([B, C, D, A])
  })

  test("no unindexed name goes while the index is incomplete", () => {
    expect(planEntryRetention([A], { ...FACTS, complete: false })).toEqual([])
  })

  test("kept rows within the budget stay, and one over it goes, least recently used first", () => {
    const rows = [
      row(A, { used: 1, changed: 10 }),
      row(B, { used: 2, changed: 10 }),
      row(C, { used: 3, changed: 10 }),
    ]
    const cost = rows.reduce((sum, r) => sum + snapshotCost(r), 0)
    expect(
      planEntryRetention([A, B, C], { ...FACTS, rows, budget: cost }),
    ).toEqual([])
    expect(
      planEntryRetention([A, B, C], { ...FACTS, rows, budget: cost - 1 }),
    ).toEqual([A])
  })

  test("a room under its floor frees the least recently used, until what they free lifts it", () => {
    const rows = [row(A, { used: 1 }), row(B, { used: 2 }), row(C, { used: 3 })]
    const one = snapshotCost(rows[0] as SnapshotRow)
    expect(
      planEntryRetention([A, B, C], {
        ...FACTS,
        rows,
        room: { unallocated: 0, minimum: one },
      }),
    ).toEqual([A])
  })

  test("a branched row and a lane's newest are never the least recently used to go", () => {
    expect(
      planEntryRetention([A, B, C], {
        ...FACTS,
        budget: 0,
        rows: [
          row(A, { used: 1, branched: true }),
          row(B, { used: 2 }),
          row(C, { used: 3 }),
        ],
      }),
    ).toEqual([B])
  })
})
