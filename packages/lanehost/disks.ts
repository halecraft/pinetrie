// lanehost/disks — a project's disks as btrfs subvolumes, on a filesystem
// mounted with `user_subvol_rm_allowed`, so none of it needs a capability.
// Each operation is planned as `DiskStep`s, then carried out by
// `executeDiskSteps`. Snapshots are read-only, as `btrfs send` needs: a
// restore is a writable snapshot of one, and a delete makes one writable
// first.

import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises"
import path from "node:path"
import { runCommand } from "@pinetrie/channel"
import { isDiskName, isPathInside } from "@pinetrie/core"
import type { ProjectDisks } from "./layout.ts"
import type { DiskCall } from "./protocol.ts"

/** The rootless user, who owns a nested lane's inner lanes' disk. */
export const ROOTLESS_UID = 1000

/** One thing done to the disks. */
export type DiskStep =
  /** Make the directory a path is in. */
  | { readonly kind: "parent"; readonly path: string }
  | { readonly kind: "create"; readonly path: string }
  /** A snapshot of `from` at `to`: read-only, as `btrfs send` needs, or a writable restore. */
  | {
      readonly kind: "snapshot"
      readonly from: string
      readonly to: string
      readonly readonly: boolean
    }
  /**
   * Delete what is at `path`, if anything: a subvolume by btrfs, made
   * writable first (a read-only one is refused otherwise); anything else by
   * `rm -rf`. Where btrfs refuses, the subvolumes inside go first, deepest
   * first: an inner Docker or lanehost makes them in a nested lane's disk,
   * an agent in its lane.
   */
  | { readonly kind: "drop"; readonly path: string }
  | { readonly kind: "move"; readonly from: string; readonly to: string }
  /** Make a subvolume at `path` unless one is there, owned by `uid`. */
  | { readonly kind: "ensure"; readonly path: string; readonly uid: number }

const names = (call: DiskCall): readonly string[] => {
  switch (call.kind) {
    case "create":
      return [call.lane]
    case "restore":
      return [call.lane, call.from]
    case "snapshot":
      return [call.lane, call.snapshot]
    case "delete":
      return [call.lane]
    case "deleteSnapshots":
      return call.ids
  }
}

/**
 * A disk operation as steps. A snapshot is made at `<id>.tmp`, then moved
 * into place, so a snapshot read is never half-made: the base's is replaced
 * at each refresh. Throws on a name that is not a disk's.
 */
export function planDisk(
  call: DiskCall,
  disks: ProjectDisks,
): readonly DiskStep[] {
  const bad = names(call).find(n => !isDiskName(n))
  if (bad !== undefined)
    throw new Error(`not a disk's name: ${JSON.stringify(bad)}`)
  switch (call.kind) {
    case "create": {
      const at = disks.lane(call.lane)
      return [
        { kind: "parent", path: at },
        { kind: "create", path: at },
      ]
    }
    case "restore":
      return [
        { kind: "parent", path: disks.lane(call.lane) },
        {
          kind: "snapshot",
          from: disks.snapshot(call.from),
          to: disks.lane(call.lane),
          readonly: false,
        },
      ]
    case "snapshot": {
      const to = disks.snapshot(call.snapshot)
      return [
        { kind: "parent", path: to },
        { kind: "drop", path: `${to}.tmp` },
        {
          kind: "snapshot",
          from: disks.lane(call.lane),
          to: `${to}.tmp`,
          readonly: true,
        },
        { kind: "drop", path: to },
        { kind: "move", from: `${to}.tmp`, to },
      ]
    }
    case "delete":
      return [
        { kind: "drop", path: disks.lane(call.lane) },
        { kind: "drop", path: disks.nested(call.lane) },
        { kind: "drop", path: disks.states(call.lane) },
      ]
    case "deleteSnapshots":
      return call.ids.map(id => ({ kind: "drop", path: disks.snapshot(id) }))
  }
}

/** What is at a path a data root may be at. */
export type DataRootState = "subvolume" | "notSubvolume" | "absent"

