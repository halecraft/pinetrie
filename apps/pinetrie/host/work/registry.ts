// host/work/registry — each lane's handle while the host may run it: its
// queue, and its channel once open. Only this module touches the handles.

import type { LaneName, LaneRecord } from "@pinetrie/core"
import {
  helperCommand,
  type LaneHandle,
  laneContainer,
  laneHandle,
  laneJj,
  type OpenLink,
  type Runner,
} from "@pinetrie/lanes"
import { type LaneChannel, laneRunner, openChannel } from "@pinetrie/pi"
import { readLaneRecords } from "@pinetrie/reads"
import type { SessionDocHandle } from "@pinetrie/schema"

/** A lane's channel: pi's helper in its container, over `container exec -i`. */
export const openLink: OpenLink<LaneChannel> = async container => {
  const channel = openChannel(helperCommand(container))
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
  /** The project root when lanes have their own copies, else null. */
  readonly root: string | null
}): LaneRegistry {
  const handles = new Map<LaneName, LaneHandle<LaneChannel>>()
  const recordOf = (lane: LaneName) => readLaneRecords(input.session).get(lane)
  function handleOf(lane: LaneName): LaneHandle<LaneChannel> {
    let handle = handles.get(lane)
    if (handle === undefined) {
      handle = laneHandle(laneContainer(lane), openLink)
      handles.set(lane, handle)
    }
    return handle
  }
  return {
    handleOf,
    laneJjOf: lane => laneJj(handleOf(lane).runners.lane),
    recordOf,
    isOwn: lane => input.root !== null && recordOf(lane)?.work?.kind === "own",
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
