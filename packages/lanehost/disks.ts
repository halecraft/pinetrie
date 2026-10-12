// lanehost/disks — a project's disks as btrfs subvolumes, on a filesystem
// mounted with `user_subvol_rm_allowed`, so none of it needs a capability.
// Each operation is planned as `DiskStep`s, then carried out by `executeDiskSteps`. Snapshots are read-only, as `btrfs send`
// needs: a restore is a writable snapshot of one, and a delete makes one
// writable first.

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
import {
  isDiskName,
  isLaneFile,
  LANE_FILES,
  type ProjectDisks,
} from "./layout.ts"
import type { DiskCall, SnapshotListed } from "./protocol.ts"

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
   * writable first (a read-only one is refused otherwise); anything
   * else, or a subvolume btrfs refuses, by `rm -rf`. An inner Docker makes
   * subvolumes inside a nested lane's disk, and `rmdir` of an empty
   * subvolume is a delete with `user_subvol_rm_allowed`.
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
      ]
    case "deleteSnapshots":
      return call.ids.map(id => ({ kind: "drop", path: disks.snapshot(id) }))
  }
}

/** A nested lane's inner lanes' subvolume, made if missing, owned by the rootless user. */
export function planNestedDisk(
  lane: string,
  disks: ProjectDisks,
): readonly DiskStep[] {
  if (!isDiskName(lane))
    throw new Error(`not a disk's name: ${JSON.stringify(lane)}`)
  const at = disks.nested(lane)
  return [
    { kind: "parent", path: at },
    { kind: "ensure", path: at, uid: ROOTLESS_UID },
  ]
}

/** A subvolume's root is inode 256: `btrfs subvolume show` needs a capability. */
export async function isSubvolume(at: string): Promise<boolean> {
  try {
    return (await stat(at)).ino === 256
  } catch {
    return false
  }
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

async function drop(at: string): Promise<void> {
  if (!(await exists(at))) return
  if (await isSubvolume(at)) {
    // A read-only subvolume is deleted only once it is writable again.
    await runCommand(["btrfs", "property", "set", at, "ro", "false"], {
      cwd: "/",
      bytes: false,
      signal: new AbortController().signal,
    })
    const deleted = await btrfs(["subvolume", "delete", at]).then(
      () => true,
      () => false,
    )
    if (deleted) return
  }
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

/** A project's snapshots, each with when it was made; none in the making. */
export async function listSnapshots(
  disks: ProjectDisks,
): Promise<readonly SnapshotListed[]> {
  const entries = await readdir(disks.snapshots).catch(() => [] as string[])
  const out: SnapshotListed[] = []
  for (const id of entries.sort()) {
    if (!isDiskName(id)) continue
    const at = disks.snapshot(id)
    if (!(await isSubvolume(at))) continue
    const s = await stat(at)
    out.push({ id, made: s.birthtimeMs > 0 ? s.birthtimeMs : s.mtimeMs })
  }
  return out
}

/**
 * A file of pine·trie's (`.pinetrie-lane/<file>`) inside a snapshot, or null
 * when it is not there. Its real path must stay inside the snapshot: a
 * snapshot does not change, so what was checked is what is read.
 */
export async function readLaneFile(
  disks: ProjectDisks,
  snapshot: string,
  file: string,
): Promise<string | null> {
  if (!isDiskName(snapshot))
    throw new Error(`not a disk's name: ${JSON.stringify(snapshot)}`)
  if (!isLaneFile(file))
    throw new Error(`not a file of pine·trie's: ${JSON.stringify(file)}`)
  const root = disks.snapshot(snapshot)
  let real: string
  try {
    real = await realpath(path.join(root, LANE_FILES, file))
  } catch {
    return null
  }
  const base = await realpath(root)
  if (!real.startsWith(`${base}/`))
    throw new Error(`${file} leaves its snapshot`)
  return readFile(real, "utf8")
}
