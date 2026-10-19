// lanehost/btrfs — the one store lanes' disks are on: btrfs subvolumes, on a
// filesystem mounted with `user_subvol_rm_allowed`, so none of it needs a
// capability. Another store (copies, reflinks, ZFS) is a module beside this
// one. A walk's diff (`walk.ts`) trusts what a btrfs snapshot keeps: an
// unchanged entry's inode and ctime; a copy changes both for every file.

import { constants } from "node:fs"
import { cp, lstat, readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { runCommand, streamCommand } from "@pinetrie/channel"
import type { DiskDiff } from "@pinetrie/core"
import { sendFold, sendReader } from "./send-stream.ts"

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

/** Whether anything is at `at`, a symlink included. */
export const exists = (at: string) =>
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

/**
 * Delete what is at `at`, if anything: a subvolume by btrfs, made writable
 * first; anything else by `rm -rf`. Where btrfs refuses, the subvolumes
 * inside go first, deepest first.
 */
export async function drop(at: string): Promise<void> {
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

/** A new, empty subvolume at `at`. */
export const createSubvolume = (at: string): Promise<void> =>
  btrfs(["subvolume", "create", at])

/** A snapshot of the subvolume `from` at `to`, read-only or writable. */
export const snapshotSubvolume = (
  from: string,
  to: string,
  readonly: boolean,
): Promise<void> =>
  btrfs(["subvolume", "snapshot", ...(readonly ? ["-r"] : []), from, to])

/** How long a diff may take before it is refused: a runaway lane's guard, not a switch. */
const DIFF_TIMEOUT_MS = 120_000

/**
 * The diff by `btrfs send --no-data -p from to`; both must be read-only.
 * The stream is folded as it arrives: held whole, with its commands, a
 * `pnpm install`'s is more than the privileged role's memory.
 */
export async function diffBySend(from: string, to: string): Promise<DiskDiff> {
  const reader = sendReader()
  const fold = sendFold()
  const ran = await streamCommand(
    ["btrfs", "send", "-q", "--no-data", "-p", from, to],
    {
      cwd: "/",
      signal: AbortSignal.timeout(DIFF_TIMEOUT_MS),
      onStdout: chunk => {
        for (const command of reader.feed(chunk)) fold.add(command)
      },
    },
  )
  if (ran.code !== 0)
    throw new Error(`btrfs send: ${ran.stderr.trim().split("\n")[0] ?? ""}`)
  reader.end()
  return { changes: fold.changes() }
}

/** Clone what is at `from` to `to`: a file by reflink, a symlink made again, a tree whole. */
export const cloneTree = (from: string, to: string) =>
  cp(from, to, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE_FORCE,
    errorOnExist: true,
  })
