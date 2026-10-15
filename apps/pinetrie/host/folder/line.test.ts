import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type FolderStamp,
  type PointId,
  pointId,
  type ReadInAnswer,
  type StateRecord,
} from "@pinetrie/core"
import { afterEach, describe, expect, test } from "vitest"
import { createFolderLine, planLineRead } from "./line.ts"

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
  test("your folder's first read copies every path into an empty disk, a state with no parent", () => {
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
      record: { id: NEXT, parents: [], made: { kind: "read" } },
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

  test("nothing changed since the last read: your folder's newest, and no state", () => {
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

  test("a read on your folder's newest copies what changed and deletes what is gone", () => {
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
      record: { parents: ["line-1"] },
    })
  })

  test("with the last read's stamps lost, a read copies everything into an empty disk, on your folder's line", () => {
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
      record: { parents: ["line-1"] },
    })
  })
})

describe("createFolderLine", () => {
  let dir = ""
  afterEach(async () => {
    if (dir !== "") await rm(dir, { recursive: true, force: true })
  })

  test("a read whose paths moved is read again; its stamps are kept only once its state is recorded", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pinetrie-line-"))
    const root = path.join(dir, "folder")
    await mkdir(root)
    await writeFile(path.join(root, "a.txt"), "a")
    const stampsFile = path.join(dir, "folder-stamps.json")
    const states: StateRecord[] = []
    const answers: ReadInAnswer[] = [
      { kind: "moved", paths: ["a.txt"] },
      { kind: "made" },
    ]
    const order: string[] = []
    let n = 0
    const moved: PointId[] = []
    const line = createFolderLine({
      root,
      own: () => "",
      disks: {
        readIn: async () => {
          order.push("readIn")
          return answers.shift() ?? { kind: "made" }
        },
      },
      stampsFile,
      states: () => states,
      writeState: async r => {
        order.push("state")
        await expect(readFile(stampsFile, "utf8")).rejects.toThrow()
        states.push(r)
      },
      newId: () => `0000000${n++}`,
      now: () => 1,
      moved: newest => moved.push(newest),
    })
    const newest = await line.read()
    expect(order).toEqual(["readIn", "readIn", "state"])
    expect(newest).toBe("line-00000001")
    expect(moved).toEqual([newest])
    expect(JSON.parse(await readFile(stampsFile, "utf8"))).toHaveProperty(
      "a.txt",
    )
    // Read again with nothing changed: no call, no state.
    expect(await line.read()).toBe(newest)
    expect(order).toEqual(["readIn", "readIn", "state"])
  })
})
