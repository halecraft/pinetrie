// A folder project's merges against real btrfs, without privilege, as the
// disks role runs them (`disks.test.ts` says where that holds), tagged
// `btrfs-checkout`.

import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { type MergeStep, pointId, snapshotId } from "@pinetrie/core"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { answer } from "./answer.ts"
import { testServerArgs } from "./fixtures.ts"
import { planApply, planStates } from "./folder.ts"
import { projectDisks } from "./layout.ts"
import type { LanehostCall } from "./protocol.ts"
import { servingFrom } from "./serving.ts"

const HERE = path.join(import.meta.dirname, "node_modules", ".folder-test")
await mkdir(HERE, { recursive: true })

const KEY = "0123456789abcdef"
const serving = servingFrom(testServerArgs("disks", HERE, { rootless: true }))
const disks = projectDisks(HERE, KEY)
const call = <C extends LanehostCall>(c: C) => answer(c, serving)

/**
 * A disk made with `files`, snapshotted as `name`: a value null is a
 * directory, false nothing, a `->` a symlink.
 */
async function state(
  name: string,
  files: Record<string, string | null | false>,
  from?: string,
) {
  const lane = `make-${name}`
  await call({
    kind: "disk",
    project: KEY,
    op:
      from === undefined
        ? { kind: "create", lane }
        : { kind: "restore", lane, from: snapshotId(from) },
  })
  for (const [p, v] of Object.entries(files)) {
    const at = path.join(disks.lane(lane), p)
    await rm(at, { recursive: true, force: true })
    if (v === false) continue
    await mkdir(path.dirname(at), { recursive: true })
    if (v === null) await mkdir(at)
    else if (v.startsWith("->")) await symlink(v.slice(2), at)
    else await writeFile(at, v)
  }
  await call({
    kind: "disk",
    project: KEY,
    op: { kind: "snapshot", lane, snapshot: snapshotId(name) },
  })
  await call({ kind: "disk", project: KEY, op: { kind: "delete", lane } })
}

/** A lane's disk restored from `from`, merged with `theirs` over `base`, snapshotted as `to`. */
async function mergeInto(input: {
  readonly from: string
  readonly base: string | null
  readonly theirs: string
  readonly steps: readonly MergeStep[]
  readonly to: string
  readonly markers?: boolean
}) {
  const disk = `lane-${input.to}`
  await call({
    kind: "disk",
    project: KEY,
    op: { kind: "restore", lane: disk, from: snapshotId(input.from) },
  })
  const texts = await call({
    kind: "apply-merge",
    project: KEY,
    disk,
    base: input.base,
    theirs: input.theirs,
    steps: input.steps,
    markers: input.markers ?? false,
  })
  await call({
    kind: "disk",
    project: KEY,
    op: { kind: "snapshot", lane: disk, snapshot: snapshotId(input.to) },
  })
  const diff = await call({
    kind: "diff",
    project: KEY,
    from: input.from,
    to: input.to,
  })
  return { texts, diff: diff.changes.map(c => c.path), disk }
}

const text = (snapshot: string, p: string) =>
  readFile(path.join(disks.snapshot(snapshot), p), "utf8")

const lines = (...ls: string[]) => `${ls.join("\n")}\n`

afterAll(async () => {
  await rm(HERE, { recursive: true, force: true })
})

describe("a merge's plan checks every name and path", () => {
  test("a path that leaves the disk, or a name no disk has, is refused", () => {
    const steps: MergeStep[] = [{ kind: "take", path: "../x" }]
    expect(() =>
      planApply({ disk: "l", base: null, theirs: "t", steps }, disks),
    ).toThrow("not a path inside")
    expect(() =>
      planApply({ disk: "../l", base: null, theirs: "t", steps: [] }, disks),
    ).toThrow("not a disk's name")
    expect(() =>
      planStates("l", { kind: "resolved", path: "/etc" }, disks),
    ).toThrow("not a path inside")
  })
})

