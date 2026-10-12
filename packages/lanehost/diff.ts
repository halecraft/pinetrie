// lanehost/diff — what differs between two read-only snapshots of a disk:
// by `btrfs send --no-data` where the role holds `SYS_ADMIN` in the host's
// user namespace, about 2 ms for a turn's change; by walking both trees
// under rootless Docker, where it cannot. `planRoles` decides
// which, once, from the machine's facts.

import { runCommand } from "@pinetrie/channel"
import type { DiskDiff } from "@pinetrie/core"
import { foldSendStream, readSendStream } from "./send-stream.ts"
import { compareTrees, walkTree } from "./walk.ts"

/** How long a diff may take before it is refused: a runaway lane's guard, not a switch. */
const DIFF_TIMEOUT_MS = 120_000

/** The diff by `btrfs send --no-data -p from to`; both must be read-only. */
export async function diffBySend(from: string, to: string): Promise<DiskDiff> {
  const ran = await runCommand(
    ["btrfs", "send", "-q", "--no-data", "-p", from, to],
    { cwd: "/", bytes: true, signal: AbortSignal.timeout(DIFF_TIMEOUT_MS) },
  )
  if (ran.code !== 0)
    throw new Error(
      `btrfs send: ${String(ran.stderr).trim().split("\n")[0] ?? ""}`,
    )
  if (!(ran.stdout instanceof Uint8Array))
    throw new Error("btrfs send gave text")
  return { changes: foldSendStream(readSendStream(ran.stdout)) }
}

export async function diffByWalk(from: string, to: string): Promise<DiskDiff> {
  const [before, after] = await Promise.all([walkTree(from), walkTree(to)])
  return { changes: compareTrees(before, after) }
}
