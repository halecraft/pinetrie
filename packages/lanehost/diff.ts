// lanehost/diff — what differs between two read-only snapshots of a disk:
// by `btrfs send --no-data` where the role holds `SYS_ADMIN` in the host's
// user namespace, about 2 ms for a turn's change, its stream folded as it
// arrives; by walking both trees
// under rootless Docker, where it cannot. `planRoles` decides
// which, once, from the machine's facts.

import { streamCommand } from "@pinetrie/channel"
import type { DiskDiff } from "@pinetrie/core"
import { sendFold, sendReader } from "./send-stream.ts"
import { compareTrees, walkTree } from "./walk.ts"

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

export async function diffByWalk(from: string, to: string): Promise<DiskDiff> {
  const [before, after] = await Promise.all([walkTree(from), walkTree(to)])
  return { changes: compareTrees(before, after) }
}
