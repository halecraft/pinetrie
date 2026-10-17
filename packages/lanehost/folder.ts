// lanehost/folder — a folder project's merges on its disks, as
// `@pinetrie/folder` plans them: what a snapshot holds at a path, whether two
// hold alike content, a merge's steps applied to a disk, a lane's states
// directory, and a read of the project's folder into its line. Every call is checked and planned into absolute paths first
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
  type DiffStat,
  isPathInside,
  type LaneStatesOp,
  type MergeStep,
  type PathFact,
  type ReadInAnswer,
  type ReadPath,
  type TextMerged,
} from "@pinetrie/core"
import { type DiskStep, executeDiskSteps, planDisk } from "./disks.ts"
import {
  FOLDER_LINE,
  LANE_FILES,
  checkedDiskName as named,
  type ProjectDisks,
} from "./layout.ts"
import { kindOf, walkTree } from "./walk.ts"

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

/**
 * The files and symlinks a snapshot holds at or under each of `paths`,
 * sorted: a diff names a directory renamed or made by its path alone. Never
 * through a symlink.
 */
export async function filesUnder(
  disks: ProjectDisks,
  snapshot: string,
  paths: readonly string[],
): Promise<readonly string[]> {
  const root = disks.snapshot(named(snapshot))
  const out = new Set<string>()
  for (const p of paths.map(inside)) {
    if (!(await isUnderDirs(root, p))) continue
    const s = await lstatOrNull(path.join(root, p))
    if (s === null) continue
    if (!s.isDirectory()) {
      if (kindOf(s) !== "other") out.add(p)
      continue
    }
    for (const [rel, e] of await walkTree(path.join(root, p)))
      if (e.kind === "file" || e.kind === "symlink") out.add(`${p}/${rel}`)
  }
  return [...out].sort()
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

/** A read of the project's folder into its line, checked and planned into absolute paths. */
export interface ReadInPlanned {
  /** The project's folder, as the disks role sees it, read-only. */
  readonly folder: string
  /** The line's disk, made from `from` (null: empty) and dropped after. */
  readonly disk: readonly DiskStep[]
  readonly diskPath: string
  readonly snapshot: readonly DiskStep[]
  readonly drop: readonly DiskStep[]
  readonly paths: readonly ReadPath[]
  readonly deleted: readonly string[]
}

/** `readIn` as steps and paths; throws on a name that is no disk's or a path that leaves one. */
export function planReadIn(
  call: {
    readonly from: string | null
    readonly state: string
    readonly paths: readonly ReadPath[]
    readonly deleted: readonly string[]
  },
  folder: string,
  disks: ProjectDisks,
): ReadInPlanned {
  const lane = FOLDER_LINE
  const drop = planDisk({ kind: "delete", lane }, disks)
  return {
    folder,
    disk: [
      ...drop,
      ...planDisk(
        call.from === null
          ? { kind: "create", lane }
          : { kind: "restore", lane, from: named(call.from) },
        disks,
      ),
    ],
    diskPath: disks.lane(lane),
    snapshot: planDisk(
      { kind: "snapshot", lane, snapshot: named(call.state) },
      disks,
    ),
    drop,
    paths: call.paths.map(p => ({
      ...p,
      path: inside(p.path),
      ...(p.source === undefined ? {} : { source: inside(p.source) }),
    })),
    deleted: call.deleted.map(inside),
  }
}

/** Whether `at` holds what `stamp` says: its size and ctime, read without following a link. */
async function holdsStamp(
  at: string,
  stamp: ReadPath["stamp"],
): Promise<boolean> {
  const s = await lstat(at, { bigint: true }).catch(() => null)
  return (
    s !== null &&
    (s.isFile() || s.isSymbolicLink()) &&
    s.size === BigInt(stamp.size) &&
    s.ctimeNs === BigInt(stamp.ctimeNs)
  )
}

/** Make every directory above `p` on `root`, replacing a file or a link where one stands. */
async function makeParents(root: string, p: string): Promise<void> {
  const parts = p.split("/")
  for (let i = 1; i < parts.length; i++) {
    const at = path.join(root, ...parts.slice(0, i))
    const s = await lstatOrNull(at)
    if (s?.isDirectory()) continue
    if (s !== null) await rm(at, { force: true })
    await mkdir(at)
  }
}

/** Remove `p`'s directories on `root` that a delete left empty, deepest first. */
async function pruneEmpty(root: string, p: string): Promise<void> {
  for (let at = path.dirname(p); at !== "."; at = path.dirname(at))
    if (
      !(await rmdir(path.join(root, at)).then(
        () => true,
        () => false,
      ))
    )
      return
}

/**
 * Carry out a read: the line's disk made from its newest state, the deleted
 * paths removed, each path copied from the project's folder (from its
 * `source`, when it names one) with its stamp checked
 * before and after (a read that saw no stamp move held one version whole),
 * then the disk snapshotted as the new state. A path whose stamp moved, or
 * that is under a symlink in the project's folder now, makes no state: the host
 * reads again. A symlink is made again; the disk is dropped either way.
 */
export async function executeReadIn(
  planned: ReadInPlanned,
): Promise<ReadInAnswer> {
  const { folder, diskPath: disk } = planned
  await executeDiskSteps(planned.disk)
  try {
    for (const p of planned.deleted) {
      if (!(await isUnderDirs(disk, p))) continue
      await rm(path.join(disk, p), { recursive: true, force: true })
      await pruneEmpty(disk, p)
    }
    const moved: string[] = []
    for (const { path: p, source = p, stamp } of planned.paths) {
      const from = path.join(folder, source)
      if (
        !(await isUnderDirs(folder, source)) ||
        !(await holdsStamp(from, stamp))
      ) {
        moved.push(p)
        continue
      }
      await makeParents(disk, p)
      const to = path.join(disk, p)
      await rm(to, { recursive: true, force: true })
      const s = await lstat(from)
      // `copyFile` keeps the file's mode, its executable bits with it.
      if (s.isSymbolicLink()) await symlink(await readlink(from), to)
      else await copyFile(from, to)
      if (!(await holdsStamp(from, stamp))) moved.push(p)
    }
    if (moved.length > 0) return { kind: "moved", paths: moved }
    await executeDiskSteps(planned.snapshot)
    return { kind: "made" }
  } finally {
    await executeDiskSteps(planned.drop)
  }
}

/** `git diff --no-index` of `p` between two snapshots, from the snapshots' directory; `/dev/null` for a side without it. */
async function gitDiffOf(
  disks: ProjectDisks,
  a: string,
  b: string,
  p: string,
  flags: readonly string[],
): Promise<string> {
  const side = async (name: string) => {
    const root = disks.snapshot(named(name))
    return (await isUnderDirs(root, p)) &&
      (await lstatOrNull(path.join(root, p))) !== null
      ? `${name}/${p}`
      : "/dev/null"
  }
  const ran = await runCommand(
    [
      "git",
      "diff",
      "--no-index",
      "--no-color",
      "--no-ext-diff",
      ...flags,
      "--",
      await side(a),
      await side(b),
    ],
    {
      cwd: disks.snapshots,
      bytes: false,
      signal: new AbortController().signal,
    },
  )
  // 1 is "they differ"; anything else is git's failure.
  if (ran.code !== 0 && ran.code !== 1)
    throw new Error(`git diff ${p}: ${String(ran.stderr).trim()}`)
  return String(ran.stdout)
}

/**
 * One file's unified diff between snapshots `a` and `b`, its paths from the
 * disk's root as jj's `--git` prints them; cut one byte past `limit`, so
 * its reader can tell it was too large.
 */
export async function fileDiff(
  disks: ProjectDisks,
  a: string,
  b: string,
  p: string,
  limit: number,
): Promise<string> {
  const text = (await gitDiffOf(disks, a, b, inside(p), []))
    .replaceAll(`a/${a}/`, "a/")
    .replaceAll(`b/${b}/`, "b/")
  return text.length > limit ? text.slice(0, limit + 1) : text
}

/** Lines added and removed in each of `paths` between snapshots `a` and `b`; 0 and 0 for a binary file. */
export async function diffStats(
  disks: ProjectDisks,
  a: string,
  b: string,
  paths: readonly string[],
): Promise<readonly DiffStat[]> {
  const out: DiffStat[] = []
  for (const p of paths.map(inside)) {
    const [added = "0", removed = "0"] = (
      await gitDiffOf(disks, a, b, p, ["--numstat"])
    ).split("\t")
    const n = (s: string) => (/^\d+$/.test(s) ? Number(s) : 0)
    out.push({ path: p, added: n(added), removed: n(removed) })
  }
  return out
}
