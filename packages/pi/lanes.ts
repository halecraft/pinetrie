// pi/lanes — where each lane's tools work, as pi sees it, and what a lane is
// told: its system prompt, and for a lane of its own, a block about itself.
//
// One harness serves every lane, but pi resolves the tools' context from the
// run's `Context` only. So every call that drives a lane carries its thread in
// its `Context` (`threadContext`), and the rest comes from the host's
// `access(lane)`. pi's hooks see the lane's name directly.

import type { ExecutionEnv } from "@earendil-works/pi-agent-core"
import {
  CONFLICT_TOOL,
  type EntryId,
  FIND_TOOL,
  GREP_TOOL,
  HOST_WORKING_COPY,
  isWithin,
  laneSkillPath,
  PRODUCT_NAME,
  type RuntimeProgram,
  type ThreadId,
} from "@pinetrie/core"
import { AGENTS_RULE, CONTEXT_RULES, type ToolAnswer } from "@pinetrie/rules"
import { Type } from "typebox"
import type { ModelSetup } from "./config.ts"
import { buildSystemPrompt } from "./deep.ts"
import { type LaneChannel, laneEnv, refusingEnv } from "./lane-env.ts"
import { threadOfContext } from "./thread-context.ts"

type Context = Parameters<typeof threadOfContext>[0]

/**
 * How a lane's tools reach its files, as the host resolves it: in the lane's
 * container, through its helper. `gate` settles with the channel once the
 * lane is started and its queue has drained: tools wait for it, the model
 * does not.
 */
export interface LaneAccess {
  readonly facts: LaneFacts
  /**
   * Host paths mounted read-only at `/mnt/host` and their path: the roots of
   * the skills this lane can read.
   */
  readonly hostPaths: readonly string[]
  /** Where the lane runtime's programs are in the lane (`RUNTIME_BIN`). */
  readonly programs: string
  readonly gate: () => Promise<LaneChannel>
}

/**
 * What a lane of its own is told about itself. The host builds every name in
 * it: `PINETRIE_MOUNT` and `LANE_NOTE` are in `@pinetrie/lanes`, which this
 * package does not declare. Nothing here changes while the lane lives: a
 * change would alter every request's prefix, and Anthropic then drops the
 * lane's earlier thinking.
 */
export interface LaneFacts {
  /** `WORKSPACE_ROOT` in a container; the helper's own directory in tests. */
  readonly dir: string
  /** Shared read-write with the person and every other lane, relative to `dir`. */
  readonly shared: readonly string[]
  /** What `pinetrie.json` lets into the lane. */
  readonly grants: {
    /**
     * The ssh identities the lane holds through its host: its owner's own,
     * which each lane uses only once its owner approves, and service ones,
     * by name.
     */
    readonly ssh: {
      readonly personal: boolean
      readonly services: readonly string[]
    }
    /** Names of environment variables passed in. */
    readonly env: readonly string[]
    /** Where each granted read-only mount is, in the lane. */
    readonly mounts: readonly string[]
  }
  /**
   * The lane runs pinetrie's default image, which carries Chromium's headless
   * shell and python3. A project's own image may carry neither.
   */
  readonly defaultImage: boolean
  /** pinetrie's install, mounted read-only in the lane. */
  readonly install: string
  /** The lane note's path in the lane. */
  readonly note: string
}

/**
 * What each program the runtime carries for `bash` is preferred over. Keyed
 * by `RuntimeProgram`, so a program added to the runtime fails to type-check
 * until it says what it replaces. jj replaces nothing the agent would run.
 */
const PREFERRED_OVER: Readonly<Record<Exclude<RuntimeProgram, "jj">, string>> =
  { rg: "grep", fd: "find", sd: "sed" }

