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
  stat,
  statfs,
  symlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { runCommand } from "@pinetrie/channel"
import type { DiskChange } from "@pinetrie/core"
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
    test("a lane restored from another's snapshot is apart from it: neither's writes reach the other", async () => {
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "create", lane: "parent" },
      })
      await writeFile(path.join(disks.lane("parent"), "f"), "turn")
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "snapshot", lane: "parent", snapshot: "at-turn" },
      })
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "restore", lane: "branch", from: "at-turn" },
      })
      await writeFile(path.join(disks.lane("parent"), "f"), "parent later")
      await writeFile(path.join(disks.lane("branch"), "f"), "branch")
      expect(
        await Promise.all(
          [
            disks.lane("parent"),
            disks.lane("branch"),
            disks.snapshot("at-turn"),
          ].map(d => readFile(path.join(d, "f"), "utf8").catch(() => null)),
        ),
      ).toEqual(["parent later", "branch", "turn"])
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
    test("the walk's diff of the recorded replacement, either way, is what send's streams say of its files", async () => {
      const lane = disks.lane("replace")
      const snap = (snapshot: string) =>
        disk({
          kind: "disk",
          project: KEY,
          op: { kind: "snapshot", lane: "replace", snapshot },
        })
      await disk({
        kind: "disk",
        project: KEY,
        op: { kind: "create", lane: "replace" },
      })
      await mkdir(path.join(lane, "d"))
      await writeFile(path.join(lane, "a.txt"), "one\n")
      await writeFile(path.join(lane, "d", "x"), "x\n")
      await writeFile(path.join(lane, "keep.txt"), "keep\n")
      await snap("older")
      await rm(path.join(lane, "a.txt"))
      await writeFile(path.join(lane, "a.txt"), "two\n")
      await rm(path.join(lane, "d"), { recursive: true })
      await mkdir(path.join(lane, "d"))
      await writeFile(path.join(lane, "d", "x"), "y\n")
      await snap("newer")
      // A walk counts a directory changed only by its mode, so a replaced
      // one is no change to it: the two agree on what is not a directory.
      const files = (changes: readonly DiskChange[]) =>
        changes.filter(c => c.kind !== "dir").map(c => `${c.path} ${c.change}`)
      for (const [from, to, fixture] of [
        ["older", "newer", "replaced"],
        ["newer", "older", "replaced-from-newer"],
      ] as const) {
        const walked = await answer(
          { kind: "diff", project: KEY, from, to },
          servingFrom(["disks", HERE, '{"rootless":true}']),
        )
        const sent = streamChanges(
          readFileSync(
            path.join(import.meta.dirname, "fixtures", `${fixture}.stream`),
          ),
        )
        expect(files(walked.changes)).toEqual(files(sent))
      }
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
      await disk({
        kind: "nestedDisk",
        project: KEY,
        lane: "n",
        cloneFromLane: null,
      })
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
    test("a nested disk's data root: made the rootless user's, then a clone of another lane's", async () => {
      const nestedDisk = (lane: string, cloneFromLane: string | null) =>
        disk({ kind: "nestedDisk", project: KEY, lane, cloneFromLane })
      // As a lane made before its data root was a subvolume left it.
      await mkdir(path.join(disks.nested("old"), "docker", "image"), {
        recursive: true,
      })
      await nestedDisk("old", null)
      expect(await isSubvolume(disks.innerDockerDataRoot("old"))).toBe(true)
      await nestedDisk("source", null)
      await writeFile(path.join(disks.innerDockerDataRoot("source"), "f"), "1")
      await nestedDisk("old", "source")
      const cloned = disks.innerDockerDataRoot("old")
      expect(await isSubvolume(cloned)).toBe(true)
      expect(await readFile(path.join(cloned, "f"), "utf8")).toBe("1")
      expect((await stat(cloned)).uid).toBe(1000)
      // Writable, and its own: the source does not see what the clone writes.
      await writeFile(path.join(cloned, "g"), "2")
      await expect(
        stat(path.join(disks.innerDockerDataRoot("source"), "g")),
      ).rejects.toThrow()
      // A source whose data root has gone leaves the lane's as it is.
      await nestedDisk("old", "gone")
      expect(await readFile(path.join(cloned, "g"), "utf8")).toBe("2")
      for (const lane of ["old", "source"])
        await disk({ kind: "disk", project: KEY, op: { kind: "delete", lane } })
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
