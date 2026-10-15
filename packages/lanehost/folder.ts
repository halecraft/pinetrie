// lanehost/folder — a folder project's merges on its disks, as
// `@pinetrie/folder` plans them: what a snapshot holds at a path, whether two
// hold alike content, a merge's steps applied to a disk, and a lane's states
// directory. Every call is checked and planned into absolute paths first
// (`layout.ts`), then carried out.

import { constants } from "node:fs"
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  symlink,
} from "node:fs/promises"
import path from "node:path"
import { runCommand } from "@pinetrie/channel"
import {
  isPathInside,
  type LaneStatesOp,
  type MergeStep,
  type PathFact,
  type TextMerged,
} from "@pinetrie/core"
import { executeDiskSteps } from "./disks.ts"
import {
  LANE_FILES,
  checkedDiskName as named,
  type ProjectDisks,
} from "./layout.ts"
import { kindOf } from "./walk.ts"

/** How much of a file is read to tell text: git's own window. */
const TEXT_WINDOW = 8000

const inside = (p: string): string => {
  if (!isPathInside(p))
    throw new Error(`not a path inside a disk: ${JSON.stringify(p)}`)
  return p
}

const lstatOrNull = (at: string) => lstat(at).catch(() => null)

/**
 * Whether every directory between `root` and `p` is one, never a symlink:
 * a path under a symlink is no path of the tree, and a write through one
 * could leave the disk, which its lane controls.
 */
async function isUnderDirs(root: string, p: string): Promise<boolean> {
  const parts = p.split("/")
  for (let i = 1; i < parts.length; i++) {
    const s = await lstatOrNull(path.join(root, ...parts.slice(0, i)))
    if (s === null || !s.isDirectory()) return false
  }
  return true
}

/** Whether a file holds a NUL byte in its first window, as git tells binary. */
async function isText(at: string): Promise<boolean> {
  const handle = await open(at, "r")
  try {
    const buf = Buffer.alloc(TEXT_WINDOW)
    const { bytesRead } = await handle.read(buf, 0, TEXT_WINDOW, 0)
    return !buf.subarray(0, bytesRead).includes(0)
  } finally {
    await handle.close()
  }
}

/** What the tree at `root` holds at `p`. */
async function factAt(root: string, p: string): Promise<PathFact> {
  if (!(await isUnderDirs(root, p))) return { kind: "absent" }
  const at = path.join(root, p)
  const s = await lstatOrNull(at)
  if (s === null) return { kind: "absent" }
  switch (kindOf(s)) {
    case "dir":
      return { kind: "dir" }
    case "symlink":
      return { kind: "symlink", target: await readlink(at) }
    case "file":
      return {
        kind: "file",
        exec: (s.mode & 0o100) !== 0,
        text: await isText(at),
        size: s.size,
      }
    case "other":
      return { kind: "other" }
  }
}

/** What a snapshot holds at each path, in order. */
export async function pathFacts(
  disks: ProjectDisks,
  snapshot: string,
  paths: readonly string[],
): Promise<readonly PathFact[]> {
  const root = disks.snapshot(named(snapshot))
  const out: PathFact[] = []
  for (const p of paths) out.push(await factAt(root, inside(p)))
  return out
}

/** Whether two files hold the same bytes, read a chunk at a time. */
async function isSameBytes(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([open(a, "r"), open(b, "r")])
  try {
    const size = 64 * 1024
    const ba = Buffer.alloc(size)
    const bb = Buffer.alloc(size)
    for (let at = 0; ; at += size) {
      const [ra, rb] = await Promise.all([
        ha.read(ba, 0, size, at),
        hb.read(bb, 0, size, at),
      ])
      if (ra.bytesRead !== rb.bytesRead) return false
      if (ra.bytesRead === 0) return true
      if (!ba.subarray(0, ra.bytesRead).equals(bb.subarray(0, rb.bytesRead)))
        return false
    }
  } finally {
    await Promise.all([ha.close(), hb.close()])
  }
}

/**
 * The paths where snapshots `a` and `b` both hold a file of the same bytes:
 * sizes first, then a read of both. Shared extents would prove a clone
 * alike without a read; only the paths both sides changed are asked, so a
 * read is cheap enough.
 */
