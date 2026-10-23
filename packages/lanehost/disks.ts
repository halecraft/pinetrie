// lanehost/disks — a project's disks: each operation planned as `DiskStep`s,
// then carried out by `executeDiskSteps` on the store (`btrfs.ts`).
// Snapshots are read-only, as `btrfs send` needs: a restore is a writable
// snapshot of one.

import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
} from "node:fs/promises"
import path from "node:path"
import { runCommand } from "@pinetrie/channel"
import { type DiskOp, isDiskName, isPathInside } from "@pinetrie/core"
import type { HeldLock } from "@pinetrie/lock"
import {
  createSubvolume,
  drop,
  exists,
  isSubvolume,
  snapshotSubvolume,
} from "./btrfs.ts"
import { type NestedDisk, nestedDataRoot, type ProjectDisks } from "./layout.ts"

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
  /** Make a directory at `path`, and its parents, unless one is there. */
  | { readonly kind: "dir"; readonly path: string }

/** A disk operation planned without reading the disk: every one but a data root's. */
type PlainDiskOp = Exclude<DiskOp, { readonly kind: "inner-docker-data-root" }>

const names = (call: PlainDiskOp): readonly string[] => {
  switch (call.kind) {
    case "create":
      return [call.lane]
    case "restore":
      return [call.lane, call.from]
    case "snapshot":
      return [call.lane, call.snapshot]
    case "delete":
    case "states-dir":
      return [call.lane]
    case "delete-snapshots":
      return call.ids
  }
}

/**
 * A disk operation as steps. A snapshot is made at `<id>.tmp`, then moved
 * into place, so a snapshot read is never half-made: the base's is replaced
 * at each refresh. Throws on a name that is not a disk's.
 */
export function planDisk(
  call: PlainDiskOp,
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
    case "delete-snapshots":
      return call.ids.map(id => ({ kind: "drop", path: disks.snapshot(id) }))
    case "states-dir":
      return [{ kind: "dir", path: disks.states(call.lane) }]
  }
}

/** What is at a path a data root may be at. */
export type DataRootState = "subvolume" | "not-subvolume" | "absent"

/** What is on disk for a lane's inner Docker data root, and for the one it may clone. */
export interface InnerDockerDataRootFacts {
  readonly ownDataRoot: DataRootState
  /** Null when no lane to clone from was named. */
  readonly sourceDataRoot: DataRootState | null
}

/**
 * A nested lane's disk, `given`'s owner's, and its inner Docker data root
 * in it: a writable snapshot of `cloneFromLane`'s when that one is a
 * subvolume, in place of the lane's own; else the lane's own, made a
 * subvolume owned by `given`'s owner unless it is one. So a lane to clone
 * from whose data root has gone leaves the lane's as it is. Throws on a name
 * that is not a disk's.
 */
export function planInnerDockerDataRootSteps(
  lane: string,
  cloneFromLane: string | null,
  facts: InnerDockerDataRootFacts,
  disks: ProjectDisks,
  given: NestedDisk,
): readonly DiskStep[] {
  const bad = [lane, cloneFromLane].find(n => n !== null && !isDiskName(n))
  if (bad !== undefined)
    throw new Error(`not a disk's name: ${JSON.stringify(bad)}`)
  const nested = disks.nested(lane)
  const dataRoot = nestedDataRoot(disks, given, lane)
  const disk: DiskStep[] = [
    { kind: "parent", path: nested },
    { kind: "ensure", path: nested, uid: given.owner },
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
        from: nestedDataRoot(disks, given, cloneFromLane),
        to: dataRoot,
        readonly: false,
      },
    ]
  if (facts.ownDataRoot === "subvolume") return disk
  return [
    ...disk,
    ...(facts.ownDataRoot === "not-subvolume"
      ? [{ kind: "drop", path: dataRoot } as const]
      : []),
    { kind: "ensure", path: dataRoot, uid: given.owner },
  ]
}

/** What `planInnerDockerDataRootSteps` decides from, read from the disk. */
export async function innerDockerDataRootFacts(
  lane: string,
  cloneFromLane: string | null,
  disks: ProjectDisks,
  given: NestedDisk,
): Promise<InnerDockerDataRootFacts> {
  const state = async (at: string): Promise<DataRootState> =>
    (await isSubvolume(at))
      ? "subvolume"
      : (await exists(at))
        ? "not-subvolume"
        : "absent"
  return {
    ownDataRoot: await state(nestedDataRoot(disks, given, lane)),
    sourceDataRoot:
      cloneFromLane === null || !isDiskName(cloneFromLane)
        ? null
        : await state(nestedDataRoot(disks, given, cloneFromLane)),
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

/**
 * Every snapshot in the making (`<id>.tmp`) under a project's snapshots,
 * dropped: what a snapshot cut short left. It takes the project's lock, so
 * only a server holding it drops one: no other host's server is making a
 * snapshot then. Read by a listing alone; `drop` removes whatever is there.
 */
export async function dropUnfinishedSnapshots(
  _held: HeldLock,
  disks: ProjectDisks,
): Promise<readonly string[]> {
  const names = await readdir(disks.snapshots).catch(() => [] as string[])
  const unfinished = names.filter(n => n.endsWith(".tmp")).sort()
  await executeDiskSteps(
    unfinished.map(n => ({
      kind: "drop",
      path: path.join(disks.snapshots, n),
    })),
  )
  return unfinished
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
        await createSubvolume(step.path)
        break
      case "snapshot":
        await snapshotSubvolume(step.from, step.to, step.readonly)
        break
      case "drop":
        await drop(step.path)
        break
      case "move":
        await rename(step.from, step.to)
        break
      case "dir":
        await mkdir(step.path, { recursive: true })
        break
      case "ensure": {
        if (!(await exists(step.path))) await createSubvolume(step.path)
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