/** What is on disk for a lane's inner Docker data root, and for the one it may clone. */
export interface InnerDockerDataRootFacts {
  readonly ownDataRoot: DataRootState
  /** Null when no lane to clone from was named. */
  readonly sourceDataRoot: DataRootState | null
}

/**
 * A nested lane's disk, the rootless user's, and its inner Docker data root
 * in it: a writable snapshot of `cloneFromLane`'s when that one is a
 * subvolume, in place of the lane's own; else the lane's own, made a
 * subvolume owned by the rootless user unless it is one. So a lane to clone
 * from whose data root has gone leaves the lane's as it is. Throws on a name
 * that is not a disk's.
 */
export function planInnerDockerDataRootSteps(
  lane: string,
  cloneFromLane: string | null,
  facts: InnerDockerDataRootFacts,
  disks: ProjectDisks,
): readonly DiskStep[] {
  const bad = [lane, cloneFromLane].find(n => n !== null && !isDiskName(n))
  if (bad !== undefined)
    throw new Error(`not a disk's name: ${JSON.stringify(bad)}`)
  const nested = disks.nested(lane)
  const dataRoot = disks.innerDockerDataRoot(lane)
  const disk: DiskStep[] = [
    { kind: "parent", path: nested },
    { kind: "ensure", path: nested, uid: ROOTLESS_UID },
  ]
  // The lane itself is never a source: its data root would be dropped first.
  if (
    cloneFromLane !== null &&
    cloneFromLane !== lane &&
    facts.sourceDataRoot === "subvolume"
  )
    return [
      ...disk,
      { kind: "drop", path: dataRoot },
      {
        kind: "snapshot",
        from: disks.innerDockerDataRoot(cloneFromLane),
        to: dataRoot,
        readonly: false,
      },
    ]
  if (facts.ownDataRoot === "subvolume") return disk
  return [
    ...disk,
    ...(facts.ownDataRoot === "notSubvolume"
      ? [{ kind: "drop", path: dataRoot } as const]
      : []),
    { kind: "ensure", path: dataRoot, uid: ROOTLESS_UID },
  ]
}

/** What `planInnerDockerDataRootSteps` decides from, read from the disk. */
export async function innerDockerDataRootFacts(
  lane: string,
  cloneFromLane: string | null,
  disks: ProjectDisks,
): Promise<InnerDockerDataRootFacts> {
  const state = async (at: string): Promise<DataRootState> =>
    (await isSubvolume(at))
      ? "subvolume"
      : (await exists(at))
        ? "notSubvolume"
        : "absent"
  return {
    ownDataRoot: await state(disks.innerDockerDataRoot(lane)),
    sourceDataRoot:
      cloneFromLane === null || !isDiskName(cloneFromLane)
        ? null
        : await state(disks.innerDockerDataRoot(cloneFromLane)),
  }
}

/** A subvolume's root is inode 256: `btrfs subvolume show` needs a capability. */
export async function isSubvolume(at: string): Promise<boolean> {
  try {
    return (await stat(at)).ino === 256
  } catch {
    return false
  }
}

/**
 * The names of a project's snapshots, sorted: each a subvolume under its
 * snapshots directory with a disk's name, so one in the making (`.tmp`)
 * is none yet.
 */
export async function snapshotsIn(disks: ProjectDisks): Promise<string[]> {
  const entries = await readdir(disks.snapshots, { withFileTypes: true }).catch(
    () => [],
  )
  const found: string[] = []
  for (const e of entries)
    if (
      e.isDirectory() &&
      isDiskName(e.name) &&
      (await isSubvolume(path.join(disks.snapshots, e.name)))
    )
      found.push(e.name)
  return found.sort()
}

const btrfs = async (args: readonly string[]): Promise<void> => {
  const ran = await runCommand(["btrfs", "-q", ...args], {
    cwd: "/",
    bytes: false,
    signal: new AbortController().signal,
  })
  if (ran.code !== 0)
    throw new Error(
      `btrfs ${args.join(" ")}: ${String(ran.stderr).trim().split("\n")[0] ?? ""}`,
    )
}

const exists = (at: string) =>
  lstat(at).then(
    () => true,
    () => false,
  )

