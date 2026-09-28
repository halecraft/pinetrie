// pi/lanes — where each lane's tools work, as pi sees it (ADR-0032).
//
// One harness serves every lane, but pi resolves the tools' context from the
// run's `Context` only: `toolContext` is a function of it. So every call that
// drives a lane carries the lane's name in its `Context` (`laneContext`), and
// the rest comes from the host's `where(lane)`: one source for where a lane
// works (S36 item 18). pi's hooks see the lane's name directly.

import path from "node:path"
import {
  createContextKey,
  withContextValue,
} from "@earendil-works/pi-agent-core/harness/context"
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs"
import {
  type EntryId,
  foreignRoot,
  type LaneName,
  NO_EDITOR,
} from "@pineta/core"
import { Type } from "typebox"

/** Where a lane works, as the host resolves it. */
export interface LaneWhere {
  readonly dir: string
  /** Settles when setup is done: tools wait for it, the model does not. */
  readonly ready: Promise<void>
  /**
   * Other lanes' workspaces and your working copy: the model is shown their
   * paths as `dir`'s, and the file tools refuse them. Empty for a lane that
   * works directly.
   */
  readonly others: readonly string[]
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
 * pi's Node environment at the lane's directory, every method of which first
 * waits for setup. The model can start thinking while dependencies install;
 * only a tool call waits. A failed setup fails the call with its error.
 */
export function laneEnv(where: LaneWhere): NodeExecutionEnv {
  const inner = new NodeExecutionEnv({
    cwd: where.dir,
    shellEnv: { ...NO_EDITOR },
  })
  return new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== "function") return value
      return async (...args: unknown[]) => {
        await where.ready
        return value.apply(target, args)
      }
    },
  })
}

/**
 * `value` with `f` applied to every string in it, at any depth. Image data is
 * left alone: it is not text. The one traversal of pi's message shapes the
 * history rewrite needs; unit-tested on each.
 */
export function rewriteMessages<T>(value: T, f: (s: string) => string): T {
  const walk = (v: unknown, key: string | null): unknown => {
    if (typeof v === "string") return key === "data" ? v : f(v)
    if (Array.isArray(v)) return v.map(x => walk(x, null))
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x, k)]),
      )
    return v
  }
  return walk(value, null) as T
}

/** The tools whose `path` argument names a file. */
const FILE_TOOLS: ReadonlySet<string> = new Set(["read", "write", "edit"])

/**
 * Why a file tool's call is refused, or null: a path in your working copy or
 * in another lane's workspace. A branch inherits messages naming its parent's
 * paths; the history rewrite hides them, and this catches what it misses.
 */
export function refusal(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
  where: LaneWhere,
): string | null {
  if (!FILE_TOOLS.has(toolName)) return null
  const given = args.path
  if (typeof given !== "string") return null
  const abs = path.resolve(where.dir, given)
  const foreign = foreignRoot(abs, where.others, where.dir)
  if (foreign === null) return null
  const mine = path.join(where.dir, path.relative(foreign, abs))
  return `${abs} is outside this thread's workspace. This thread works in ${where.dir}: use ${mine}.`
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
