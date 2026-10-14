// lanes/base — the base snapshot: accepted work's commits, checked out on
// the base before it.
//
// Root lanes fork from it as other lanes fork from a turn's snapshot. A
// refresh copies the base it replaces (a new one starts empty) and checks
// out accepted work on it, so what a refresh leaves is what a pull would.
// The base never runs a command, so it holds no derived file: a lane makes
// its own. It is made in a scratch lane (`BASE_LANE`), then snapshotted as a
// turn is, so a fork never reads one half-written. The base says what it
// holds inside itself (`.pinetrie-lane/base.json`).

import { BASE_SNAPSHOT, type CommitId, type SnapshotId } from "@pinetrie/core"
import { executeOrThrow, type Runners } from "./execute.ts"
import type { BaseCheckout } from "./history-port.ts"
import { laneHandle, type OpenLink, removeLane } from "./lane.ts"
import {
  BASE_FILE,
  BASE_LANE,
  isBaseCurrent,
  isCopyableBase,
  type LaneOwner,
  type LaneSpec,
  laneContainer,
  parseBaseFacts,
  planBaseFacts,
  planDisk,
  planSnapshot,
} from "./plan.ts"
import type { LaneRuntime } from "./runtime-port.ts"

/** What building in the scratch lane takes. */
interface Scratch<C> {
  readonly runtime: LaneRuntime
  /** The scratch lane's spec; its lane is replaced. */
  readonly spec: LaneSpec<LaneOwner>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly open: OpenLink<C>
}

/** `work` in the scratch lane, made anew, removed after whatever happens. */
async function inScratch<C, T>(
  scratch: Scratch<C>,
  from: SnapshotId | null,
  work: (runners: Runners) => Promise<T>,
): Promise<T> {
  const { runtime } = scratch
  await removeLane(runtime, BASE_LANE)
  const handle = laneHandle(runtime, laneContainer(BASE_LANE), scratch.open)
  try {
    await executeOrThrow(
      planDisk({
        spec: { ...scratch.spec, lane: BASE_LANE },
        env: scratch.env,
        from,
      }),
      handle.runners,
    )
    return await work(handle.runners)
  } finally {
    await handle.stop().catch(() => {})
    await removeLane(runtime, BASE_LANE)
  }
}

/**
 * Make the base snapshot at `yours`: the base before it restored (none, or
 * one made another way, gives an empty disk), `yours` checked out on it, its
 * facts written, then snapshotted. Does nothing when the base already holds
 * them.
 */
export async function refreshBase<C>(
  input: Scratch<C> & {
    readonly yours: readonly CommitId[]
    /** The adapter's checkout of `yours`, on a fresh disk or on the base before. */
    readonly checkout: (fresh: boolean) => BaseCheckout
  },
): Promise<boolean> {
  const { runtime, yours } = input
  const base = parseBaseFacts(
    await runtime.readLaneFile(BASE_SNAPSHOT, BASE_FILE),
  )
  if (isBaseCurrent(base, yours)) return false
  const from = isCopyableBase(base) ? BASE_SNAPSHOT : null
  await inScratch(input, from, async runners => {
    await executeOrThrow(
      [
        ...input.checkout(from === null).steps,
        planBaseFacts(yours),
        ...planSnapshot({ lane: BASE_LANE, snapshot: BASE_SNAPSHOT }),
      ],
      runners,
    )
  })
  return true
}
