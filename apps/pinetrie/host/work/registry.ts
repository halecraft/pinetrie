// host/work/registry — each lane's handle while the host may run it: its
// queue, and its channel once open. Only this module touches the handles.

import type { LaneName, LaneRecord } from "@pinetrie/core"
import {
  helperCommand,
  type LaneHandle,
  type LaneRuntime,
  laneContainer,
  laneHandle,
  laneJj,
  type OpenLink,
  type Runner,
} from "@pinetrie/lanes"
import { type LaneChannel, laneRunner, openChannel } from "@pinetrie/pi"
import { readLaneRecords } from "@pinetrie/reads"
import type { SessionDocHandle } from "@pinetrie/schema"

/** A lane's channel: pi's helper in its container, over the runtime's `exec -i`. */
export const openLinkOf =
  (runtime: LaneRuntime): OpenLink<LaneChannel> =>
  async container => {
    const channel = openChannel(helperCommand(runtime, container))
    await channel.ready
    const { run, bytes } = laneRunner(channel)
    return {
      channel,
      run,
      bytes,
      async close() {
        channel.close()
        await channel.closed
      },
    }
  }

export interface LaneRegistry {
  handleOf(lane: LaneName): LaneHandle<LaneChannel>
  /** The lane's own jj, through its channel. */
  laneJjOf(lane: LaneName): Runner
  recordOf(lane: LaneName): LaneRecord | undefined
  /** A lane that has its own container here. */
  isOwn(lane: LaneName): boolean
  /** Drop a lane's handle, stopping it: an archived lane. */
  forget(lane: LaneName): Promise<void>
  /** Stop every handle: the host's shutdown. */
  stopAll(): Promise<void>
}

export function createRegistry(input: {
  readonly session: SessionDocHandle
  /** What lanes of their own run on; null when they work directly. */
  readonly runtime: LaneRuntime | null
}): LaneRegistry {
  const { runtime } = input
  const handles = new Map<LaneName, LaneHandle<LaneChannel>>()
  const recordOf = (lane: LaneName) => readLaneRecords(input.session).get(lane)
  const open = runtime === null ? null : openLinkOf(runtime)
  function handleOf(lane: LaneName): LaneHandle<LaneChannel> {
    let handle = handles.get(lane)
    if (handle === undefined) {
      if (runtime === null || open === null)
        throw new Error("lanes of their own are off for this host")
      handle = laneHandle(runtime, laneContainer(lane), open)
      handles.set(lane, handle)
    }
    return handle
  }
  return {
    handleOf,
    laneJjOf: lane => laneJj(handleOf(lane).runners.lane),
    recordOf,
    isOwn: lane => runtime !== null && recordOf(lane)?.work?.kind === "own",
    async forget(lane) {
      const handle = handles.get(lane)
      handles.delete(lane)
      await handle?.stop().catch(() => {})
    },
    async stopAll() {
      await Promise.all(
        [...handles.values()].map(h => h.stop().catch(() => {})),
      )
    },
  }
}
