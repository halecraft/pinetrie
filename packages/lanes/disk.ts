// lanes/disk — snapshots and their upkeep (ADR-0034, S40, S41).
//
// A snapshot is a copy-on-write clone of a lane's `volume.img`, a file under
// `.pinetrie/snapshots/`. Writing a clone into a volume `container` created is
// not an API of `container` 1.4.1: a volume is its `entity.json` and an image
// read by path (S40). The contract test in `e2e:lanes` guards it on every
// upgrade.

import { rm, stat } from "node:fs/promises"
import type { SnapshotId } from "@pinetrie/core"
import { type DiskPaths, snapshotFile } from "./plan.ts"
import { describeFailure, run } from "./run.ts"

export const snapshotExists = (
  paths: DiskPaths,
  id: SnapshotId,
): Promise<boolean> =>
  stat(snapshotFile(paths, id)).then(
    () => true,
    () => false,
  )

/**
 * Delete snapshots one after another: each deletion of a clone takes about
 * 280 ms (S40 item 4), so the caller does not await this on anyone's path.
 */
export async function removeSnapshots(
  paths: DiskPaths,
  ids: readonly SnapshotId[],
): Promise<void> {
  for (const id of ids) await rm(snapshotFile(paths, id), { force: true })
}

/**
 * Give back the space a lane deleted, on its stopped disk, in a short-lived
 * container with `CAP_SYS_ADMIN` (S40 item 8). A lane's own container never
 * has that capability.
 */
export async function trim(volume: string, image: string): Promise<void> {
  const ran = await run("container", [
    "run",
    "--rm",
    "--cap-add",
    "CAP_SYS_ADMIN",
    "-v",
    `${volume}:/disk`,
    image,
    "fstrim",
    "/disk",
  ])
  if (!ran.ok) throw new Error(describeFailure("fstrim", ran))
}
