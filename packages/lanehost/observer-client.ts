// lanehost/observer-client — a host's side of the machine role: one held
// channel and one subscription, each lane's notices gathered for its
// `RunSource` until a flush takes them. How the channel is opened is the
// runtime's (`open`): this knows nothing of Docker.
//
// Its rules:
// - A lane is registered by its first process, which the runtime reads when
//   asked (`pid`), so a channel opened again (a new lease, a role that
//   exited) registers every lane again from its process as it is then.
// - A flush is the role's: once it answers, every notice of the lane's runs
//   before it has arrived, and the lane's gathered notices are its result.

import type { Channel } from "@pinetrie/channel"
import { flushed, type LaneObservation, type RunNotice } from "@pinetrie/core"
import {
  type LaneNamespace,
  loaderRefusal,
  type ObserverCall,
  type ObserverHello,
  type ObserverNotice,
} from "./observer.ts"

export type ObserverChannel = Channel<
  ObserverHello,
  ObserverCall,
  ObserverNotice,
  unknown
>

export interface ObserverClient {
  /**
   * Register the lane whose first process `pid` names, and observe it. Throws,
   * saying why, where nothing can observe lanes here.
   */
  observe(lane: {
    readonly pid: () => Promise<number>
    /** Its directories whose stamps only a fresh lstat reads (virtiofs). */
    readonly remote: readonly string[]
  }): Promise<LaneObservation>
  /** Close the channel: the next call opens it again, and registers every lane again. */
  reset(): void
}

interface Held {
  readonly pid: () => Promise<number>
  readonly remote: readonly string[]
  /** Its PID namespace on the channel now; null until registered on it. */
  namespace: LaneNamespace | null
  readonly notices: RunNotice[]
}

export function observerClient(input: {
  readonly open: () => Promise<ObserverChannel>
}): ObserverClient {
  const lanes = new Set<Held>()
  let channel: Promise<ObserverChannel> | null = null

  const register = async (c: ObserverChannel, lane: Held) => {
    lane.namespace = (await c.call({
      kind: "register",
      pid: await lane.pid(),
      remote: lane.remote,
    })) as LaneNamespace
  }

  function opened(): Promise<ObserverChannel> {
    if (channel !== null) return channel
    const opening = input.open().then(async c => {
      const hello = await c.ready
      const refused = loaderRefusal(hello)
      if (refused !== null) {
        c.close()
        throw new Error(refused)
      }
      void c.closed.then(() => {
        if (channel === opening) channel = null
      })
      c.call({ kind: "subscribe" }, undefined, n => {
        for (const lane of lanes)
          if (lane.namespace === n.lane)
            lane.notices.push({ run: n.run, event: n.event })
      }).catch(() => {})
      for (const lane of lanes) lane.namespace = null
      for (const lane of lanes) await register(c, lane)
      return c
    })
    channel = opening
    opening.catch(() => {
      if (channel === opening) channel = null
    })
    return opening
  }

  return {
    async observe(lane) {
      const held: Held = { ...lane, namespace: null, notices: [] }
      const c = await opened()
      // Gathering before it is registered: its first notices may come before the answer.
      lanes.add(held)
      try {
        await register(c, held)
      } catch (error) {
        lanes.delete(held)
        throw error
      }
      return {
        async flush() {
          const now = await opened()
          // A channel opened again since: the lane is registered on it first.
          if (held.namespace === null) await register(now, held)
          await now.call({ kind: "flush" })
          return flushed(held.notices.splice(0))
        },
        async close() {
          lanes.delete(held)
          const namespace = held.namespace
          if (namespace === null || channel === null) return
          await (await channel).call({ kind: "unregister", lane: namespace })
        },
      }
    },
    reset() {
      const c = channel
      channel = null
      void c?.then(open => open.close()).catch(() => {})
    },
  }
}
