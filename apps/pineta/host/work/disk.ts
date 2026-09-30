// host/work/disk — the steps two lane operations share.

import { createHash } from "node:crypto"
import { type EntryId, snapshotId } from "@pineta/core"
import {
  type DiskPaths,
  executeOrThrow,
  type LaneHandle,
  planSnapshot,
  type Runner,
} from "@pineta/lanes"
import type { LaneChannel } from "@pineta/pi"

/**
 * Snapshot a lane's volume as `entry`'s, on its queue: after the steps queued
 * before, so it never overlaps a turn's writes. Resolves true once taken;
 * rejects if it failed, which each caller handles its own way.
 */
export const snapshotOnQueue = (
  handle: LaneHandle<LaneChannel>,
  paths: DiskPaths,
  entry: EntryId,
): Promise<true> =>
  handle.queue.enqueue(async () => {
    await executeOrThrow(
      planSnapshot({
        volume: handle.container,
        snapshot: snapshotId(entry),
        paths,
      }),
      handle.runners,
    )
    return true as const
  })

/** The lockfile's hash at a revision of your repo, or null if it has none. */
export async function lockHashAt(
  jj: Runner,
  rev: string,
  lockfile: string,
): Promise<string | null> {
  const shown = await jj([
    "file",
    "show",
    "--ignore-working-copy",
    "-r",
    rev,
    `root:${JSON.stringify(lockfile)}`,
  ])
  return shown.ok
    ? createHash("sha256").update(shown.stdout).digest("hex")
    : null
}
