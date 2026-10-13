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
//
// Also a lane's base as its history names it (`laneBase`), read the same way
// from the lane's own repo and from yours.

import {
  BASE_SNAPSHOT,
  type CommitId,
  type LaneBase,
  type SnapshotId,
} from "@pinetrie/core"
import { executeOrThrow, type Runners } from "./execute.ts"
import { laneHandle, type OpenLink, removeLane } from "./lane.ts"
import { newestBase } from "./merge.ts"
import {
  BASE_FILE,
  BASE_LANE,
  isBaseCurrent,
  isCopyableBase,
  type LaneOwner,
  type LaneSpec,
  laneContainer,
  parseBaseFacts,
  planBaseCheckout,
  planBaseFacts,
  planDisk,
  planSnapshot,
  type RepoConfig,
  revsetName,
} from "./plan.ts"
import { commitsOf } from "./revisions.ts"
import type { Runner } from "./run.ts"
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
  input: Scratch<C> & { readonly yours: readonly CommitId[] },
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
        ...planBaseCheckout({ yours, fresh: from === null }),
        planBaseFacts(yours),
        ...planSnapshot({ lane: BASE_LANE, snapshot: BASE_SNAPSHOT }),
      ],
      runners,
    )
  })
  return true
}

/**
 * A lane's base, from the newest `Pinetrie-Base` in the history of `tip`, a
 * revset: the lane's tip in your repo, or its bookmark in its own repo. A
 * lane with none (one from before accepted work) is on accepted work, from the newest
 * accepted commit in its history; null when there is none. In the lane's own
 * repo such a lane is always null: that repo has no line bookmark.
 */
export async function laneBase(
  jj: Runner,
  tip: string,
  repoConfig: RepoConfig,
): Promise<LaneBase | null> {
  const newest = await newestBase(jj, tip, repoConfig.wipPrefix)
  if (newest === null) {
    const [start] = await commitsOf(
      jj,
      `latest(heads(::(${tip}) & ::present(${revsetName(repoConfig.acceptedBookmark)})))`,
    )
    return start === undefined
      ? null
      : { base: { kind: "accepted" }, start, source: start }
  }
  return newest.kind === "accepted"
    ? {
        base: { kind: "accepted" },
        start: newest.commit,
        source: newest.commit,
      }
    : {
        base: { kind: "wip", bookmark: newest.bookmark },
        start: newest.at,
        source: newest.commit,
      }
}
