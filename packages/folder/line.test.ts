import {
  type FolderStamp,
  type PointId,
  pointId,
  type StateRecord,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { planLineRead } from "./line.ts"

const file = (size: number, ctimeNs = "1"): FolderStamp => ({
  kind: "file",
  size,
  ctimeNs,
  exec: false,
})
const stamps = (entries: Record<string, FolderStamp>) =>
  new Map(Object.entries(entries))
const read = (id: string, ...parents: PointId[]): StateRecord => ({
  id: pointId(id),
  parents,
  made: { kind: "read" },
  at: 1,
  by: null,
})
const NEXT = pointId("line-next")

describe("planLineRead", () => {
  test("the first read of the project's folder copies every path into an empty disk, a state with no parent", () => {
    const planned = planLineRead({
      states: [],
      last: null,
      scan: stamps({ "b.txt": file(2), "a.txt": file(1) }),
      state: NEXT,
      at: 5,
    })
    expect(planned).toMatchObject({
      kind: "read",
      call: {
        from: null,
        state: NEXT,
        paths: [
          { path: "a.txt", stamp: { size: 1, ctimeNs: "1" } },
          { path: "b.txt", stamp: { size: 2, ctimeNs: "1" } },
        ],
        deleted: [],
      },
      records: { states: [{ id: NEXT, parents: [], made: { kind: "read" } }] },
    })
  })

  test("an empty folder's first read still makes a state", () => {
    expect(
      planLineRead({
        states: [],
        last: null,
        scan: new Map(),
        state: NEXT,
        at: 1,
      }).kind,
    ).toBe("read")
  })

  test("nothing changed since the last read: accepted work's newest, and no state", () => {
    const last = stamps({ "a.txt": file(1) })
    expect(
      planLineRead({
        states: [read("line-1")],
        last,
        scan: stamps({ "a.txt": file(1) }),
        state: NEXT,
        at: 1,
      }),
    ).toEqual({ kind: "current", newest: "line-1" })
  })

  test("a read on accepted work's newest copies what changed and deletes what is gone", () => {
    expect(
      planLineRead({
        states: [read("line-1")],
        last: stamps({ "a.txt": file(1), "gone.txt": file(1) }),
        scan: stamps({ "a.txt": file(1, "2") }),
        state: NEXT,
        at: 1,
      }),
    ).toMatchObject({
      call: {
        from: "line-1",
        paths: [{ path: "a.txt" }],
        deleted: ["gone.txt"],
      },
      records: { states: [{ parents: ["line-1"] }] },
    })
  })

  test("with the last read's stamps lost, a read copies everything into an empty disk, on accepted work's line", () => {
    expect(
      planLineRead({
        states: [read("line-1")],
        last: null,
        scan: stamps({ "a.txt": file(1) }),
        state: NEXT,
        at: 1,
      }),
    ).toMatchObject({
      call: { from: null, paths: [{ path: "a.txt" }], deleted: [] },
      records: { states: [{ parents: ["line-1"] }] },
    })
  })
})
