// host/work/registry — each lane's handle while the host may run it: its
// queue, and its channel once open; and each lane's history, reached only on
// its queue (`withHistory`). Only this module touches the handles.

import type { LaneRecord, ThreadId } from "@pinetrie/core"
import {
  helperCommand,
  type LaneHandle,
  type LaneHistory,
  type LaneRunners,
  type LaneRuntime,
  laneContainer,
  laneHandle,
  type OpenLink,
} from "@pinetrie/lanes"
import {
  type LaneChannel,
  laneRunner,
  openChannel,
  relayObserver,
} from "@pinetrie/pi"
import { readLaneRecords } from "@pinetrie/reads"
import { laneFold } from "@pinetrie/rules"
import type { SessionDocHandle } from "@pinetrie/schema"

/**
 * A lane's channel: pi's helper in its container, over the runtime's `exec
 * -i`, and its runs observed, folded by the places the helper's hello
 * names. Every container start opens it before any tool runs, so the lane
 * is registered with the observer each time. The helper serves the
 * observer to a host inside the lane, relayed by this one, while the
 * channel is open.
 */
export const openLinkOf =
  (runtime: LaneRuntime): OpenLink<LaneChannel> =>
  async container => {
    const channel = openChannel(helperCommand(runtime, container))
    const hello = await channel.ready
    const runs = await runtime
      .observe(
        container,
        hello.shared,
        laneFold({ root: hello.cwd, shared: hello.sharedInside }),
      )
      .catch(error => {
        channel.close()
        throw error
      })
    const stopRelay = relayObserver(channel, () => runs.relay())
    const { run, bytes } = laneRunner(channel)
    return {
      channel,
      runs,
      run,
      bytes,
      closed: channel.closed,
      async close() {
        stopRelay()
        await runs.close().catch(() => {})
        channel.close()
        await channel.closed
      },
    }
  }

export interface LaneRegistry {
  handleOf(lane: ThreadId): LaneHandle<LaneChannel>
  /**
   * `f`, queued on the lane's queue after everything before it, with the
   * lane's history and its handle: the one way to the history, so nothing
   * changes it off the queue. With `fatal`, a failure breaks the queue
   * (`LaneQueue.enqueue`). Never called from a step already on the queue,
   * which would wait on itself: such a step is handed the history.
   */
  withHistory<T>(
    lane: ThreadId,
    f: (h: LaneHistory, handle: LaneHandle<LaneChannel>) => Promise<T>,
    options?: { readonly fatal?: boolean },
  ): Promise<T>
  recordOf(lane: ThreadId): LaneRecord | undefined
  /** A lane that has its own container here. */
  isOwn(lane: ThreadId): boolean
  /** Drop a lane's handle, stopping it: an archived lane. */
  forget(lane: ThreadId): Promise<void>
  /** Stop every handle: the host's shutdown. */
  stopAll(): Promise<void>
}

export function createRegistry(input: {
  readonly session: SessionDocHandle
  /** What lanes run on. */
  readonly runtime: LaneRuntime
  /** The adapter's history of a lane, over its runners. */
  readonly history: (lane: ThreadId, runners: LaneRunners) => LaneHistory
}): LaneRegistry {
  const { runtime } = input
  const handles = new Map<ThreadId, LaneHandle<LaneChannel>>()
  const recordOf = (lane: ThreadId) => readLaneRecords(input.session).get(lane)
  const open = openLinkOf(runtime)
  function handleOf(lane: ThreadId): LaneHandle<LaneChannel> {
    let handle = handles.get(lane)
    if (handle === undefined) {
      handle = laneHandle(runtime, laneContainer(lane), open)
      handles.set(lane, handle)
    }
    return handle
  }
  return {
    handleOf,
    withHistory(lane, f, options) {
      const handle = handleOf(lane)
      return handle.queue.enqueue(
        () => f(input.history(lane, handle.runners), handle),
        options,
      )
    },
    recordOf,
    isOwn: lane => recordOf(lane)?.ownCopy === true,
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
