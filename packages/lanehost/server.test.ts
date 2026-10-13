import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { answer } from "./answer.ts"
import {
  planDisk,
  planNestedDisk,
  readLaneFile,
  subvolumesDeepestFirst,
} from "./disks.ts"
import { isDiskName, isProjectKey, projectDisks } from "./layout.ts"
import { planProjectRemoval } from "./projects.ts"
import { planRoles } from "./roles.ts"
import { servingFrom } from "./serving.ts"

const KEY = "0123456789abcdef"
const disks = projectDisks("/var/lib/lanehost", KEY)

describe("names: every path is built from names checked first", () => {
  test("a project's key is 16 hex digits", () => {
    expect(isProjectKey(KEY)).toBe(true)
    for (const bad of ["../etc", "0123456789ABCDEF", "", `${KEY}/x`])
      expect(isProjectKey(bad)).toBe(false)
  })
  test("a disk's name is one path segment, never a snapshot in the making", () => {
    for (const ok of [
      "t-01a125ee-afcf-7d13-99dc-58aa74a6e0fe",
      "base",
      "base-scratch",
    ])
      expect(isDiskName(ok)).toBe(true)
    for (const bad of ["..", ".", "a/b", "", "base.tmp", "/abs", "-x"])
      expect(isDiskName(bad)).toBe(false)
  })
  test("a call naming another path is refused before anything runs", async () => {
    const serving = servingFrom(["disks", "/var/lib/lanehost", "{}"])
    await expect(
      answer({ kind: "diskExists", project: "../../etc", lane: "x" }, serving),
    ).rejects.toThrow("not a project's key")
    await expect(
      answer({ kind: "diskExists", project: KEY, lane: "../x" }, serving),
    ).rejects.toThrow("not a disk's name")
    expect(() =>
      planDisk({ kind: "deleteSnapshots", ids: ["ok", "../../x"] }, disks),
    ).toThrow("not a disk's name")
  })
})

describe("planDisk: each disk operation as steps", () => {
  test("a snapshot is made aside, read-only, then moved into place over the old one", () => {
    expect(
      planDisk({ kind: "snapshot", lane: "l", snapshot: "e1" }, disks),
    ).toEqual([
      { kind: "parent", path: disks.snapshot("e1") },
      { kind: "drop", path: `${disks.snapshot("e1")}.tmp` },
      {
        kind: "snapshot",
        from: disks.lane("l"),
        to: `${disks.snapshot("e1")}.tmp`,
        readonly: true,
      },
      { kind: "drop", path: disks.snapshot("e1") },
      {
        kind: "move",
        from: `${disks.snapshot("e1")}.tmp`,
        to: disks.snapshot("e1"),
      },
    ])
  })
  test("a restore is a writable snapshot of the snapshot at the lane's disk", () => {
    expect(
      planDisk({ kind: "restore", lane: "l", from: "base" }, disks),
    ).toEqual([
      { kind: "parent", path: disks.lane("l") },
      {
        kind: "snapshot",
        from: disks.snapshot("base"),
        to: disks.lane("l"),
        readonly: false,
      },
    ])
  })
  test("a create makes its parent, then the disk", () => {
    expect(planDisk({ kind: "create", lane: "l" }, disks)).toEqual([
      { kind: "parent", path: disks.lane("l") },
      { kind: "create", path: disks.lane("l") },
    ])
  })
  test("a lane's delete takes its inner lanes' disk; snapshots are deleted by name", () => {
    expect(planDisk({ kind: "delete", lane: "l" }, disks)).toEqual([
      { kind: "drop", path: disks.lane("l") },
      { kind: "drop", path: disks.nested("l") },
    ])
    expect(
      planDisk({ kind: "deleteSnapshots", ids: ["a", "b"] }, disks),
    ).toEqual([
      { kind: "drop", path: disks.snapshot("a") },
      { kind: "drop", path: disks.snapshot("b") },
    ])
  })
  test("a nested lane's inner disk is the rootless user's", () => {
    expect(planNestedDisk("l", disks).at(-1)).toEqual({
      kind: "ensure",
      path: disks.nested("l"),
      uid: 1000,
    })
  })
  test("subvolumesDeepestFirst puts each subvolume before every one above it", () => {
    expect(
      subvolumesDeepestFirst([
        "/n/projects/p/lanes/a",
        "/n/docker/x",
        "/n/projects/p/lanes/a/inner/deep",
        "/n/projects/p/snapshots/base",
      ]),
    ).toEqual([
      "/n/projects/p/lanes/a/inner/deep",
      "/n/projects/p/lanes/a",
      "/n/projects/p/snapshots/base",
      "/n/docker/x",
    ])
  })
  test("a project's removal drops each disk it holds", () => {
    expect(
      planProjectRemoval(disks, {
        lanes: ["a"],
        snapshots: ["s"],
        nested: ["a"],
      }),
    ).toEqual([
      { kind: "drop", path: `${disks.lanes}/a` },
      { kind: "drop", path: `${disks.snapshots}/s` },
      { kind: "drop", path: `${disks.nestedDir}/a` },
    ])
  })
})

describe("roles", () => {
  test("the disks role serves the disks and the projects; the privileged role the grants", () => {
    const roles = planRoles({ rootless: false })
    expect([
      roles.get("disks"),
      roles.get("projects"),
      roles.get("grants"),
    ]).toEqual(["disks", "disks", "privileged"])
  })
  test("a diff is send's, in the privileged role, unless Docker is rootless: then a walk, in the disks role", () => {
    expect(planRoles({ rootless: false }).get("diff")).toBe("privileged")
    expect(planRoles({ rootless: true }).get("diff")).toBe("disks")
  })
  test("a call is refused by a role that does not serve it", async () => {
    await expect(
      answer(
        { kind: "projects" },
        servingFrom(["privileged", "/var/lib/lanehost", "{}"]),
      ),
    ).rejects.toThrow("projects is disks's, not privileged's")
  })
  test("a server's arguments are a role's", () => {
    expect(() => servingFrom(["root", "/l", "{}"])).toThrow("not a role")
    expect(servingFrom(["disks", "/l", '{"rootless":true}']).facts).toEqual({
      rootless: true,
    })
  })
})

describe("readLaneFile: pine·trie's own file inside a snapshot", () => {
  test("read when there, null when not, refused when its real path leaves", async () => {
    const lanesDir = await mkdtemp(path.join(tmpdir(), "lanehost-read-"))
    try {
      const d = projectDisks(lanesDir, KEY)
      await mkdir(path.join(d.snapshot("s"), ".pinetrie-lane"), {
        recursive: true,
      })
      await writeFile(
        path.join(d.snapshot("s"), ".pinetrie-lane", "base.json"),
        "{}",
      )
      await writeFile(path.join(lanesDir, "secret"), "no")
      await symlink(
        path.join(lanesDir, "secret"),
        path.join(d.snapshot("s"), ".pinetrie-lane", "leak.json"),
      )
      expect(await readLaneFile(d, "s", "base.json")).toBe("{}")
      expect(await readLaneFile(d, "s", "recipes.json")).toBeNull()
      await expect(readLaneFile(d, "s", "leak.json")).rejects.toThrow(
        "leaves its snapshot",
      )
      await expect(readLaneFile(d, "s", "../x")).rejects.toThrow(
        "not a file of pine·trie's",
      )
    } finally {
      await rm(lanesDir, { recursive: true, force: true })
    }
  })
})
