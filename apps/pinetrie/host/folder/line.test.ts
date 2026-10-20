import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { PointId, ReadInAnswer, StateRecord } from "@pinetrie/core"
import { createQueue } from "@pinetrie/lanes"
import { afterEach, describe, expect, test } from "vitest"
import { createFolderLine } from "./line.ts"

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
      recover: async () => {},
      asides: async () => {},
      disks: {
        readIn: async () => {
          order.push("read-in")
          return answers.shift() ?? { kind: "made" }
        },
      },
      queue: createQueue(),
      stampsFile,
      states: () => states,
      write: async records => {
        order.push("state")
        await expect(readFile(stampsFile, "utf8")).rejects.toThrow()
        states.push(...records.states)
      },
      newId: () => `0000000${n++}`,
      now: () => 1,
      moved: newest => moved.push(newest),
    })
    const newest = await line.read()
    expect(order).toEqual(["read-in", "read-in", "state"])
    expect(newest).toBe("line-00000001")
    expect(moved).toEqual([newest])
    expect(JSON.parse(await readFile(stampsFile, "utf8"))).toHaveProperty(
      "a.txt",
    )
    // Read again with nothing changed: no call, no state.
    expect(await line.read()).toBe(newest)
    expect(order).toEqual(["read-in", "read-in", "state"])
  })

  test("the first read recovers once; asides are checked at a quiet read, never at an accept's own", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pinetrie-line-"))
    const root = path.join(dir, "folder")
    await mkdir(root)
    const calls: string[] = []
    const states: StateRecord[] = []
    let n = 0
    const queue = createQueue()
    const line = createFolderLine({
      root,
      own: () => "",
      recover: async () => {
        calls.push("recover")
      },
      asides: async () => {
        calls.push("asides")
      },
      disks: { readIn: async () => ({ kind: "made" }) },
      queue,
      stampsFile: path.join(dir, "folder-stamps.json"),
      states: () => states,
      write: async records => {
        states.push(...records.states)
      },
      newId: () => `0000000${n++}`,
      now: () => 1,
      moved: () => {},
    })
    await line.read()
    expect(calls).toEqual(["recover", "asides"])
    // Not quiet since: a read checks nothing.
    await line.read()
    expect(calls).toEqual(["recover", "asides"])
    // The watcher saw quiet, then an accept read first: the asides stay due.
    line.markQuiet()
    await queue.enqueue(() => line.readNow())
    expect(calls).toEqual(["recover", "asides"])
    await line.read()
    expect(calls).toEqual(["recover", "asides", "asides"])
  })
})
