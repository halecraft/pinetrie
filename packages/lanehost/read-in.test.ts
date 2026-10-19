// A read of the project's folder into its line against real btrfs, as the disks role
// runs it (`disks.test.ts` says where that holds), with the folder at a
// directory of its own in place of the role's mount. Elsewhere it skips,
// saying why.

import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  stat,
  statfs,
  symlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import type { ReadPath } from "@pinetrie/core"
import { afterAll, describe, expect, test } from "vitest"
import { answer } from "./answer.ts"
import { planReadIn } from "./folder.ts"
import { FOLDER_LINE, projectDisks } from "./layout.ts"
import type { LanehostCall } from "./protocol.ts"
import { servingFrom } from "./serving.ts"

const BTRFS_MAGIC = 0x9123683e
const HERE = path.join(import.meta.dirname, "node_modules", ".read-in-test")
const FOLDER = path.join(HERE, "folder")
const LANES = path.join(HERE, "lanes")
const onBtrfs = await mkdir(LANES, { recursive: true })
  .then(() => statfs(LANES))
  .then(s => s.type === BTRFS_MAGIC)
  .catch(() => false)

const KEY = "00112233445566ff"
const serving = servingFrom([
  "disks",
  LANES,
  JSON.stringify({ rootless: true, folder: FOLDER }),
])
const disks = projectDisks(LANES, KEY)
const call = <C extends LanehostCall>(c: C) => answer(c, serving)

/** `paths` of the project's folder, each with the stamp it has now. */
const stamped = (paths: readonly string[]): Promise<ReadPath[]> =>
  Promise.all(
    paths.map(async p => {
      const s = await lstat(path.join(FOLDER, p), { bigint: true })
      return {
        path: p,
        stamp: { size: Number(s.size), ctimeNs: String(s.ctimeNs) },
      }
    }),
  )

const readIn = async (
  from: string | null,
  state: string,
  paths: readonly string[],
  deleted: readonly string[] = [],
) =>
  call({
    kind: "read-in",
    project: KEY,
    from,
    state,
    paths: await stamped(paths),
    deleted,
  })

const inState = (state: string, p: string) =>
  path.join(disks.snapshot(state), p)
const exists = (at: string) =>
  lstat(at).then(
    () => true,
    () => false,
  )

afterAll(async () => {
  if (onBtrfs) await answer({ kind: "remove-project", project: KEY }, serving)
  await rm(HERE, { recursive: true, force: true })
})

test("a read's plan refuses a path that leaves the disk", () => {
  const plan = (p: string) =>
    planReadIn(
      {
        from: null,
        state: "line-1",
        paths: [{ path: p, stamp: { size: 0, ctimeNs: "0" } }],
        deleted: [],
      },
      FOLDER,
      disks,
    )
  expect(() => plan("../x")).toThrow()
  expect(() => plan("/etc/passwd")).toThrow()
  expect(plan("a/b.txt").paths[0]?.path).toBe("a/b.txt")
})

test("a read's plan refuses a source that leaves the folder", () => {
  const plan = (source: string) =>
    planReadIn(
      {
        from: "line-1",
        state: "concurrent-1",
        paths: [{ path: "a.txt", source, stamp: { size: 0, ctimeNs: "0" } }],
        deleted: [],
      },
      FOLDER,
      disks,
    )
  expect(() => plan("../x")).toThrow()
  expect(plan(".pinetrie-aside-1/a.txt").paths[0]).toMatchObject({
    path: "a.txt",
    source: ".pinetrie-aside-1/a.txt",
  })
})

