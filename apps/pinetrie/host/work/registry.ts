// host/work/registry — each lane's handle while the host may run it: its
// queue, and its channel once open; and each lane's history, reached only on
// its queue (`withHistory`). Only this module touches the handles.

import {
  type LaneRecord,
  type OwnLane,
  ownLane,
  type ThreadId,
} from "@pinetrie/core"
import type { Install } from "@pinetrie/install"
import {
  helperCommand,
  type LaneHandle,
  type LaneHistory,
  type LaneRunners,
  type LaneRuntime,
  laneContainer,
  laneHandle,
  type Observer,
  type OpenLink,
} from "@pinetrie/lanes"
import {
  type LaneChannel,
  laneRunner,
  openChannel,
  relayObserver,
} from "@pinetrie/pi"
import { readLaneForks, readLaneRecords, readThreadName } from "@pinetrie/reads"
import { foreignLaneWords, laneFold } from "@pinetrie/rules"
import type { SessionDocHandle } from "@pinetrie/schema"
import type { HistoryAnswer } from "./adapter.ts"

/**
 * A lane's channel: pi's helper in its container, over the runtime's `exec
 * -i`, and its runs observed, folded by the places the helper's hello
 * names. Every container start opens it before any tool runs, so the lane
 * is registered with the observer each time. The helper serves the
 * observer to a host inside the lane, relayed by this one, while the
 * channel is open.
 */
export const laneLinkOpener =
  (
    runtime: LaneRuntime,
    observer: Observer,
    install: Install,
  ): OpenLink<LaneChannel> =>
  async container => {
    const channel = openChannel(helperCommand(runtime, container, install))
    const hello = await channel.ready
    const runs = await observer
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
   * lane's history, its handle and its record: the one way to the history, so nothing
   * changes it off the queue. With `fatal`, a failure breaks the queue
   * (`LaneQueue.enqueue`). Never called from a step already on the queue,
   * which would wait on itself: such a step is handed the history. Refused,
   * with nothing queued, for a lane with no record, no copy of its own, no
   * fork record, or a history the adapter does not keep.
   */
  withHistory<T>(
    lane: ThreadId,
    f: (
      h: LaneHistory,
      handle: LaneHandle<LaneChannel>,
      record: OwnLane,
    ) => Promise<T>,
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
  /** The machine's observer, which every lane's link registers with. */
  readonly observer: Observer
  /** The pine·trie install lanes run their helper from. */
  readonly install: Install
  /** The adapter's history of a lane, over its runners, or why it is not the adapter's kind. */
  readonly history: (lane: OwnLane, runners: LaneRunners) => HistoryAnswer
}): LaneRegistry {
  const { runtime } = input
  const handles = new Map<ThreadId, LaneHandle<LaneChannel>>()
  const recordOf = (lane: ThreadId) => readLaneRecords(input.session).get(lane)
  const open = laneLinkOpener(runtime, input.observer, input.install)
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
      // Checked before anything is queued: a refusal must not break a
      // queue `fatal` would break.
      const record = recordOf(lane)
      const own = record === undefined ? null : ownLane(record)
      if (own === null) {
        const name = readThreadName(input.session, lane)
        return Promise.reject(
          new Error(
            record === undefined
              ? `${name} has no lane record`
              : `${name} has no copy of its own`,
          ),
        )
      }
      // Whether it has one never changes once written; whether it is owed
      // or begun is read in the step, which a fork queued before may change.
      if (!readLaneForks(input.session).has(lane))
        return Promise.reject(
          new Error(
            `${readThreadName(input.session, lane)} has no fork record`,
          ),
        )
      const handle = handleOf(lane)
      const answer = input.history(own, handle.runners)
      if (answer.kind === "foreign")
        return Promise.reject(new Error(foreignLaneWords(answer)))
      const { history } = answer
      return handle.queue.enqueue(() => f(history, handle, own), options)
    },
    recordOf,
    isOwn: lane => (recordOf(lane)?.history ?? null) !== null,
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