export async function sameContent(
  disks: ProjectDisks,
  a: string,
  b: string,
  paths: readonly string[],
): Promise<readonly string[]> {
  const rootA = disks.snapshot(named(a))
  const rootB = disks.snapshot(named(b))
  const out: string[] = []
  for (const p of paths.map(inside)) {
    if (!(await isUnderDirs(rootA, p)) || !(await isUnderDirs(rootB, p)))
      continue
    const [sa, sb] = await Promise.all([
      lstatOrNull(path.join(rootA, p)),
      lstatOrNull(path.join(rootB, p)),
    ])
    if (sa === null || sb === null || !sa.isFile() || !sb.isFile()) continue
    if (sa.size !== sb.size) continue
    if (await isSameBytes(path.join(rootA, p), path.join(rootB, p))) out.push(p)
  }
  return out
}

/** A merge into a disk, checked and planned: the trees it reads and writes, where it stages, its ops in order. */
export interface ApplyPlanned {
  readonly disk: string
  /** Null for an empty base. */
  readonly base: string | null
  readonly theirs: string
  /** Inside the disk, so a staged file is renamed into place on one file system. */
  readonly stage: string
  readonly ops: readonly MergeStep[]
}

/** `applyMerge` as absolute paths; throws on a name that is no disk's or a path that leaves one. */
export function planApply(
  call: {
    readonly disk: string
    readonly base: string | null
    readonly theirs: string
    readonly steps: readonly MergeStep[]
  },
  disks: ProjectDisks,
): ApplyPlanned {
  const disk = disks.lane(named(call.disk))
  return {
    disk,
    base: call.base === null ? null : disks.snapshot(named(call.base)),
    theirs: disks.snapshot(named(call.theirs)),
    stage: path.join(disk, LANE_FILES, "merge"),
    ops: call.steps.map(step => ({ ...step, path: inside(step.path) })),
  }
}

/** Clone what is at `from` to `to`: a file by reflink, a symlink made again, a tree whole. */
const cloneTree = (from: string, to: string) =>
  cp(from, to, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE_FORCE,
    errorOnExist: true,
  })

/** The executable bits set where read is, as git's mode does, or cleared. */
const withExec = (mode: number, exec: boolean) =>
  exec ? mode | ((mode & 0o444) >> 2) : mode & ~0o111

/** `root`'s file at `p`, or null where it holds none, or holds it under a symlink. */
async function fileIn(root: string, p: string): Promise<string | null> {
  if (!(await isUnderDirs(root, p))) return null
  const at = path.join(root, p)
  return (await lstatOrNull(at))?.isFile() ? at : null
}

/**
 * Carry out a planned merge. A file is written by staging it, then renaming
 * it into place, so the disk never holds half of one; a text result equal
 * to ours is not written, so the disk's diff names only what changed.
 * Nothing is read or written under a symlink: a lane controls its disk and
 * its snapshots, and a symlinked directory could lead out of either.
 */