describe("a folder project's merges on btrfs", {
  tags: ["btrfs-checkout"],
}, () => {
  // Only where the tests made subvolumes: elsewhere the call fails.
  afterAll(async () => {
    await call({ kind: "remove-project", project: KEY })
  })
  beforeAll(async () => {
    await state("base", {
      "clean.txt": lines("a", "b", "c", "d", "e"),
      "clash.txt": lines("one"),
      "gone.txt": "gone\n",
      "run.sh": "echo\n",
      "same.txt": "same\n",
      dir: null,
    })
    await state(
      "ours",
      {
        "clean.txt": lines("A", "b", "c", "d", "e"),
        "clash.txt": lines("ours"),
      },
      "base",
    )
    await state(
      "theirs",
      {
        "clean.txt": lines("a", "b", "c", "d", "E"),
        "clash.txt": lines("theirs"),
        "new.txt": "new\n",
        link: "->new.txt",
        "same.txt": "same\n",
        "gone.txt": false,
      },
      "base",
    )
  })

  test("text merges clean and conflicted, a take, a delete and a mode; the diff names exactly what changed", async () => {
    const merged = await mergeInto({
      from: "ours",
      base: "base",
      theirs: "theirs",
      to: "merged",
      steps: [
        { kind: "text", path: "clean.txt" },
        { kind: "text", path: "clash.txt" },
        { kind: "take", path: "new.txt" },
        { kind: "take", path: "link" },
        { kind: "delete", path: "gone.txt" },
        { kind: "mode", path: "run.sh", exec: true },
      ],
    })
    expect(merged.texts).toEqual([
      { path: "clean.txt", clean: true },
      { path: "clash.txt", clean: false },
    ])
    expect(await text("merged", "clean.txt")).toBe(
      lines("A", "b", "c", "d", "E"),
    )
    expect(await text("merged", "clash.txt")).toBe(lines("ours"))
    expect(await text("merged", "new.txt")).toBe("new\n")
    expect(await readlink(path.join(disks.snapshot("merged"), "link"))).toBe(
      "new.txt",
    )
    expect(
      (await lstat(path.join(disks.snapshot("merged"), "run.sh"))).mode & 0o111,
    ).toBe(0o111)
    expect(merged.diff).toEqual([
      "clean.txt",
      "gone.txt",
      "link",
      "new.txt",
      "run.sh",
    ])
  })

  test("a conflicted text keeps git's markers when asked, as a virtual base does", async () => {
    const merged = await mergeInto({
      from: "ours",
      base: "base",
      theirs: "theirs",
      to: "marked",
      markers: true,
      steps: [{ kind: "text", path: "clash.txt" }],
    })
    expect(merged.texts).toEqual([{ path: "clash.txt", clean: false }])
    expect(await text("marked", "clash.txt")).toBe(
      "<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n",
    )
    expect(merged.diff).toEqual(["clash.txt"])
  })

  test("a text merge whose result is ours writes nothing", async () => {
    // Theirs is the base here: the merge's result is ours, byte for byte.
    const merged = await mergeInto({
      from: "ours",
      base: "base",
      theirs: "base",
      to: "unchanged",
      steps: [{ kind: "text", path: "clean.txt" }],
    })
    expect(merged.texts).toEqual([{ path: "clean.txt", clean: true }])
    expect(merged.diff).toEqual([])
  })

  test("two files added at one path merge over an empty base", async () => {
    const merged = await mergeInto({
      from: "ours",
      base: null,
      theirs: "theirs",
      to: "empty-base",
      steps: [{ kind: "text", path: "clash.txt" }],
    })
    expect(merged.texts).toEqual([{ path: "clash.txt", clean: false }])
  })

  test("a merge leaves no staging behind on its disk", async () => {
    const { disk } = await mergeInto({
      from: "ours",
      base: "base",
      theirs: "theirs",
      to: "tidy",
      steps: [{ kind: "take", path: "new.txt" }],
    })
    await expect(
      lstat(path.join(disks.lane(disk), ".pinetrie-lane")),
    ).rejects.toThrow()
  })

  test("a take through a symlinked directory on the disk is refused", async () => {
    await state("trap", { out: `->${HERE}` }, "ours")
    await state("trap-theirs", { "out/new.txt": "new\n" }, "base")
    await expect(
      mergeInto({
        from: "trap",
        base: "base",
        theirs: "trap-theirs",
        to: "trapped",
        steps: [{ kind: "take", path: "out/new.txt" }],
      }),
    ).rejects.toThrow("not under directories")
  })

  test("path facts: a file's mode, content and size, a symlink's target, a directory, nothing under a symlink", async () => {
    await state(
      "facts",
      { "bin.dat": "a\0b", "a.gif": "GIF89a\0", "dir/f": "x", up: "->dir" },
      "base",
    )
    expect(
      await call({
        kind: "path-facts",
        project: KEY,
        snapshot: "facts",
        paths: ["clean.txt", "bin.dat", "a.gif", "up", "dir", "up/f", "none"],
      }),
    ).toEqual([
      { kind: "file", exec: false, content: "text", size: 10 },
      { kind: "file", exec: false, content: "binary", size: 3 },
      { kind: "file", exec: false, content: "image/gif", size: 7 },
      { kind: "symlink", target: "dir" },
      { kind: "dir" },
      { kind: "absent" },
      { kind: "absent" },
    ])
  })

  test("alike content: a clone and a copy by bytes; a size or a byte apart, not", async () => {
    await state(
      "copy",
      { "same.txt": "same\n", "clash.txt": lines("oner") },
      "base",
    )
    expect(
      await call({
        kind: "same-content",
        project: KEY,
        a: "base",
        b: "copy",
        pairs: ["same.txt", "clean.txt", "clash.txt", "none"].map(p => ({
          a: p,
          b: p,
        })),
      }),
    ).toEqual(["same.txt", "clean.txt"].map(p => ({ a: p, b: p })))
    expect(
      await call({
        kind: "same-content",
        project: KEY,
        a: "ours",
        b: "theirs",
        pairs: [
          { a: "clash.txt", b: "clash.txt" },
          { a: "same.txt", b: "same.txt" },
        ],
      }),
    ).toEqual([{ a: "same.txt", b: "same.txt" }])
  })

  test("alike content over a pair of two paths: a moved file equal, an edited one not", async () => {
    await state(
      "moved",
      { "new.txt": "same\n", "edited.txt": "same, edited\n" },
      "base",
    )
    expect(
      await call({
        kind: "same-content",
        project: KEY,
        a: "base",
        b: "moved",
        pairs: [
          { a: "same.txt", b: "new.txt" },
          { a: "same.txt", b: "edited.txt" },
        ],
      }),
    ).toEqual([{ a: "same.txt", b: "new.txt" }])
  })

  test("a lane's states: start moved by a rename, a conflict's versions read, then resolved, and gone with its lane", async () => {
    const lane = "t-1"
    const dir = disks.states(lane)
    const op = (o: Parameters<typeof planStates>[1]) =>
      call({ kind: "states", project: KEY, lane, op: o })
    await op({ kind: "start", state: pointId("base") })
    expect(await readFile(path.join(dir, "start", "same.txt"), "utf8")).toBe(
      "same\n",
    )
    await op({ kind: "start", state: pointId("theirs") })
    expect(await readlink(path.join(dir, "start"))).toBe("start-theirs")
    expect(await readFile(path.join(dir, "start", "new.txt"), "utf8")).toBe(
      "new\n",
    )
    await expect(lstat(path.join(dir, "start-base"))).rejects.toThrow()
    await op({
      kind: "conflict",
      path: "docs/clash.txt",
      base: pointId("base"),
      ours: pointId("ours"),
      theirs: pointId("theirs"),
    })
    await op({
      kind: "conflict",
      path: "clash.txt",
      base: pointId("base"),
      ours: pointId("ours"),
      theirs: pointId("theirs"),
    })
    const at = path.join(dir, "conflicts", "clash.txt")
    expect(await readFile(path.join(at, "base"), "utf8")).toBe(lines("one"))
    expect(await readFile(path.join(at, "ours"), "utf8")).toBe(lines("ours"))
    expect(await readFile(path.join(at, "theirs"), "utf8")).toBe(
      lines("theirs"),
    )
    // A path absent everywhere has no versions, and its directories go once resolved.
    await op({ kind: "resolved", path: "docs/clash.txt" })
    await expect(lstat(path.join(dir, "conflicts", "docs"))).rejects.toThrow()
    await call({ kind: "disk", project: KEY, op: { kind: "delete", lane } })
    await expect(lstat(dir)).rejects.toThrow()
  })

  test("a virtual base for a criss-cross keeps its bases' conflict as markers, and the lane's merge over it conflicts", async () => {
    // Proposed changes shown before the lane's catch-up, accepted after it:
    // the lane's turn and your save are both bases of its next catch-up.
    const f = (...ls: string[]) => ({ "f.txt": lines(...ls) })
    await state("k0", f("x", "y", "z"))
    await state("k1", f("x", "Y1", "z"), "k0")
    await state("ky", f("X", "y", "z"), "k0")
    await state("k3", f("X", "Y2", "z"), "k0")
    await state("ka", f("X", "Y1", "z"), "k0")
    const virtual = await mergeInto({
      from: "k1",
      base: "k0",
      theirs: "ky",
      to: "bases-k",
      markers: true,
      steps: [{ kind: "text", path: "f.txt" }],
    })
    expect(virtual.texts).toEqual([{ path: "f.txt", clean: false }])
    expect(await text("bases-k", "f.txt")).toContain("<<<<<<< ours")
    const merged = await mergeInto({
      from: "k3",
      base: "bases-k",
      theirs: "ka",
      to: "k-merged",
      steps: [{ kind: "text", path: "f.txt" }],
    })
    expect(merged.texts).toEqual([{ path: "f.txt", clean: false }])
    expect(await text("k-merged", "f.txt")).toBe(lines("X", "Y2", "z"))
    expect(merged.diff).toEqual([])
  })

  test("a read reads any file of a snapshot", async () => {
    expect(
      await call({
        kind: "read",
        project: KEY,
        snapshot: "theirs",
        path: "new.txt",
        limit: 100,
      }),
    ).toBe("new\n")
  })
})
