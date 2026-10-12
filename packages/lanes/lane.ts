// lanes/lane — a lane's container, the one way into it, and its queue.
//
// A container runs only while its lane runs. The disk keeps everything, so a
// container is disposable: one made from another spec is recreated on the
// same disk (`planContainer`). Every call goes through the runtime the host
// hands in (`LaneRuntime`).
//
// Everything that changes a lane's disk from outside a tool is queued, in
// order, on one queue per lane: starting the container, a fork's setup, and
// each turn's snapshot. A tool call's gate is the queue's tail, so a snapshot
// can never overlap the next turn's writes, by construction.
//
// The channel into a lane is `packages/pi`'s (`openChannel`), which this
// package cannot import: the host passes an `OpenLink` that opens
// one and wraps it as runners.

import path from "node:path"
import type { Runners } from "./execute.ts"
import { type LaneOwner, laneContainer, PINETRIE_MOUNT } from "./plan.ts"
import type { BytesRunner, Runner } from "./run.ts"
import { runtimeNode } from "./runtime.ts"
import type { ContainerFacts, LaneRuntime } from "./runtime-port.ts"

/** pinetrie's own install on the host, mounted read-only at `/pinetrie` in every lane. */
export const PINETRIE_INSTALL = path.resolve(import.meta.dirname, "../..")

/** The helper's own path, inside every lane. */
export const HELPER = `${PINETRIE_MOUNT}/packages/pi/lane-helper.ts`

/** The note a lane's agent is pointed at, inside every lane. */
export const LANE_NOTE = `${PINETRIE_MOUNT}/packages/pi/lane.md`

/** The command that opens a lane's channel: the helper on the runtime's Node. */
export const helperCommand = (
  runtime: Pick<LaneRuntime, "execArgv">,
  container: string,
): readonly string[] => runtime.execArgv(container, runtimeNode(HELPER))

/** An open channel into a lane, as runners; `channel` is the host's own. */
export interface LaneLink<C> {
  readonly channel: C
  readonly run: Runner
  readonly bytes: BytesRunner
  /** Close the channel and wait for the helper to exit. */
  close(): Promise<void>
}

/** Opens a channel into a running container. */
export type OpenLink<C> = (container: string) => Promise<LaneLink<C>>

/** A serial queue whose tail is a gate. */
export interface LaneQueue {
  /**
   * Run `task` after everything queued before it. With `fatal`, a failure
   * breaks the queue: later tasks, and the gate, fail with it until `reset`.
   */
  enqueue<T>(
    task: () => Promise<T>,
    options?: { readonly fatal?: boolean },
  ): Promise<T>
  /** Settles when everything queued so far has; rejects if the queue broke. */
  idle(): Promise<void>
  /** Mend a broken queue, for a lane that starts again. */
  reset(): void
}

export function createQueue(): LaneQueue {
  let tail: Promise<unknown> = Promise.resolve()
  let broken: Error | null = null
  return {
    enqueue(task, options = {}) {
      const next = tail.then(async () => {
        if (broken !== null) throw broken
        try {
          return await task()
        } catch (error) {
          if (options.fatal === true)
            broken = error instanceof Error ? error : new Error(String(error))
          throw error
        }
      })
      tail = next.catch(() => {})
      return next
    },
    async idle() {
      await tail
      if (broken !== null) throw broken
    },
    reset() {
      broken = null
    },
  }
}

/**
 * One lane's container, as the host holds it while the lane may run: its
 * queue, and its link once open. `runners` go through the link, opening it
 * when first used, so a step list can start the container and then run in
 * it.
 */
export interface LaneHandle<C> {
  readonly container: string
  readonly queue: LaneQueue
  readonly runners: Runners
  /** The open link, opening it if need be. The container must be running. */
  link(): Promise<LaneLink<C>>
  /**
   * Start the stopped container, or leave a running one; then open the
   * link. A caller that has just read or made the container says its state
   * (`known`), and it is not asked again.
   */
  start(known?: ContainerFacts["state"]): Promise<LaneLink<C>>
  /** Close the link and stop the container. */
  stop(): Promise<void>
}

export function laneHandle<C>(
  runtime: LaneRuntime,
  container: string,
  open: OpenLink<C>,
): LaneHandle<C> {
  let link: Promise<LaneLink<C>> | null = null
  const opened = () => {
    link ??= open(container)
    link.catch(() => {
      link = null
    })
    return link
  }
  return {
    container,
    queue: createQueue(),
    runners: {
      runtime,
      lane: async argv => (await opened()).run(argv),
      laneBytes: async argv => (await opened()).bytes(argv),
    },
    link: opened,
    async start(known) {
      const state = known ?? (await runtime.containerFacts(container)).state
      if (state !== "running") await runtime.start(container)
      return opened()
    },
    async stop() {
      const current = link
      link = null
      if (current !== null) await (await current.catch(() => null))?.close()
      await runtime.stop(container)
    },
  }
}

/** Delete a lane's container and its disk; either may be missing. */
export async function removeLane(
  runtime: LaneRuntime,
  lane: LaneOwner,
): Promise<void> {
  await runtime.remove(laneContainer(lane))
  await runtime.disk({ kind: "delete", lane })
}
