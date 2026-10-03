// pi/lanes — where each lane's tools work, as pi sees it (ADR-0032,
// ADR-0034), and what a lane is told: its system prompt, and for a lane of
// its own, a block about itself (ADR-0046).
//
// One harness serves every lane, but pi resolves the tools' context from the
// run's `Context` only: `toolContext` is a function of it. So every call that
// drives a lane carries the lane's name in its `Context` (`laneContext`), and
// the rest comes from the host's `access(lane)`: one source for where a lane
// works (S36 item 18). pi's hooks see the lane's name directly.

import type { ExecutionEnv } from "@earendil-works/pi-agent-core"
import {
  createContextKey,
  withContextValue,
} from "@earendil-works/pi-agent-core/harness/context"
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs"
import {
  type EntryId,
  HOST_WORKING_COPY,
  hostPathInLane,
  type LaneName,
  NO_EDITOR,
} from "@pineta/core"
import { Type } from "typebox"
import type { ModelSetup } from "./config.ts"
import { buildSystemPrompt } from "./deep.ts"
import { type LaneChannel, laneEnv } from "./lane-env.ts"

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
      readonly facts: LaneFacts
      /**
       * Host paths mounted read-only at `/mnt/host` and their path
       * (ADR-0036): the roots of the skills this lane can read.
       */
      readonly hostPaths: readonly string[]
      readonly gate: () => Promise<LaneChannel>
    }

/**
 * What a lane of its own is told about itself (ADR-0046). The host builds
 * every name in it: `offerBookmark`, `PINETA_MOUNT` and `LANE_NOTE` are in
 * `@pineta/lanes`, which this package does not declare.
 */
export interface LaneFacts {
  /** `WORKSPACE_ROOT` in a container; the helper's own directory in tests. */
  readonly dir: string
  /**
   * Directories shared read-write with the person and every other lane,
   * relative to `dir` (ADR-0035).
   */
  readonly shared: readonly string[]
  /** The offer's bookmark in the person's repo; null while the thread has no name. */
  readonly offer: string | null
  /** What `pineta.json` lets into the lane (ADR-0034). */
  readonly grants: {
    readonly ssh: boolean
    /** Names of environment variables passed in. */
    readonly env: readonly string[]
    /** Where each granted read-only mount is, in the lane. */
    readonly mounts: readonly string[]
  }
  /** The image carries Chromium's headless shell: Pineta's default image does (ADR-0041). */
  readonly browser: boolean
  /** Pineta's install, mounted read-only in the lane. */
  readonly install: string
  /** The lane note's path in the lane. */
  readonly note: string
}

/**
 * The block a lane of its own is told, one guideline per line (ADR-0046).
 * Guidelines, not a section of its own: `pi-anthropic-auth` rebuilds the
 * prompt by its section tags, keeping `<rules>` and dropping `<docs>` (S23).
 * pi drops a guideline equal to an earlier one, so no two lines may be equal.
 */
export function laneGuidelines(facts: LaneFacts): string[] {
  const { dir, offer, grants } = facts
  const allowed = [
    ...(grants.ssh ? ["your ssh agent"] : []),
    ...grants.env.map(name => `$${name}`),
    ...(grants.mounts.length === 0
      ? []
      : [`read-only files at ${grants.mounts.join(", ")}`]),
  ]
  return [
    `You work in a Pineta lane: a Linux container where you are root, in your own jj repo at ${dir}.`,
    "Pineta commits your changes after each message, so you need not commit. Don't rewrite earlier revisions. Your work so far: `jj log -r 'immutable_heads()..'`.",
    `The person gets your work as one commit${offer === null ? "" : `, \`${offer}\``}, and never sees your files live.`,
    `Only ${dir} lasts. Background processes end with each run, and nothing outside ${dir} reaches a branch.`,
    `${HOST_WORKING_COPY} is the person's working copy, read-only. ${facts.install} is Pineta's install, not your project.`,
    ...facts.shared.map(
      p =>
        `${dir}/${p} is shared live with the person and other threads, never committed.`,
    ),
    `No container runtime, model keys or credentials${allowed.length === 0 ? "" : ` except ${allowed.join(", ")}`}. The internet works; the person's localhost does not.`,
    ...(facts.browser
      ? ["Chromium's headless shell is installed ($PLAYWRIGHT_BROWSERS_PATH)."]
      : []),
    `More about the lane, when you need it: ${facts.note}`,
  ]
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

/**
 * What pi builds a request's tools and system prompt from. `lane` is null for
 * a lane that works directly: it gets no block, and every skill at its own path.
 */
export interface ToolContext {
  readonly env: ExecutionEnv
  readonly dir: string
  readonly lane: {
    readonly facts: LaneFacts
    readonly hostPaths: readonly string[]
  } | null
}

/** Where a lane's tools work, and what its prompt says about it. */
export function toolContextOf(access: LaneAccess): ToolContext {
  if (access.kind === "direct")
    return {
      env: directEnv(access.dir, access.ready),
      dir: access.dir,
      lane: null,
    }
  const { facts, hostPaths } = access
  return {
    env: laneEnv(facts.dir, access.gate),
    dir: facts.dir,
    lane: { facts, hostPaths },
  }
}

/**
 * The skills a lane of its own can read, at the paths it reads them: those
 * under a host path it has mounted, at `/mnt/host` and their path (ADR-0036).
 */
function skillsInLane<S extends { filePath: string; baseDir: string }>(
  skills: readonly S[] | undefined,
  hostPaths: readonly string[],
): S[] {
  const mounted = (p: string) =>
    hostPaths.some(r => p === r || p.startsWith(`${r}/`))
  return (skills ?? [])
    .filter(s => mounted(s.filePath))
    .map(s => ({
      ...s,
      filePath: hostPathInLane(s.filePath),
      baseDir: hostPathInLane(s.baseDir),
    }))
}

/**
 * pi's own prompt, with the repo's context files and the person's skills, so
 * an extension that shapes pi's prompt sections finds them (S23). It names
 * the lane's directory, and does not wait for its setup. A lane of its own
 * is told about itself (`laneGuidelines`), and sees its skills at the paths
 * it can read them (`skillsInLane`).
 */
export const systemPromptFor =
  (
    setup: Pick<ModelSetup, "contextFiles" | "skills">,
    selectedTools: readonly string[],
  ) =>
  (toolContext: ToolContext): string =>
    buildSystemPrompt({
      cwd: toolContext.dir,
      selectedTools: [...selectedTools],
      contextFiles: setup.contextFiles,
      skills:
        toolContext.lane === null
          ? setup.skills
          : skillsInLane(setup.skills, toolContext.lane.hostPaths),
      ...(toolContext.lane === null
        ? {}
        : { promptGuidelines: laneGuidelines(toolContext.lane.facts) }),
    })

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
