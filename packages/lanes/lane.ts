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

import type { ProjectKind, RunSource } from "@pinetrie/core"
import {
  type Install,
  inMount,
  PINETRIE_MOUNT,
  scriptCommand,
} from "@pinetrie/install"
import type { Runners } from "./execute.ts"
import type { BytesRunner, Runner } from "./run.ts"
import { RUNTIME_NODE } from "./runtime.ts"
import type { ContainerFacts, LaneRuntime } from "./runtime-port.ts"
import { type LaneOwner, laneContainer } from "./spec.ts"

/** The note a lane's agent is pointed at, inside the lane: its history's kind's own. */
export const laneNote = (kind: ProjectKind): string =>
  kind === "jj"
    ? `${PINETRIE_MOUNT}/packages/pi/lane.md`
    : `${PINETRIE_MOUNT}/packages/pi/lane-folder.md`

/** The note on its inner Docker that a nested lane is pointed at, inside the lane. */
export const nestedLaneDockerNote = `${PINETRIE_MOUNT}/packages/pi/lane-docker.md`

/** The command that opens a lane's channel: `install`'s helper, mounted, on the runtime's Node. */
export const helperCommand = (
  runtime: Pick<LaneRuntime, "execArgv">,
  container: string,
  install: Install,
): readonly string[] =>
  runtime.execArgv(
    container,
    scriptCommand(inMount(install), "laneHelper", RUNTIME_NODE),
  )

/** An open channel into a lane, as runners; `channel` is the host's own. */
export interface LaneLink<C> {
  readonly channel: C
  /** Its runs, folded as the machine's observer reports them: registered as the link opened. */
  readonly runs: RunSource
  readonly run: Runner
  readonly bytes: BytesRunner
  /** Close the channel and wait for the helper to exit. */
  close(): Promise<void>
  /** Settles when the helper has exited, closed or not. */
  readonly closed: Promise<void>
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
  // A link that failed to open, or whose helper has since exited, is
  // dropped: the next call opens another rather than failing for good.
  const opened = () => {
    if (link !== null) return link
    const opening = open(container)
    link = opening
    const drop = () => {
      if (link === opening) link = null
    }
    opening.then(l => l.closed.then(drop), drop)
    return opening
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
