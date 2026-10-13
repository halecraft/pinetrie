// pi/lane-runs — a lane's runs, drained on the host: its `RunSource`'s
// notices up to a flush, folded with what its helper knows (each run it
// launched; `@pinetrie/rules`' fold), then drained into records once the
// lane has said which of the changed paths exist.

import type { LaneRuns, RunSource } from "@pinetrie/core"
import {
  dirtyPaths,
  drainLane,
  foldLaneDrain,
  type RunTrace,
} from "@pinetrie/rules"
import type { LaneChannel } from "./lane-env.ts"

/** Each lane's traces, by its channel: a run outlives no helper. */
const traces = new WeakMap<LaneChannel, ReadonlyMap<string, RunTrace>>()

/**
 * Everything the lane's runs and tools did since the last drain. One drain
 * at a time per lane: the lane's queue runs it.
 */
export async function drainLaneRuns(
  channel: LaneChannel,
  source: RunSource,
): Promise<LaneRuns> {
  const notices = await source.flush()
  const drain = await channel.runs()
  const folded = foldLaneDrain(traces.get(channel) ?? new Map(), {
    drain,
    notices,
  })
  const dirty = dirtyPaths(folded)
  const present = new Set(
    dirty.length === 0 ? [] : await channel.present(dirty),
  )
  const drained = drainLane(folded, present, drain)
  traces.set(channel, drained.traces)
  return drained.runs
}