/** Make a read-only subvolume writable, then delete it; false where btrfs refuses. */
async function deleteSubvolume(at: string): Promise<boolean> {
  // A read-only subvolume is deleted only once it is writable again.
  await runCommand(["btrfs", "property", "set", at, "ro", "false"], {
    cwd: "/",
    bytes: false,
    signal: new AbortController().signal,
  })
  return btrfs(["subvolume", "delete", at]).then(
    () => true,
    () => false,
  )
}

/**
 * The subvolumes under `root`, not `root` itself: a directory whose inode
 * is 256. Never through a symlink, and never stopping where the device
 * changes, as each subvolume is a device of its own. Only directories are
 * kept: a nested disk holds an inner Docker's data root.
 */
async function subvolumesUnder(root: string): Promise<string[]> {
  const found: string[] = []
  const pending = [root]
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const at = path.join(dir, e.name)
      if (await isSubvolume(at)) found.push(at)
      pending.push(at)
    }
  }
  return found
}

/** Subvolumes in the order they can be deleted: each before every one above it. */
export const subvolumesDeepestFirst = (
  found: readonly string[],
): readonly string[] =>
  [...found].sort(
    (a, b) => b.split("/").length - a.split("/").length || (a < b ? -1 : 1),
  )

async function drop(at: string): Promise<void> {
  if (!(await exists(at))) return
  const subvolume = await isSubvolume(at)
  if (subvolume && (await deleteSubvolume(at))) return
  // btrfs refuses a subvolume that holds others, and `rm -rf` stops at a
  // read-only one (EROFS): an inner lanehost's snapshots, or one an agent
  // made in its lane. So those go first, each its own delete.
  for (const inner of subvolumesDeepestFirst(await subvolumesUnder(at)))
    await deleteSubvolume(inner)
  if (subvolume && (await deleteSubvolume(at))) return
  await rm(at, { recursive: true, force: true })
}

/** Carry out `steps` in order; throws at the first that fails. */
export async function executeDiskSteps(
  steps: readonly DiskStep[],
): Promise<void> {
  for (const step of steps) {
    switch (step.kind) {
      case "parent":
        await mkdir(path.dirname(step.path), { recursive: true })
        break
      case "create":
        await btrfs(["subvolume", "create", step.path])
        break
      case "snapshot":
        await btrfs([
          "subvolume",
          "snapshot",
          ...(step.readonly ? ["-r"] : []),
          step.from,
          step.to,
        ])
        break
      case "drop":
        await drop(step.path)
        break
      case "move":
        await rename(step.from, step.to)
        break
      case "ensure": {
        if (!(await exists(step.path)))
          await btrfs(["subvolume", "create", step.path])
        const ran = await runCommand(
          ["chown", `${step.uid}:${step.uid}`, step.path],
          {
            cwd: "/",
            bytes: false,
            signal: new AbortController().signal,
          },
        )
        if (ran.code !== 0) throw new Error(`chown ${step.path}: ${ran.stderr}`)
        break
      }
    }
  }
}

/**
 * A file inside a snapshot, by its path from the snapshot's root, or null
 * when it is not there. Its real path must stay inside the snapshot: a
 * snapshot does not change, so what was checked is what is read. Refused
 * when it holds more than `limit` bytes.
 */
export async function readSnapshotFile(
  disks: ProjectDisks,
  snapshot: string,
  file: string,
  limit: number,
): Promise<string | null> {
  if (!isDiskName(snapshot))
    throw new Error(`not a disk's name: ${JSON.stringify(snapshot)}`)
  if (!isPathInside(file))
    throw new Error(`not a path inside a snapshot: ${JSON.stringify(file)}`)
  const root = disks.snapshot(snapshot)
  let real: string
  try {
    real = await realpath(path.join(root, file))
  } catch {
    return null
  }
  const base = await realpath(root)
  if (!real.startsWith(`${base}/`))
    throw new Error(`${file} leaves its snapshot`)
  const { size } = await stat(real)
  if (size > limit)
    throw new Error(`${file} holds ${size} bytes, more than ${limit}`)
  return readFile(real, "utf8")
}