/** `a`, `a and b`, `a, b and c`. */
const listed = (words: readonly string[]): string =>
  words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`

/**
 * The block a lane of its own is told, one guideline per line. Guidelines,
 * not a section of its own: `pi-anthropic-auth` rebuilds the prompt by its
 * section tags, keeping `<rules>` and dropping `<docs>`. pi drops a guideline
 * equal to an earlier one, so no two lines may be equal.
 */
export function laneGuidelines(facts: LaneFacts): string[] {
  const { dir, grants } = facts
  const allowed = [
    ...(grants.ssh.personal
      ? ["your owner's ssh identity (once they approve this lane)"]
      : []),
    ...(grants.ssh.services.length === 0
      ? []
      : [
          `the ssh ${grants.ssh.services.length === 1 ? "identity" : "identities"} ${listed(grants.ssh.services)}`,
        ]),
    ...grants.env.map(name => `$${name}`),
    ...(grants.mounts.length === 0
      ? []
      : [`read-only files at ${grants.mounts.join(", ")}`]),
  ]
  return [
    `You work in a ${PRODUCT_NAME} lane: a Linux container where you are root, in your own jj repo at ${dir}.`,
    `${PRODUCT_NAME} commits your changes after each message, so you need not commit. Don't rewrite earlier revisions. Your work so far: \`jj log -r 'immutable_heads()..'\`.`,
    "The person gets your work as one commit, and never sees your changes live.",
    `Only ${dir} lasts. Background processes end with each run, and nothing outside ${dir} reaches a branch.`,
    `${HOST_WORKING_COPY} is the person's working copy, read-only. ${facts.install} is ${PRODUCT_NAME}'s install, not your project.`,
    ...facts.shared.map(
      p =>
        `${dir}/${p} is shared live with the person and other threads, never committed.`,
    ),
    `No container runtime, model keys or credentials${allowed.length === 0 ? "" : ` except ${allowed.join(", ")}`}. The internet works; the person's localhost does not.`,
    `Search with the ${GREP_TOOL} and ${FIND_TOOL} tools. In bash, ${listed(Object.keys(PREFERRED_OVER))} are on PATH: prefer them to ${listed(Object.values(PREFERRED_OVER))}.`,
    ...(facts.defaultImage
      ? [
          "Chromium's headless shell is installed ($PLAYWRIGHT_BROWSERS_PATH), and so is python3.",
        ]
      : []),
    `Nothing installs dependencies for you. After a catch up, ${PRODUCT_NAME} removes what commands made from files that changed (node_modules, a build): make them again as you would after a pull.`,
    "Keep what commands make out of the repo: when one makes a directory .gitignore misses (dist/, node_modules/), add it to .gitignore.",
    `More about the lane, when you need it: ${facts.note}`,
  ]
}

export interface LaneHooks {
  /**
   * Awaited before each model request and after a run: record what the last
   * turn left. `tip` is the lane's tip then: on a run's first request, its
   * prompt.
   */
  turnDone(lane: ThreadId, tip: EntryId): Promise<void>
  /**
   * `ask_about_conflict` was called. True when the lane's copy has a
   * conflict to ask about, which then needs the person; false when it has
   * none, and nothing is asked.
   */
  askedAboutConflict(lane: ThreadId, question: string): Promise<boolean>
  /**
   * The write or edit tool wrote the lane's `pinetrie.json`: what to tell
   * the agent of it, or null for nothing.
   */
  configWritten(lane: ThreadId): Promise<string | null>
  /** `catch_up` was called: the host's answer. */
  catchUp(lane: ThreadId, from: "base" | "parent"): Promise<ToolAnswer>
  /** `split_offer` was called: the host's answer. */
  askSplit(lane: ThreadId): Promise<ToolAnswer>
  /** `ask` was called: the host relays it, and answers at once. */
  ask(lane: ThreadId, to: string, text: string): Promise<ToolAnswer>
  /** `leave` was called: the host's answer. */
  leave(lane: ThreadId, thread: string): Promise<ToolAnswer>
}

/**
 * What pi builds a request's tools and system prompt from. `lane` is null for
 * an agent without tools, or a lane with no copy of its own: its prompt names
 * the project's root, it gets no lane block, every skill is at its own path,
 * and its `env` refuses every call.
 */
export interface ToolContext {
  readonly env: ExecutionEnv
  /** Where a search tool finds the program it runs, in `env`'s file system. */
  readonly programs: ProgramPath
  readonly dir: string
  readonly lane: {
    readonly facts: LaneFacts
    readonly hostPaths: readonly string[]
  } | null
}

