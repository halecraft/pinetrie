// e2e/place — what the place a run starts in has, read for the plan in
// `requirements.ts`. Synchronous, so Vitest's config reads it as it loads.

import { accessSync, constants, statfsSync } from "node:fs"
import path from "node:path"
import type { UnitFacts } from "./requirements.ts"

/** `statfs`'s type for btrfs (`linux/magic.h`). */
const BTRFS_MAGIC = 0x9123683e

/**
 * The unit facts of the checkout at `root`. Its `node_modules` stands for
 * the folders the btrfs tests make subvolumes in, which lie under each
 * package's `node_modules`.
 */
export function gatherUnitFacts(root: string): UnitFacts {
  let checkoutOnBtrfs = false
  try {
    checkoutOnBtrfs =
      statfsSync(path.join(root, "node_modules")).type === BTRFS_MAGIC
  } catch {
    // No node_modules: nothing installed, and no test runs either.
  }
  return {
    platform: process.platform,
    checkoutOnBtrfs,
    hasFlock: isOnPath("flock"),
  }
}

/** Whether an executable named `program` is in a directory of `PATH`. */
function isOnPath(program: string): boolean {
  return (process.env.PATH ?? "").split(path.delimiter).some(dir => {
    if (dir === "") return false
    try {
      accessSync(path.join(dir, program), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}
