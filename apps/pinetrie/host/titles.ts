// host/titles — a canvas's title from a model: unasked as its root's first lane
// starts, or when a person asks (Auto-update title). `planTitling` and
// `titleStillWanted` decide; this carries them out.
//
// Both are called inside a command's step on the documents' keeper, so they
// gather and plan there, and only the request goes outside it. The mark is a
// late write (`later.ts`), so none lands in a canvas archived meanwhile.

import {
  type CanvasId,
  ERR,
  type Position,
  type Refusal,
  type RootId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import type { PiSetup } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readCanvases,
  readLaneRecords,
  readMarks,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  planMark,
  planTitling,
  replyTitle,
  type TitleTrigger,
  titleRequest,
  titleStillWanted,
} from "@pinetrie/rules"
import { askModel, oneAnswer } from "./ask-model.ts"
import { type Basics, failed } from "./basics.ts"
import { canvasesNow } from "./canvases.ts"
import type { Later } from "./later.ts"
import type { StepDocs } from "./roots.ts"

/**
 * A title request's size, the skill aside: the first message and at least
 * ten of the newest, each cut to `TITLE_LINE`: about 6k tokens.
 */
const TITLE_BUDGET = 24_000

export interface Titles {
  /**
   * A lane was just created in `root` at `at`, for `prompt`, which the run
   * writes: its canvas's title, when it is the root's first lane, the canvas
   * has none, and titles are on. In the step whose documents are `roots`.
   */
  laneStarted(
    roots: StepDocs,
    input: {
      readonly root: RootId
      readonly lane: ThreadId
      readonly at: Position
      readonly prompt: { readonly author: string; readonly text: string }
    },
  ): Promise<void>
  /** Auto-update title: `retitling`, or refused for a canvas with no message. */
  asked(roots: StepDocs, canvas: CanvasId, by: WriterId): Promise<Outcome>
}

export function createTitles(deps: {
  readonly basics: Pick<Basics, "session" | "places" | "log" | "now">
  readonly later: Pick<Later, "outside">
  /** The settled `titles.enabled`: whether a canvas is titled unasked. */
  readonly enabled: boolean
  /** The title model, and its skill. */
  readonly piSetup: Pick<PiSetup, "complete" | "skill">
}): Titles {
  const { basics, later } = deps
  const { session, places, log } = basics
  // Canvases an unasked title is being asked for.
  const asking = new Set<CanvasId>()

  /**
   * Gather and plan in the caller's step, from `root`, the canvas's first;
   * ask outside it, then write in a step of its own. Returns the refusal,
   * or null once asked or skipped.
   */
  async function consider(
    roots: StepDocs,
    canvas: CanvasId,
    root: RootId,
    trigger: TitleTrigger,
  ): Promise<Refusal | null> {
    const doc = await roots.root(root)
    const plan = planTitling({
      index: readTreeIndex(doc),
      root,
      marked: readMarks(session).has(canvas),
      lanes: readLaneRecords(session).values(),
      trigger,
      enabled: deps.enabled,
      inFlight: asking.has(canvas),
    })
    if (plan.kind === "refused") return plan
    if (plan.kind === "skip") return null
    const { by } = plan
    void later.outside({
      scope: { kind: "canvas", canvas },
      what: "a title",
      ...(trigger.kind === "lane"
        ? { held: { set: asking, key: canvas } }
        : {}),
      failed: failed(basics, "titling a thread"),
      request: async () =>
        (
          await askModel(
            { piSetup: deps.piSetup, log },
            {
              skill: "pinetrie:skill:tab-title",
              request: skill =>
                titleRequest({
                  skill,
                  lines: plan.lines,
                  budget: TITLE_BUDGET,
                }),
              parse: oneAnswer(replyTitle, "title"),
              purpose: "title",
            },
          )
        ).value,
      plan: title => {
        const marks = readMarks(session)
        if (!titleStillWanted(marks.get(canvas), by)) return null
        const planned = planMark({
          of: { kind: "canvas", canvas },
          title,
          by,
          now: basics.now(),
          canvases: readCanvases(places),
          marks,
          titled: new Set(),
          cardTitles: new Map(),
        })
        return planned.kind === "writes" ? { records: planned.writes } : null
      },
    })
    return null
  }

  return {
    laneStarted: async (roots, { root, ...started }) => {
      const canvas = canvasesNow(basics).canvasOfThread.get(started.lane)
      if (canvas !== undefined)
        await consider(roots, canvas, root, { kind: "lane", ...started })
    },
    asked: async (roots, canvas, by) => {
      const root = canvasesNow(basics).rootsOf.get(canvas)?.[0]
      if (root === undefined)
        return {
          kind: "refused",
          code: ERR.UNKNOWN_TARGET,
          message: "there is no message to title yet",
        }
      return (
        (await consider(roots, canvas, root, { kind: "asked", by })) ?? {
          kind: "retitling",
        }
      )
    },
  }
}