const NO_TOOLS =
  "this thread's agent has no tools here: it works in no lane of its own"

export type SearchProgram = Extract<RuntimeProgram, "rg" | "fd">

/** Where `program` is in the file system the tools run in: the lane runtime's. */
export type ProgramPath = (program: SearchProgram) => Promise<string>

/**
 * Where a lane's tools work, and what its prompt says about it. No access:
 * an agent without tools, or a lane with no copy of its own, whose prompt
 * names `project` and whose every call is refused.
 */
export function toolContextOf(
  access: LaneAccess | null,
  project: string,
): ToolContext {
  if (access === null)
    return {
      env: refusingEnv(project, NO_TOOLS),
      programs: async program => program,
      dir: project,
      lane: null,
    }
  const { facts, hostPaths, programs } = access
  return {
    env: laneEnv(facts.dir, access.gate),
    programs: async program => `${programs}/${program}`,
    dir: facts.dir,
    lane: { facts, hostPaths },
  }
}

/**
 * The skills a lane of its own can read, at the paths it reads them
 * (`laneSkillPath`): those inside the project, in its own copy, and those
 * under a host path it has mounted, at `/mnt/host` and their path.
 */
export function skillsInLane<S extends { filePath: string; baseDir: string }>(
  skills: readonly S[] | undefined,
  hostPaths: readonly string[],
  project: string | null,
): S[] {
  const readable = (p: string) =>
    (project !== null && isWithin(p, project)) ||
    hostPaths.some(r => isWithin(p, r))
  return (skills ?? [])
    .filter(s => readable(s.filePath))
    .map(s => ({
      ...s,
      filePath: laneSkillPath(s.filePath, project),
      baseDir: laneSkillPath(s.baseDir, project),
    }))
}

/**
 * pi's own prompt, with the repo's context files and the person's skills, so
 * an extension that shapes pi's prompt sections finds them. It names the
 * lane's directory, and does not wait for its setup.
 */
export const systemPromptFor =
  (
    setup: Pick<ModelSetup, "contextFiles" | "skills">,
    selectedTools: readonly string[],
    /** The project's root: its own skills are read in a lane's copy. */
    project: string | null = null,
  ) =>
  (toolContext: ToolContext): string =>
    buildSystemPrompt({
      cwd: toolContext.dir,
      selectedTools: [...selectedTools],
      contextFiles: setup.contextFiles,
      skills:
        toolContext.lane === null
          ? setup.skills
          : skillsInLane(setup.skills, toolContext.lane.hostPaths, project),
      promptGuidelines:
        toolContext.lane === null
          ? [...CONTEXT_RULES, AGENTS_RULE]
          : [
              ...CONTEXT_RULES,
              AGENTS_RULE,
              ...laneGuidelines(toolContext.lane.facts),
            ],
    })

export const NO_CONFLICTS =
  "There is no conflict in this thread's copy to ask about."

/**
 * The tool an agent leaves a conflict with: when its two sides meant
 * different things, the agent leaves it as it is and asks, and the thread
 * needs the person whatever the files say. Its result's `details` say it
 * asked, which is how the page reads it. Every lane has it, so a lane's tool
 * list never changes between runs: a change drops the lane's earlier
 * thinking.
 */
export function conflictTool(
  onAsk: (lane: ThreadId, question: string) => Promise<boolean>,
) {
  return {
    name: CONFLICT_TOOL,
    label: "ask about a conflict",
    description:
      "When the two sides of a conflict meant different things, or you cannot tell, leave that conflict as it is and ask the person. Name both intents. After calling it, end your turn: the person will answer in this thread.",
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
      const lane = threadOfContext(context)
      const asked = lane !== undefined && (await onAsk(lane, params.question))
      return {
        content: [
          {
            type: "text" as const,
            text: asked
              ? "Asked. Stop here: the person will answer in this thread."
              : NO_CONFLICTS,
          },
        ],
        details: asked ? { asked: true } : undefined,
      }
    },
  }
}
