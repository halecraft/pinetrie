// lanes/lane — a lane's container, the one way into it, and its queue
// (ADR-0034).
//
// A container runs only while its lane runs: a VM keeps the most memory its
// guest ever touched until it stops (S39 item 7). Stopping takes 0.3 s and
// starting 0.7 s. The disk, a volume of its own, keeps everything, so a
// container is disposable: one made from another spec is recreated on the
// same disk (`planContainer`).
//
// Everything that changes a lane's disk from outside a tool is queued, in
// order, on one queue per lane: starting the container, a fork's setup, and
// each turn's snapshot. A tool call's gate is the queue's tail, so a snapshot
// can never overlap the next turn's writes, by construction.
//
// The channel into a lane is `packages/pi`'s (`openChannel`), which this
// package cannot import (ADR-0003): the host passes an `OpenLink` that opens
// one and wraps it as runners.

import path from "node:path"
import type { Runners } from "./execute.ts"
import { PINETA_MOUNT, SPEC_LABEL } from "./plan.ts"
import {
  type BytesRunner,
  describeFailure,
  hostRunner,
  type Runner,
  run,
} from "./run.ts"
import { runtimeNode } from "./runtime.ts"

/** Pineta's own install on the host, mounted read-only at `/pineta` in every lane. */
export const PINETA_INSTALL = path.resolve(import.meta.dirname, "../..")

/** The helper's own path, inside every lane. */
export const HELPER = `${PINETA_MOUNT}/packages/pi/lane-helper.ts`

/** The note a lane's agent is pointed at, inside every lane (ADR-0046). */
export const LANE_NOTE = `${PINETA_MOUNT}/packages/pi/lane.md`

/** The command that opens a lane's channel: the helper on the runtime's Node. */
export const helperCommand = (container: string): readonly string[] => [
  "container",
  "exec",
  "-i",
  container,
  ...runtimeNode(HELPER),
]

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

/** What `container inspect` says of a container. */
export interface ContainerFacts {
  readonly state: "running" | "stopped" | "missing"
  /** Its spec label (`SPEC_LABEL`), or null when it has none. */
  readonly label: string | null
}

/** A container's state and spec label; missing when it is not there. */
export async function containerFacts(
  container: string,
): Promise<ContainerFacts> {
  const missing: ContainerFacts = { state: "missing", label: null }
  const ran = await run("container", ["inspect", container])
  if (!ran.ok) return missing
  try {
    const [found] = JSON.parse(ran.stdout) as {
      status?: { state?: string }
      configuration?: { labels?: Record<string, unknown> }
    }[]
    if (found === undefined) return missing
    const label = found.configuration?.labels?.[SPEC_LABEL]
    return {
      state: found.status?.state === "running" ? "running" : "stopped",
      label: typeof label === "string" ? label : null,
    }
  } catch {
    return missing
  }
}

/** Whether a `container` volume exists. */
export const volumeExists = async (volume: string): Promise<boolean> =>
  (await run("container", ["volume", "inspect", volume])).ok

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
  /** Start the stopped container, or leave a running one; then open the link. */
  start(): Promise<LaneLink<C>>
  /** Close the link and stop the container. */
  stop(): Promise<void>
}

export function laneHandle<C>(
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
  const host = hostRunner()
  return {
    container,
    queue: createQueue(),
    runners: {
      host,
      lane: async argv => (await opened()).run(argv),
      laneBytes: async argv => (await opened()).bytes(argv),
    },
    link: opened,
    async start() {
      if ((await containerFacts(container)).state !== "running") {
        const started = await run("container", ["start", container])
        if (!started.ok)
          throw new Error(describeFailure("container start", started))
      }
      return opened()
    },
    async stop() {
      const current = link
      link = null
      if (current !== null) await (await current.catch(() => null))?.close()
      await run("container", ["stop", container])
    },
  }
}

/** Delete a lane's container; its volume, the lane's disk, stays. */
export async function removeContainer(container: string): Promise<void> {
  await run("container", ["rm", "-f", container])
}

/** Delete a lane's container and its volume. */
export async function removeLane(container: string): Promise<void> {
  await removeContainer(container)
  await run("container", ["volume", "rm", container])
}
