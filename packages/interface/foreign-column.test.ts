import {
  entryId,
  type ForeignLane,
  rootIdFor,
  snapshotId,
  writerId,
} from "@pinetrie/core"
import { indexTree } from "@pinetrie/threads"
import { fromParents, threadOfEntry } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import {
  columnForeign,
  columnReadOnly,
  foreignWords,
} from "./foreign-column.ts"

const ADA = writerId("ada@x.io")
const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
// r -> a: thread `r` is a lane's, whose turn at `a` took a snapshot.
const index = indexTree(fromParents({ r: null, a: "r" }))
const LANE = threadOfEntry("r")
const NEW = threadOfEntry("n")
const work = (history: "jj" | "folder") => ({
  project: { root: "/p", kind: "jj" as const, owner: null },
  lanes: new Map([
    [LANE, { lane: LANE, root: ROOT, history, by: ADA, createdAt: 0 }],
  ]),
  revisions: new Map([
    [
      entryId("a"),
      {
        entry: entryId("a"),
        lane: LANE,
        point: null,
        snapshot: snapshotId("a"),
        paths: [],
        conflicts: [],
        disk: null,
      },
    ],
  ]),
})
const bound = { thread: LANE, mode: { kind: "bound" } } as const
const branch = {
  thread: NEW,
  mode: { kind: "unstarted", fork: entryId("a"), root: ROOT },
} as const

describe("a column of another kind", () => {
  test("its lane's, or the lane a first send there clones; none of the project's kind, or with no project", () => {
    expect(columnForeign(bound, index, work("folder"))).toEqual({
      kind: "foreign",
      lane: LANE,
      history: "folder",
    })
    expect(columnForeign(branch, index, work("folder"))).toEqual({
      kind: "foreign",
      lane: NEW,
      history: "folder",
    })
    expect(columnForeign(bound, index, work("jj"))).toBeNull()
    expect(columnForeign(branch, index, work("jj"))).toBeNull()
    expect(
      columnForeign(bound, index, { ...work("folder"), project: null }),
    ).toBeNull()
  })

  test("is read-only, saying why, after a hold and a canvas's archive", () => {
    const foreign: ForeignLane = {
      kind: "foreign",
      lane: LANE,
      history: "folder",
    }
    const reader = { me: ADA, nameOf: new Map() }
    const archived = { label: "archived by Bea", action: null }
    expect(
      columnReadOnly({ canvas: null, heldBy: null, foreign, reader }),
    ).toEqual({ label: foreignWords(foreign), action: null })
    expect(
      columnReadOnly({ canvas: archived, heldBy: null, foreign, reader }),
    ).toBe(archived)
    expect(
      columnReadOnly({ canvas: archived, heldBy: ADA, foreign, reader }),
    ).toEqual({ label: "you have it", action: null })
    expect(
      columnReadOnly({ canvas: null, heldBy: null, foreign: null, reader }),
    ).toBeNull()
  })
})
