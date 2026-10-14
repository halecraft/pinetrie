// pi/lane-runs — a lane's runs, drained on the host: its `RunSource`'s
// traces, folded as the runs' notices arrived, given the commands its
// helper launched, then drained into records once the lane has said which
// of the changed paths exist.

import type { LaneRuns, RunSource } from "@pinetrie/core"
import { dirtyPaths, drainLane, tracesWithCommands } from "@pinetrie/rules"
import type { LaneChannel } from "./lane-env.ts"

/**
 * Everything the lane's runs and tools did since the last drain. A drain
 * that throws leaves the runs to the next; the helper's launched commands
 * it took are lost, so those runs record none.
 */
export const drainLaneRuns = (
  channel: LaneChannel,
  source: RunSource,
): Promise<LaneRuns> =>
  source.drain(async folded => {
    const drain = await channel.runs()
    const traces = tracesWithCommands(folded, drain.launched)
    const dirty = dirtyPaths(traces)
    const present = new Set(
      dirty.length === 0 ? [] : await channel.present(dirty),
    )
    const drained = drainLane(traces, present, drain)
    return { traces: drained.traces, result: drained.runs }
  })
