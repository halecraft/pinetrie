// lanehost/observer-client — a host's side of the machine role: one held
// channel and one subscription, each lane's notices gathered for its
// `RunSource` until a flush takes them. How the channel is opened is the
// runtime's (`open`): this knows nothing of Docker.
//
// Its rules:
// - A lane is registered by its first process, which the runtime reads when
//   asked (`pid`), so a channel opened again (a new lease, a role that
//   exited) registers every lane again from its process as it is then.
// - A channel closed is waited out before the next opens: the role then
//   holds its lanes unowned, and the new channel reclaims them.
// - A flush is the role's: once it answers, every notice of the lane's runs
//   before it has arrived, and the lane's gathered notices are its result.
// - A relay is a channel of its own for the host inside a lane, so the role
//   owns that host's lanes by that channel. Each of its registrations is
//   made forwarded, within the lane, whatever it said (`relayedCall`).

import path from "node:path"
import { type Channel, openChannel } from "@pinetrie/channel"
import {
  errorText,
  flushed,
  type LaneObservation,
  type RunNotice,
} from "@pinetrie/core"
import {
  type LaneNamespace,
  loaderRefusal,
  type ObserverCall,
  type ObserverHello,
  type ObserverNotice,
  relayedCall,
} from "./observer.ts"

export type ObserverChannel = Channel<
  ObserverHello,
  ObserverCall,
  ObserverNotice,
  unknown
>

/**
 * A channel to the machine role through a socket on this machine: a host
 * inside a lane opens its helper's this way, with `observer-connect.ts` on
 * its own Node.
 */
export const connectObserver = (socket: string): ObserverChannel =>
  openChannel(
    [
      process.execPath,
      path.join(import.meta.dirname, "observer-connect.ts"),
      socket,
    ],
    `the observer at ${socket}`,
  )

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
  /** The channel last reset, until it has closed. */
  let closing: Promise<void> = Promise.resolve()
  /**
   * Notices of a namespace no lane here holds yet: the role sends a lane's
   * held notices as it registers it, before its answer names the namespace.
   */
  const unclaimed = new Map<LaneNamespace, RunNotice[]>()

  const register = async (c: ObserverChannel, lane: Held) => {
    const namespace = (await c.call({
      kind: "register",
      origin: { kind: "direct", pid: await lane.pid() },
      remote: lane.remote,
    })) as LaneNamespace
    lane.namespace = namespace
    lane.notices.unshift(...(unclaimed.get(namespace) ?? []))
    unclaimed.delete(namespace)
  }

  function opened(): Promise<ObserverChannel> {
    if (channel !== null) return channel
    const opening = closing.then(input.open).then(async c => {
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
        const notice = { run: n.run, event: n.event }
        const lane = [...lanes].find(l => l.namespace === n.lane)
        if (lane !== undefined) lane.notices.push(notice)
        else unclaimed.set(n.lane, [...(unclaimed.get(n.lane) ?? []), notice])
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
          if (namespace !== null) unclaimed.delete(namespace)
          if (namespace === null || channel === null) return
          await (await channel).call({ kind: "unregister", lane: namespace })
        },
        async relay() {
          // A role that cannot be reached is a refusal the host inside reads
          // as its own: its hello says why, and it calls nothing.
          const failed = (error: unknown) => ({
            hello: {
              version: "",
              loader: { kind: "failed", why: errorText(error) },
            } satisfies ObserverHello,
            call: () => Promise.reject(new Error(errorText(error))),
            close: () => {},
          })
          let c: ObserverChannel
          let hello: ObserverHello
          try {
            c = await input.open()
            hello = await c.ready
          } catch (error) {
            return failed(error)
          }
          return {
            hello,
            call: async (body, signal, onUpdate) =>
              c.call(relayedCall(body, held.namespace), signal, onUpdate),
            close: () => c.close(),
          }
        },
      }
    },
    reset() {
      const c = channel
      channel = null
      closing = (c ?? Promise.reject())
        .then(open => {
          open.close()
          return open.closed
        })
        .catch(() => {})
    },
  }
}
