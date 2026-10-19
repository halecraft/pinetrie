// lanes/base — the base snapshot: accepted work's states, checked out on
// the base before it.
//
// Root lanes fork from it as other lanes fork from a turn's snapshot. A
// refresh copies the base it replaces (a new one starts empty) and checks
// out accepted work on it, so what a refresh leaves is what a pull would.
// The base never runs a command, so it holds no derived file: a lane makes
// its own. It is made in a scratch lane (`BASE_LANE`), then snapshotted as a
// turn is, so a fork never reads one half-written. The base says what it
// holds inside itself (`.pinetrie-lane/base.json`).

import { BASE_SNAPSHOT, type SnapshotId } from "@pinetrie/core"
import { executeOrThrow, type Runners } from "./execute.ts"
import type { AcceptedNow } from "./history-port.ts"
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
 * Make the base snapshot at `accepted`: the base before it restored (none,
 * or one made another way, gives an empty disk), accepted work checked out
 * on it, its facts written, then snapshotted, `making` told first. Does
 * nothing when the base already holds them, or when accepted work has no
 * checkout: a kind with no base snapshot.
 */
export async function refreshBase<C>(
  input: Scratch<C> & {
    /** Accepted work as the adapter just read it, with its checkout, if any. */
    readonly accepted: AcceptedNow
    readonly making?: () => void
  },
): Promise<boolean> {
  const { runtime, accepted } = input
  const { checkout } = accepted
  if (checkout === null) return false
  const base = parseBaseFacts(
    await runtime.readLaneFile(BASE_SNAPSHOT, BASE_FILE),
  )
  if (isBaseCurrent(base, accepted.points)) return false
  const from = isCopyableBase(base) ? BASE_SNAPSHOT : null
  input.making?.()
  await inScratch(input, from, async runners => {
    await executeOrThrow(
      [
        ...checkout(from === null).steps,
        planBaseFacts(accepted.points),
        ...planSnapshot({ lane: BASE_LANE, snapshot: BASE_SNAPSHOT }),
      ],
      runners,
    )
  })
  return true
}
