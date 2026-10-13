// The disks module against real btrfs, without privilege: a pine·trie lane's
// `/workspace` is on the VM's btrfs, mounted with `user_subvol_rm_allowed`,
// as the disks role's lanes directory is. Elsewhere it skips, saying why.

import { readFileSync } from "node:fs"
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  statfs,
  symlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { runCommand } from "@pinetrie/channel"
import { afterAll, describe, expect, test } from "vitest"
import { answer } from "./answer.ts"
import { isSubvolume } from "./disks.ts"
import { projectDisks } from "./layout.ts"
import type { LanehostCall } from "./protocol.ts"
import { streamChanges } from "./send-stream.ts"
import { servingFrom } from "./serving.ts"

const BTRFS_MAGIC = 0x9123683e
const HERE = path.join(import.meta.dirname, "node_modules", ".disks-test")
const onBtrfs = await mkdir(HERE, { recursive: true })
  .then(() => statfs(HERE))
  .then(s => s.type === BTRFS_MAGIC)
  .catch(() => false)

const KEY = "fedcba9876543210"
const serving = servingFrom(["disks", HERE, "{}"])
const disks = projectDisks(HERE, KEY)
const disk = (call: LanehostCall) => answer(call, serving)

afterAll(async () => {
  if (onBtrfs) await answer({ kind: "removeProject", project: KEY }, serving)
  await rm(HERE, { recursive: true, force: true })
})

describe.skipIf(!onBtrfs)(
  "the disks role on btrfs (skipped: not on btrfs here)",
  () => {
    test("create, snapshot, restore, delete; a snapshot replaced in place", async () => {
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "create", lane: "l" },
      })
      await writeFile(path.join(disks.lane("l"), "f"), "one")
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "snapshot", lane: "l", snapshot: "s" },
      })
      await writeFile(path.join(disks.lane("l"), "f"), "two")
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "snapshot", lane: "l", snapshot: "s" },
      })
      expect(await readFile(path.join(disks.snapshot("s"), "f"), "utf8")).toBe(
        "two",
      )
      expect(
        await answer(
          { kind: "snapshotExists", project: KEY, snapshot: "s" },
          serving,
        ),
      ).toBe(true)
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "restore", lane: "r", from: "s" },
      })
      expect(await readFile(path.join(disks.lane("r"), "f"), "utf8")).toBe(
        "two",
      )
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "delete", lane: "r" },
      })
      expect(await isSubvolume(disks.lane("r"))).toBe(false)
      const listed = await answer({ kind: "snapshots", project: KEY }, serving)
      expect(listed.map(s => s.id)).toEqual(["s"])
      expect(listed[0]?.made).toBeGreaterThan(0)
    })
    test("a snapshot is read-only; a restore of it is writable; a delete takes it", async () => {
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "snapshot", lane: "l", snapshot: "ro" },
      })
      await expect(
        writeFile(path.join(disks.snapshot("ro"), "x"), "no"),
      ).rejects.toThrow()
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "restore", lane: "w", from: "ro" },
      })
      await writeFile(path.join(disks.lane("w"), "x"), "yes")
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "deleteSnapshots", ids: ["ro"] },
      })
      expect(
        await answer(
          { kind: "snapshotExists", project: KEY, snapshot: "ro" },
          serving,
        ),
      ).toBe(false)
    })
    test("the walk's diff of the recorded turn, between two snapshots, is what send's stream says", async () => {
      const lane = disks.lane("turn")
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "create", lane: "turn" },
      })
      await mkdir(path.join(lane, "d", "sub"), { recursive: true })
      await writeFile(path.join(lane, "d", "a"), "a\n")
      await writeFile(path.join(lane, "d", "sub", "b"), "b\n")
      for (const f of ["keep", "mod", "ren-src", "chmod"])
        await writeFile(path.join(lane, `${f}.txt`), `${f}\n`)
      await symlink("keep.txt", path.join(lane, "link"))
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "snapshot", lane: "turn", snapshot: "a" },
      })
      await rm(path.join(lane, "d"), { recursive: true })
      await rename(
        path.join(lane, "ren-src.txt"),
        path.join(lane, "ren-dst.txt"),
      )
      await writeFile(path.join(lane, "new\nline"), "x")
      await writeFile(path.join(lane, "with space.txt"), "y")
      await appendFile(path.join(lane, "mod.txt"), "more\n")
      await chmod(path.join(lane, "chmod.txt"), 0o700)
      await mkdir(path.join(lane, "newdir", "inner"), { recursive: true })
      await writeFile(path.join(lane, "newdir", "inner", "f"), "z\n")
      await rm(path.join(lane, "link"))
      await symlink("mod.txt", path.join(lane, "link"))
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "snapshot", lane: "turn", snapshot: "b" },
      })
      const walked = await answer(
        { kind: "diff", project: KEY, from: "a", to: "b" },
        servingFrom(["disks", HERE, '{"rootless":true}']),
      )
      const sent = streamChanges(
        readFileSync(path.join(import.meta.dirname, "fixtures", "turn.stream")),
      )
      expect(walked.changes.map(c => `${c.path} ${c.change}`)).toEqual(
        sent.map(c => `${c.path} ${c.change}`),
      )
    })
    test("a lane's delete takes a nested disk holding read-only snapshots, and a lane disk holding one", async () => {
      const btrfs = async (...args: string[]) => {
        const ran = await runCommand(["btrfs", "-q", ...args], {
          cwd: "/",
          bytes: false,
          signal: new AbortController().signal,
        })
        if (ran.code !== 0)
          throw new Error(`btrfs ${args.join(" ")}: ${ran.stderr}`)
      }
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "create", lane: "n" },
      })
      await disk({ kind: "nestedDisk", project: KEY, lane: "n" })
      // As an inner lanehost leaves them: a lane, and a read-only snapshot
      // of it, two levels down.
      const inner = path.join(disks.nested("n"), "projects/p")
      await mkdir(path.join(inner, "lanes"), { recursive: true })
      await mkdir(path.join(inner, "snapshots"), { recursive: true })
      await btrfs("subvolume", "create", path.join(inner, "lanes/a"))
      await mkdir(path.join(inner, "lanes/a/.git"))
      await writeFile(path.join(inner, "lanes/a/.git/HEAD"), "ref\n")
      await btrfs(
        "subvolume",
        "snapshot",
        "-r",
        path.join(inner, "lanes/a"),
        path.join(inner, "snapshots/base"),
      )
      // As an agent may make one in its own lane.
      await btrfs("subvolume", "create", path.join(disks.lane("n"), "s"))
      await btrfs(
        "subvolume",
        "snapshot",
        "-r",
        path.join(disks.lane("n"), "s"),
        path.join(disks.lane("n"), "s-ro"),
      )
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "delete", lane: "n" },
      })
      expect(await isSubvolume(disks.lane("n"))).toBe(false)
      expect(await isSubvolume(disks.nested("n"))).toBe(false)
    })
    test("a project's record and listing, and its removal", async () => {
      await answer(
        { kind: "record", project: KEY, root: "/Users/ada/p" },
        serving,
      )
      expect(await answer({ kind: "projects" }, serving)).toEqual([
        { key: KEY, root: "/Users/ada/p" },
      ])
      await answer({ kind: "removeProject", project: KEY }, serving)
      expect(await answer({ kind: "projects" }, serving)).toEqual([])
    })
  },
)
