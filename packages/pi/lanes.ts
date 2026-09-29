// pi/lanes — where each lane's tools work, as pi sees it (ADR-0032,
// ADR-0034).
//
// One harness serves every lane, but pi resolves the tools' context from the
// run's `Context` only: `toolContext` is a function of it. So every call that
// drives a lane carries the lane's name in its `Context` (`laneContext`), and
// the rest comes from the host's `access(lane)`: one source for where a lane
// works (S36 item 18). pi's hooks see the lane's name directly.

import {
  createContextKey,
  withContextValue,
} from "@earendil-works/pi-agent-core/harness/context"
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs"
import { type EntryId, type LaneName, NO_EDITOR } from "@pineta/core"
import { Type } from "typebox"
import type { LaneChannel } from "./lane-env.ts"

/** How a lane's tools reach its files, as the host resolves it. */
export type LaneAccess =
  /** Directly in a directory on the host, once `ready` settles. */
  | {
      readonly kind: "direct"
      readonly dir: string
      readonly ready: Promise<void>
    }
  /**
   * In the lane's container, through its helper. `gate` settles with the
   * channel once the lane is started and its queue has drained: tools wait
   * for it, the model does not.
   */
  | {
      readonly kind: "lane"
      /** `WORKSPACE_ROOT` in a container; the helper's own directory in tests. */
      readonly dir: string
      /**
       * Directories shared read-write with the person and every other lane,
       * relative to `dir` (ADR-0035).
       */
      readonly shared: readonly string[]
      readonly gate: () => Promise<LaneChannel>
    }

export interface LaneHooks {
  /**
   * Awaited before each model request and after a run: record what the last
   * turn left. `tip` is the lane's tip then: on a run's first request, its
   * prompt.
   */
  turnDone(lane: LaneName, tip: EntryId): Promise<void>
  /** `ask_for_guidance` was called: the landing needs the person. */
  askedForGuidance(lane: LaneName, question: string): void
}

type Context = Parameters<typeof withContextValue>[2]

const LANE = createContextKey<LaneName>("pineta.lane")

/** `base` with the lane named: pass it to every call that drives the lane. */
export const laneContext = (lane: LaneName, base: Context): Context =>
  withContextValue(LANE, lane, base)

/** The lane a `Context` was given, if any. */
export const laneOf = (context: Context): LaneName | undefined =>
  context.value(LANE)

/**
 * pi's Node environment in a directory on the host, every method of which
 * first waits for `ready`. A failed setup fails the call with its error.
 */
export function directEnv(dir: string, ready: Promise<void>): NodeExecutionEnv {
  const inner = new NodeExecutionEnv({ cwd: dir, shellEnv: { ...NO_EDITOR } })
  return new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== "function") return value
      return async (...args: unknown[]) => {
        await ready
        return value.apply(target, args)
      }
    },
  })
}

export const GUIDANCE_TOOL = "ask_for_guidance"

/**
 * The tool a landing run can stop with (ADR-0033). The host turns it on only
 * while the lane's run is a landing; calling it makes the landing "needs you",
 * whatever the files say.
 */
export function guidanceTool(
  onAsk: (lane: LaneName, question: string) => void,
) {
  return {
    name: GUIDANCE_TOOL,
    label: "ask for guidance",
    description:
      "Stop and ask the person when the two sides of a merge meant different things, or when you cannot tell. Name both intents. After calling it, end your turn: the person will answer in this thread.",
    parameters: Type.Object({
      question: Type.String({
        description: "What the person must decide, naming both intents",
      }),
    }),
    async execute(
      _id: string,
      params: { question: string },
      _onUpdate: unknown,
      _toolContext: unknown,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = laneOf(context)
      if (lane !== undefined) onAsk(lane, params.question)
      return {
        content: [
          {
            type: "text" as const,
            text: "Asked. Stop here: the person will answer in this thread.",
          },
        ],
        details: undefined,
      }
    },
  }
}
