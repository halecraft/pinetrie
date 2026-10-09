// host/titles — a task's title from a model (ADR-0074, ADR-0116): unasked
// as its root's first lane starts, or when a person asks (Auto-update
// title).
// `planTitling` and `titleStillWanted` decide; this carries them out.
//
// Both are called inside a command's step on the documents' keeper, so they
// gather and plan there, and only the request goes outside it
// (`requestOutside`). The mark is written in a step of its own.

import {
  ERR,
  type Position,
  type Refusal,
  type RootId,
  type TaskId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import type { PiSetup } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readArchived,
  readLaneRecords,
  readMarks,
  readTasks,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  archivedIn,
  planMark,
  planTitling,
  type TitleTrigger,
  titleOf,
  titleRequest,
  titleStillWanted,
} from "@pinetrie/rules"
import { type Basics, failed } from "./basics.ts"
import { requestOutside } from "./outside.ts"
import type { Records } from "./records.ts"
import { tasksNow } from "./tasks.ts"

/** A title request's size: the skill aside, the first message and the newest. */
const TITLE_BUDGET = 6_000

export interface Titles {
  /**
   * A lane was just created in `root` at `at`, for `prompt`, which the run
   * writes: its task's title, when it is the root's first lane, the task
   * has none, and titles are on.
   */
  laneStarted(input: {
    readonly root: RootId
    readonly lane: ThreadId
    readonly at: Position
    readonly prompt: { readonly author: string; readonly text: string }
  }): Promise<void>
  /** Auto-update title: `retitling`, or refused for a task with no message. */
  asked(task: TaskId, by: WriterId): Promise<Outcome>
}

export function createTitles(deps: {
  readonly basics: Pick<Basics, "session" | "places" | "docs" | "log" | "now">
  readonly keeper: Pick<Keeper, "run" | "track">
  /** The user config's `titles.enabled`: whether a task is titled unasked. */
  readonly enabled: boolean
  readonly records: Pick<Records, "writeValues">
  /** The title model, and its skill. */
  readonly piSetup: Pick<PiSetup, "complete" | "skill">
}): Titles {
  const { basics, keeper } = deps
  const { session, log } = basics
  // Tasks an unasked title is being asked for.
  const asking = new Set<TaskId>()

  /**
   * Gather and plan in the caller's step, from `root`, the task's first;
   * ask outside it, then write in a step of its own. Returns the refusal,
   * or null once asked or skipped.
   */
  async function consider(
    task: TaskId,
    root: RootId,
    trigger: TitleTrigger,
  ): Promise<Refusal | null> {
    const doc = await basics.docs.root(root)
    const plan = planTitling({
      index: readTreeIndex(doc),
      root,
      marked: readMarks(session).has(task),
      lanes: readLaneRecords(session).values(),
      trigger,
      enabled: deps.enabled,
      inFlight: asking.has(task),
    })
    if (plan.kind === "refused") return plan
    if (plan.kind === "skip") return null
    const { by } = plan
    void requestOutside({
      keeper,
      ...(trigger.kind === "lane" ? { held: { set: asking, key: task } } : {}),
      failed: failed(basics, "titling a thread"),
      request: async () => {
        const skill = await deps.piSetup.skill("pinetrie:skill:tab-title")
        if (skill === null) {
          log("[host] no tab-title skill")
          return null
        }
        const reply = await deps.piSetup.complete({
          ...titleRequest({
            skill: skill.content,
            lines: plan.lines,
            budget: TITLE_BUDGET,
          }),
          purpose: "title",
        })
        if (reply === null) return null
        const title = titleOf(reply)
        if (title === null) {
          log(`[host] the model's title is not one: ${JSON.stringify(reply)}`)
          return null
        }
        return title
      },
      settle: async title => {
        // An archived task takes no writes (ADR-0029).
        if (archivedIn([task], readArchived(session)) !== null) return
        const marks = readMarks(session)
        if (!titleStillWanted(marks.get(task), by)) return
        const planned = planMark({
          of: { kind: "task", task },
          title,
          by,
          now: basics.now(),
          tasks: new Set(readTasks(session).keys()),
          marks,
          columns: new Set(),
          columnTitles: new Map(),
        })
        if (planned.kind === "writes")
          await deps.records.writeValues(planned.writes)
      },
    })
    return null
  }

  return {
    laneStarted: async ({ root, ...started }) => {
      const task = tasksNow(basics).taskOfThread.get(started.lane)
      if (task !== undefined)
        await consider(task, root, { kind: "lane", ...started })
    },
    asked: async (task, by) => {
      const root = tasksNow(basics).rootsOf.get(task)?.[0]
      if (root === undefined)
        return {
          kind: "refused",
          code: ERR.UNKNOWN_TARGET,
          message: "there is no message to title yet",
        }
      return (
        (await consider(task, root, { kind: "asked", by })) ?? {
          kind: "retitling",
        }
      )
    },
  }
}
