// vm/grow — the lane VM's data disk grown before the launcher starts it, so
// the guest's `init` takes the new size at that boot (`btrfs filesystem
// resize max`). Only larger: a sparse file grown costs the volume nothing
// until the guest writes into it.

import { stat, statfs, truncate } from "node:fs/promises"

/** The data disk and the volume holding it, in bytes, as read before a start. */
export interface DataDiskFacts {
  readonly size: number
  /** What the sparse file holds on the volume. */
  readonly allocated: number
  readonly volumeFree: number
  readonly volumeSize: number
}

/** The size the data disk should grow to, or null to leave it: the host's plan. */
export type DataDiskPlan = (facts: DataDiskFacts) => number | null

/**
 * `dataPath` grown to what `plan` says, if larger than it is; nothing for a
 * disk not made yet, which the launcher makes. The sizes it went from and
 * to, or null for none.
 */
export async function growDataDisk(
  dataPath: string,
  volume: string,
  plan: DataDiskPlan,
): Promise<{ readonly from: number; readonly to: number } | null> {
  const file = await stat(dataPath).catch(() => null)
  if (file === null) return null
  const fs = await statfs(volume)
  const to = plan({
    size: file.size,
    allocated: file.blocks * 512,
    volumeFree: fs.bavail * fs.bsize,
    volumeSize: fs.blocks * fs.bsize,
  })
  if (to === null || to <= file.size) return null
  await truncate(dataPath, to)
  return { from: file.size, to }
}