export async function executeApply(
  planned: ApplyPlanned,
  markers: boolean,
): Promise<readonly TextMerged[]> {
  const { disk, stage } = planned
  const filesDir = path.dirname(stage)
  const madeFilesDir = (await lstatOrNull(filesDir)) === null
  await mkdir(stage, { recursive: true })
  const texts: TextMerged[] = []
  let n = 0
  const staged = () => path.join(stage, String(n++))
  const onDisk = async (p: string) => {
    if (!(await isUnderDirs(disk, p)))
      throw new Error(`${p} is not under directories on its disk`)
    return path.join(disk, p)
  }
  try {
    for (const op of planned.ops) {
      switch (op.kind) {
        case "take": {
          if (!(await isUnderDirs(planned.theirs, op.path)))
            throw new Error(`${op.path} is not under directories in theirs`)
          const to = staged()
          await cloneTree(path.join(planned.theirs, op.path), to)
          const at = await onDisk(op.path)
          await rm(at, { recursive: true, force: true })
          await rename(to, at)
          break
        }
        case "delete":
          await rm(await onDisk(op.path), { recursive: true, force: true })
          break
        case "mode": {
          const at = await onDisk(op.path)
          const s = await lstat(at)
          if (s.isFile()) await chmod(at, withExec(s.mode & 0o7777, op.exec))
          break
        }
        case "text": {
          const ours = await onDisk(op.path)
          const theirs = await fileIn(planned.theirs, op.path)
          if (theirs === null)
            throw new Error(`${op.path} is no file in theirs`)
          const base =
            planned.base === null ? null : await fileIn(planned.base, op.path)
          texts.push(
            await mergeText(op.path, { ours, base, theirs }, staged, markers),
          )
          break
        }
      }
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
    if (madeFilesDir) await rmdir(filesDir).catch(() => {})
  }
  return texts
}

/** `git merge-file` of base, ours and theirs into a staged copy of ours; an absent base is empty. */
async function mergeText(
  rel: string,
  files: {
    readonly ours: string
    readonly base: string | null
    readonly theirs: string
  },
  staged: () => string,
  markers: boolean,
): Promise<TextMerged> {
  const s = await lstat(files.ours)
  if (!s.isFile()) throw new Error(`${rel} is no file to merge`)
  const result = staged()
  await copyFile(files.ours, result)
  let base = files.base
  if (base === null) {
    base = staged()
    await (await open(base, "w")).close()
  }
  const ran = await runCommand(
    [
      "git",
      "merge-file",
      "-L",
      "ours",
      "-L",
      "base",
      "-L",
      "theirs",
      result,
      base,
      files.theirs,
    ],
    { cwd: "/", bytes: false, signal: new AbortController().signal },
  )
  // Its exit is the number of conflicts, at most 127; an error is negative.
  if (ran.code < 0 || ran.code > 127)
    throw new Error(`git merge-file ${rel}: ${ran.stderr.trim()}`)
  const clean = ran.code === 0
  if ((clean || markers) && !(await isSameBytes(result, files.ours))) {
    await chmod(result, s.mode & 0o7777)
    await rename(result, files.ours)
  }
  return { path: rel, clean }
}

/** A states op, checked and planned into the paths it touches. */
export type StatesPlanned =
  | {
      readonly kind: "start"
      readonly dir: string
      readonly from: string
      readonly name: string
    }
  | {
      readonly kind: "conflict"
      readonly dir: string
      readonly at: string
      readonly path: string
      readonly versions: readonly {
        readonly name: "base" | "ours" | "theirs"
        /** The snapshot it is cloned from. */
        readonly root: string
      }[]
    }
  | { readonly kind: "resolved"; readonly dir: string; readonly at: string }

/** A lane's states op as paths; throws on a name that is no disk's or a path that leaves one. */
export function planStates(
  lane: string,
  op: LaneStatesOp,
  disks: ProjectDisks,
): StatesPlanned {
  const dir = disks.states(named(lane))
  const conflictAt = (p: string) => path.join(dir, "conflicts", inside(p))
  switch (op.kind) {
    case "start":
      return {
        kind: "start",
        dir,
        from: disks.snapshot(named(op.state)),
        name: `start-${op.state}`,
      }
    case "conflict":
      return {
        kind: "conflict",
        dir,
        at: conflictAt(op.path),
        path: op.path,
        versions: (["base", "ours", "theirs"] as const).map(name => ({
          name,
          root: disks.snapshot(named(op[name])),
        })),
      }
    case "resolved":
      return { kind: "resolved", dir, at: conflictAt(op.path) }
  }
}

/**
 * Carry out a states op. `start` is a symlink renamed over the last, so a
 * running lane reads one state or the other, never neither; the copies it
 * no longer names are deleted after.
 */
export async function executeStates(planned: StatesPlanned): Promise<void> {
  const { dir } = planned
  switch (planned.kind) {
    case "start": {
      await mkdir(dir, { recursive: true })
      const to = path.join(dir, planned.name)
      if ((await lstatOrNull(to)) === null)
        await executeDiskSteps([
          { kind: "snapshot", from: planned.from, to, readonly: true },
        ])
      const link = path.join(dir, "start.tmp")
      await rm(link, { force: true })
      await symlink(planned.name, link)
      await rename(link, path.join(dir, "start"))
      for (const name of await readdir(dir))
        if (name.startsWith("start-") && name !== planned.name)
          await executeDiskSteps([{ kind: "drop", path: path.join(dir, name) }])
      return
    }
    case "conflict": {
      await rm(planned.at, { recursive: true, force: true })
      await mkdir(planned.at, { recursive: true })
      for (const v of planned.versions) {
        // A version under a symlink, or absent, has no copy: the lane sees
        // these, and a symlinked directory could lead out of its snapshot.
        if (!(await isUnderDirs(v.root, planned.path))) continue
        const from = path.join(v.root, planned.path)
        if ((await lstatOrNull(from)) === null) continue
        await cloneTree(from, path.join(planned.at, v.name))
      }
      return
    }
    case "resolved": {
      await rm(planned.at, { recursive: true, force: true })
      // Its directories, once empty, up to `conflicts`.
      const top = path.join(dir, "conflicts")
      for (
        let at = path.dirname(planned.at);
        at.startsWith(`${top}/`);
        at = path.dirname(at)
      )
        if (
          !(await rmdir(at).then(
            () => true,
            () => false,
          ))
        )
          break
      return
    }
  }
}