describe.skipIf(!onBtrfs)(
  "reading the project's folder into its line on btrfs (skipped: not on btrfs here)",
  () => {
    test("a first read copies only the paths it is told: a file, its mode, a symlink", async () => {
      await mkdir(path.join(FOLDER, "d"), { recursive: true })
      await writeFile(path.join(FOLDER, "a.txt"), "a\n")
      await writeFile(path.join(FOLDER, "run.sh"), "#!/bin/sh\n")
      await chmod(path.join(FOLDER, "run.sh"), 0o755)
      await writeFile(path.join(FOLDER, "d/b.txt"), "b\n")
      await symlink("a.txt", path.join(FOLDER, "link"))
      await writeFile(path.join(FOLDER, "untold.txt"), "not asked\n")
      expect(
        await readIn(null, "line-1", ["a.txt", "run.sh", "d/b.txt", "link"]),
      ).toEqual({ kind: "made" })
      expect(await readFile(inState("line-1", "a.txt"), "utf8")).toBe("a\n")
      expect(await readFile(inState("line-1", "d/b.txt"), "utf8")).toBe("b\n")
      expect((await stat(inState("line-1", "run.sh"))).mode & 0o111).not.toBe(0)
      expect(await readlink(inState("line-1", "link"))).toBe("a.txt")
      expect(await exists(inState("line-1", "untold.txt"))).toBe(false)
      expect(await exists(disks.lane(FOLDER_LINE))).toBe(false)
    })

    test("a read on the last copies what changed, deletes what is gone, and keeps the rest", async () => {
      await writeFile(path.join(FOLDER, "a.txt"), "a, again\n")
      await rm(path.join(FOLDER, "d"), { recursive: true })
      // A directory replaced by a file of its name.
      await writeFile(path.join(FOLDER, "d"), "now a file\n")
      expect(
        await readIn("line-1", "line-2", ["a.txt", "d"], ["d/b.txt"]),
      ).toEqual({ kind: "made" })
      expect(await readFile(inState("line-2", "a.txt"), "utf8")).toBe(
        "a, again\n",
      )
      expect(await readFile(inState("line-2", "d"), "utf8")).toBe(
        "now a file\n",
      )
      expect(await readlink(inState("line-2", "link"))).toBe("a.txt")
      expect(await readFile(inState("line-1", "a.txt"), "utf8")).toBe("a\n")
    })

    test("files-under lists the files and links at or under each path, never a directory", async () => {
      expect(
        await call({
          kind: "files-under",
          project: KEY,
          snapshot: "line-1",
          paths: ["d", "a.txt", "link", "nope"],
        }),
      ).toEqual(["a.txt", "d/b.txt", "link"])
    })

    test("file-diff is one file's unified diff by its path; diff-stats counts lines, a side without the file empty", async () => {
      const diff = await call({
        kind: "file-diff",
        project: KEY,
        a: "line-1",
        b: "line-2",
        path: "a.txt",
        limit: 10_000,
      })
      expect(diff).toContain("--- a/a.txt")
      expect(diff).toContain("+++ b/a.txt")
      expect(diff).toContain("-a\n+a, again")
      expect(
        await call({
          kind: "diff-stats",
          project: KEY,
          a: "line-1",
          b: "line-2",
          paths: ["a.txt", "d/b.txt"],
        }),
      ).toEqual([
        { path: "a.txt", added: 1, removed: 1 },
        { path: "d/b.txt", added: 0, removed: 1 },
      ])
      const cut = await call({
        kind: "file-diff",
        project: KEY,
        a: "line-1",
        b: "line-2",
        path: "a.txt",
        limit: 10,
      })
      expect(cut.length).toBe(11)
    })

    test("a path whose stamp moved since the host read it makes no state, and is answered", async () => {
      const [told] = await stamped(["a.txt"])
      if (told === undefined) throw new Error("no stamp")
      await writeFile(path.join(FOLDER, "a.txt"), "saved meanwhile\n")
      expect(
        await call({
          kind: "read-in",
          project: KEY,
          from: "line-2",
          state: "line-3",
          paths: [told],
          deleted: [],
        }),
      ).toEqual({ kind: "moved", paths: ["a.txt"] })
      expect(
        await call({
          kind: "snapshot-exists",
          project: KEY,
          snapshot: "line-3",
        }),
      ).toBe(false)
      expect(await exists(disks.lane(FOLDER_LINE))).toBe(false)
    })
  },
)
