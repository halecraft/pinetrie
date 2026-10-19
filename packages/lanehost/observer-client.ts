// lanehost/observer-client — a host's side of the machine role: one held
// channel and one subscription, each lane's runs folded as their notices
// arrive, for its `RunSource`. How the channel is opened is the runtime's
// (`open`): this knows nothing of Docker.
//
// Its rules:
// - A lane is registered by its first process, which the runtime reads when
//   asked (`pid`), so a channel opened again (a new lease, a role that
//   exited) registers every lane again from its process as it is then.
// - A channel closed is waited out before the next opens: the role then
//   holds its lanes unowned, and the new channel reclaims them.
// - A lane holds its traces and one batch of notices, never more: the
//   batch is folded once full (`gathered.ts`), so a long call's events do
//   not grow the host.
// - A drain begins with the role's flush: once it answers, every notice of
//   the lane's runs before it has arrived, and is folded into what the
//   drain is given.
// - A relay is a channel of its own for the host inside a lane, so the role
//   owns that host's lanes by that channel. Each of its registrations is
//   made forwarded, within the lane, whatever it said (`relayedCall`).

import path from "node:path"
import { type Channel, openChannel } from "@pinetrie/channel"
import {
  errorText,
  type FoldNotices,
  type LaneObservation,
  type RunNotice,
  type RunTraces,
} from "@pinetrie/core"
import {
  drainEnded,
  drainStarted,
  foldedWith,
  type Gathered,
  isBatchFull,
  newGathered,
} from "./gathered.ts"
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
 * inside a lane opens its helper's this way. `connect` is the command that
 * runs `observer-connect.ts` on this machine's Node, which the caller makes:
 * this package does not know where pine·trie's install is.
 */
export const connectObserver = (
  connect: readonly string[],
  socket: string,
): ObserverChannel =>
  openChannel([...connect, socket], `the observer at ${socket}`)

export interface ObserverClient {
  /**
   * Register the lane whose first process `pid` names, and observe it. Throws,
   * saying why, where nothing can observe lanes here.
   */
  observe(lane: {
    readonly pid: () => Promise<number>
    /** Its directories whose stamps only a fresh lstat reads (virtiofs). */
    readonly remote: readonly string[]
    /** How its notices become its runs' traces, batch by batch. */
    readonly fold: FoldNotices
  }): Promise<LaneObservation>
  /** Close the channel: the next call opens it again, and registers every lane again. */
  reset(): void
}

interface Held {
  readonly pid: () => Promise<number>
  readonly remote: readonly string[]
  readonly fold: FoldNotices
  /** Its PID namespace on the channel now; null until registered on it. */
  namespace: LaneNamespace | null
  gathered: Gathered
  /**
   * Notices not folded yet. Replaced after each fold, never emptied in
   * place: the array handed to the fold is the fold's.
   */
  batch: RunNotice[]
  /** The last drain, settled or not: the next starts after it. */
  draining: Promise<unknown>
}

/** `notice` taken into the lane's batch, and the batch folded once full. */
function take(lane: Held, notice: RunNotice): void {
  lane.batch.push(notice)
  if (!isBatchFull(lane.gathered, lane.batch.length)) return
  lane.gathered = foldedWith(lane.gathered, lane.batch, lane.fold)
  lane.batch = []
}

export function observerClient(input: {
  readonly open: () => Promise<ObserverChannel>
}): ObserverClient {
  const lanes = new Set<Held>()
  /** Each registered lane by its namespace on the channel now. */
  const byNamespace = new Map<LaneNamespace, Held>()
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
    byNamespace.set(namespace, lane)
    // After what the lane holds: the role held these since its last channel.
    for (const n of unclaimed.get(namespace) ?? []) take(lane, n)
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
        const lane = byNamespace.get(n.lane)
        if (lane !== undefined) take(lane, notice)
        else {
          const waiting = unclaimed.get(n.lane)
          if (waiting === undefined) unclaimed.set(n.lane, [notice])
          else waiting.push(notice)
        }
      }).catch(() => {})
      for (const lane of lanes) lane.namespace = null
      byNamespace.clear()
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
      const held: Held = {
        ...lane,
        namespace: null,
        gathered: newGathered(),
        batch: [],
        draining: Promise.resolve(),
      }
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
        drain(drain) {
          const drained = held.draining.then(async () => {
            const now = await opened()
            // A channel opened again since: the lane is registered on it first.
            if (held.namespace === null) await register(now, held)
            await now.call({ kind: "flush" })
            held.gathered = drainStarted(held.gathered, held.batch, held.fold)
            held.batch = []
            let next: RunTraces | null = null
            try {
              const done = await drain(held.gathered.traces)
              next = done.traces
              return done.result
            } finally {
              // Read after the await: notices kept arriving while it ran.
              held.gathered = drainEnded(
                held.gathered,
                next,
                held.batch,
                held.fold,
              )
              held.batch = []
            }
          })
          held.draining = drained.catch(() => {})
          return drained
        },
        async close() {
          lanes.delete(held)
          const namespace = held.namespace
          if (namespace !== null && byNamespace.get(namespace) === held)
            byNamespace.delete(namespace)
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
