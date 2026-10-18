import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { isDiskName } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { answer } from "./answer.ts"
import {
  planDisk,
  planInnerDockerDataRootSteps,
  readSnapshotFile,
  subvolumesDeepestFirst,
} from "./disks.ts"
import { isProjectKey, projectDisks } from "./layout.ts"
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
  test("a lane's delete takes its inner lanes' disk and its states; snapshots are deleted by name", () => {
    expect(planDisk({ kind: "delete", lane: "l" }, disks)).toEqual([
      { kind: "drop", path: disks.lane("l") },
      { kind: "drop", path: disks.nested("l") },
      { kind: "drop", path: disks.states("l") },
    ])
    expect(
      planDisk({ kind: "deleteSnapshots", ids: ["a", "b"] }, disks),
    ).toEqual([
      { kind: "drop", path: disks.snapshot("a") },
      { kind: "drop", path: disks.snapshot("b") },
    ])
  })
  describe("a nested lane's inner Docker data root", () => {
    const facts = (
      ownDataRoot: "subvolume" | "notSubvolume" | "absent",
      sourceDataRoot: "subvolume" | "notSubvolume" | "absent" | null = null,
    ) => ({ ownDataRoot, sourceDataRoot })
    const nestedDisk = [
      { kind: "parent", path: disks.nested("l") },
      { kind: "ensure", path: disks.nested("l"), uid: 1000 },
    ]
    test("a source that is a subvolume is cloned, writable, in place of the lane's own", () => {
      expect(
        planInnerDockerDataRootSteps(
          "l",
          "m",
          facts("subvolume", "subvolume"),
          disks,
        ),
      ).toEqual([
        ...nestedDisk,
        { kind: "drop", path: disks.innerDockerDataRoot("l") },
        {
          kind: "snapshot",
          from: disks.innerDockerDataRoot("m"),
          to: disks.innerDockerDataRoot("l"),
          readonly: false,
        },
      ])
    })
    test("a source whose data root has gone leaves the lane's own as it is", () => {
      expect(
        planInnerDockerDataRootSteps(
          "l",
          "m",
          facts("subvolume", "absent"),
          disks,
        ),
      ).toEqual(nestedDisk)
    })
    test("the lane itself is never its source", () => {
      expect(
        planInnerDockerDataRootSteps(
          "l",
          "l",
          facts("subvolume", "subvolume"),
          disks,
        ),
      ).toEqual(nestedDisk)
    })
    test("a plain directory is made a subvolume, and a missing one made, the rootless user's", () => {
      const made = {
        kind: "ensure",
        path: disks.innerDockerDataRoot("l"),
        uid: 1000,
      }
      expect(
        planInnerDockerDataRootSteps("l", null, facts("notSubvolume"), disks),
      ).toEqual([
        ...nestedDisk,
        { kind: "drop", path: disks.innerDockerDataRoot("l") },
        made,
      ])
      expect(
        planInnerDockerDataRootSteps("l", null, facts("absent"), disks),
      ).toEqual([...nestedDisk, made])
    })
    test("a name that is not a disk's is refused", () => {
      expect(() =>
        planInnerDockerDataRootSteps("l", "../x", facts("absent"), disks),
      ).toThrow("not a disk's name")
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
        states: ["a"],
      }),
    ).toEqual([
      { kind: "drop", path: `${disks.lanes}/a` },
      { kind: "drop", path: `${disks.snapshots}/s` },
      { kind: "drop", path: `${disks.nestedDir}/a` },
      { kind: "drop", path: `${disks.statesDir}/a` },
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

describe("readSnapshotFile: a file inside a snapshot", () => {
  test("read when there, null when not, refused when its real path leaves or it is too large", async () => {
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
      await writeFile(path.join(d.snapshot("s"), "notes.md"), "# notes\n")
      const read = (p: string, limit = 100) =>
        readSnapshotFile(d, "s", p, limit)
      expect(await read(".pinetrie-lane/base.json")).toBe("{}")
      expect(await read("notes.md")).toBe("# notes\n")
      expect(await read(".pinetrie-lane/recipes.json")).toBeNull()
      await expect(read(".pinetrie-lane/leak.json")).rejects.toThrow(
        "leaves its snapshot",
      )
      await expect(read("../x")).rejects.toThrow("not a path inside")
      await expect(read("notes.md", 3)).rejects.toThrow("more than 3")
    } finally {
      await rm(lanesDir, { recursive: true, force: true })
    }
  })
})
