import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { SharedRead } from "@pinetrie/rules"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { filesUnder, sharedPath, startSharedWatch } from "./shared-watch.ts"

describe("sharedPath", () => {
  const dirs = [
    { path: ".plans", source: "/p/.plans" },
    { path: "notes/shared", source: "/p/notes/shared" },
  ]
  test("a file under a shared directory, from the disk's root; none outside", () => {
    expect(sharedPath(dirs, "/p/.plans/a/b.md")).toBe(".plans/a/b.md")
    expect(sharedPath(dirs, "/p/notes/shared/n.md")).toBe("notes/shared/n.md")
    expect(sharedPath(dirs, "/p/.plans")).toBeNull()
    expect(sharedPath(dirs, "/p/.plansx/a.md")).toBeNull()
    expect(sharedPath(dirs, "/p/src/a.ts")).toBeNull()
  })
})

describe("the watcher on a shared directory", () => {
  let dir = ""
  const seen: SharedRead[] = []
  const scans: { dir: string; stamps: readonly SharedRead[] }[] = []
  const watch = startSharedWatch({
    lineages: {
      seen: async stamps => {
        seen.push(...stamps)
      },
      scanned: async (d, stamps) => {
        scans.push({ dir: d, stamps })
        seen.push(...stamps)
      },
    },
    failed: what => error => {
      throw new Error(`${what}: ${String(error)}`)
    },
  })
  beforeAll(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "pinetrie-watch-")))
    await writeFile(path.join(dir, "before.md"), "there at the start\n")
    await watch.sync([{ path: ".plans", source: dir }])
  })
  afterAll(async () => {
    await watch.close()
    await rm(dir, { recursive: true, force: true })
  })

  const until = async (found: () => boolean) => {
    for (let i = 0; i < 100 && !found(); i++)
      await new Promise(r => setTimeout(r, 50))
  }

  test("a file there at the start, and one written since, each with its size and ctime", async () => {
    const file = path.join(dir, "yours.md")
    await writeFile(file, "yours\n")
    const st = await stat(file, { bigint: true })
    const want = `${st.size}:${st.ctimeNs}`
    await until(() => seen.some(s => s.path === ".plans/yours.md"))
    expect(seen.find(s => s.path === ".plans/before.md")).toBeDefined()
    expect(seen.find(s => s.path === ".plans/yours.md")?.stamp).toBe(want)
  })

  test("the start scans the directory whole, as the scan of its path", async () => {
    await until(() => scans.length > 0)
    expect(scans[0]?.dir).toBe(".plans")
    expect(scans[0]?.stamps.map(s => s.path)).toContain(".plans/before.md")
  })
})

describe("files-under", () => {
  test("a directory that is gone holds no file", async () => {
    expect(
      await filesUnder(path.join(tmpdir(), "pinetrie-no-such-dir")),
    ).toEqual([])
  })

  test("a listing that fails throws: no file reads as gone", async () => {
    const dir = await realpath(
      await mkdtemp(path.join(tmpdir(), "pinetrie-watch-")),
    )
    // A file where the directory should be: readdir fails with ENOTDIR.
    const notADir = path.join(dir, "plans")
    await writeFile(notADir, "")
    await expect(filesUnder(notADir)).rejects.toThrow(/ENOTDIR/)
    await rm(dir, { recursive: true, force: true })
  })
})
