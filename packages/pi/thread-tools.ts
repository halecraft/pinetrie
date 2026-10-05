// pi/thread-tools — the tools an agent acts on its own thread with (ADR-0080):
// `catch_up`, which merges its base's or its parent's new work into its copy
// during the run, and `split_offer`, which queues its offer's split. The host
// decides and carries them out (`LaneHooks`); this only reads the call and
// hands back the host's answer, as the model reads it.

import {
  CATCH_UP_TOOL,
  type CommitId,
  type LaneName,
  SPLIT_TOOL,
} from "@pineta/core"
import type { ToolAnswer } from "@pineta/rules"
import { Type } from "typebox"
import { laneOf } from "./lanes.ts"

type Context = Parameters<typeof laneOf>[0]

/** `catch_up`'s `from` as the agent passed it: the base unless it named the parent. Pure. */
export const parseCatchUpArgs = (args: {
  readonly from?: string
}): "base" | "parent" => (args.from === "parent" ? "parent" : "base")

/** A host's answer as pi's tool result: its text, and what it says as a fact. */
const resultOf = (answer: ToolAnswer) => ({
  content: [{ type: "text" as const, text: answer.text }],
  details:
    answer.details === null
      ? undefined
      : ({ merged: [...answer.details.merged] } as {
          merged: CommitId[]
        }),
})

/** What a call outside any lane answers. */
const NO_LANE: ToolAnswer = {
  text: "This call reached no thread.",
  isError: true,
  details: null,
}

/**
 * `catch_up` (ADR-0080): the host merges in the run, refusing a call beside
 * another in its turn, or with nothing new. Every lane has it, so a lane's
 * tool list never changes between runs (S85).
 */
export function catchUpTool(
  catchUp: (lane: LaneName, from: "base" | "parent") => Promise<ToolAnswer>,
) {
  return {
    name: CATCH_UP_TOOL,
    label: "catch up",
    description:
      "Merge the new work of this thread's base (the project, or its WIP), or with from: parent of the thread this one branched from, into this thread's own copy, now. It acts only when there is new work, and must be the only tool call in its turn. A clean merge answers what came in; a conflicted one answers the conflicts, to resolve here.",
    parameters: Type.Object({
      from: Type.Optional(
        Type.Union([Type.Literal("base"), Type.Literal("parent")], {
          description: "base (the default), or parent",
        }),
      ),
    }),
    async execute(
      _id: string,
      params: { from?: string },
      _onUpdate: unknown,
      _toolContext: unknown,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = laneOf(context)
      const answer =
        lane === undefined
          ? NO_LANE
          : await catchUp(lane, parseCatchUpArgs(params))
      return resultOf(answer)
    },
  }
}

/**
 * `split_offer` (ADR-0080): the host queues a card that splits the offer when
 * the run ends, as the strip's button does.
 */
export function splitTool(askSplit: (lane: LaneName) => Promise<ToolAnswer>) {
  return {
    name: SPLIT_TOOL,
    label: "split the offer",
    description:
      "Ask for this thread's offer to be split into a stack of reviewable revisions. The split runs after this run ends, as a run of its own, and the person reviews the stack before taking it.",
    parameters: Type.Object({}),
    async execute(
      _id: string,
      _params: Record<string, never>,
      _onUpdate: unknown,
      _toolContext: unknown,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = laneOf(context)
      return resultOf(lane === undefined ? NO_LANE : await askSplit(lane))
    },
  }
}
