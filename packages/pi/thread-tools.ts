// pi/thread-tools — the tools an agent acts on its own thread with: `catch_up`,
// which merges its base's or its parent's new work into its copy during the
// run, `resolve_conflict`, which closes a folder lane's conflicted path, and
// `split_proposed_changes`, which queues its proposed changes' split; and the
// tools it talks to other threads' agents with: `ask`, which relays an ask to a
// member without waiting, and `leave`. The host decides and carries them out
// (`LaneHooks`); this only reads the call and hands back the host's answer, as
// the model reads it.

import {
  ASK_TOOL,
  CATCH_UP_TOOL,
  LEAVE_TOOL,
  type PointId,
  RESOLVE_TOOL,
  SPLIT_TOOL,
  type ThreadId,
} from "@pinetrie/core"
import type { ToolAnswer } from "@pinetrie/rules"
import { Type } from "typebox"
import { threadOfContext } from "./thread-context.ts"

type Context = Parameters<typeof threadOfContext>[0]

/** `catch_up`'s `from` as the agent passed it: the base unless it named the parent. */
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
          merged: PointId[]
        }),
})

/** What a call outside any lane answers. */
const NO_LANE: ToolAnswer = {
  text: "This call reached no thread.",
  isError: true,
  details: null,
}

/**
 * `catch_up`: the host merges in the run, refusing a call beside another in
 * its turn, or with nothing new. Every lane has it, so a lane's tool list
 * never changes between runs.
 */
export function catchUpTool(
  catchUp: (lane: ThreadId, from: "base" | "parent") => Promise<ToolAnswer>,
) {
  return {
    name: CATCH_UP_TOOL,
    label: "catch up",
    description:
      "Merge the new work of this thread's base (accepted work, or its WIP), or with from: parent of the thread this one branched from, into this thread's own copy, now. It acts only when there is new work, and must be the only tool call in its turn. A clean merge answers what came in; a conflicted one answers the conflicts, to resolve here.",
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
      const lane = threadOfContext(context)
      const answer =
        lane === undefined
          ? NO_LANE
          : await catchUp(lane, parseCatchUpArgs(params))
      return resultOf(answer)
    },
  }
}

/** `resolve_conflict`'s `choose` as the agent passed it; null for anything else. */
export const parseResolveChoice = (
  choose: string,
): "ours" | "theirs" | "base" | null =>
  choose === "ours" || choose === "theirs" || choose === "base" ? choose : null

/**
 * `resolve_conflict`: the host writes the chosen version into a folder
 * lane, closes the path's conflict and removes its versions. Every lane has
 * it, so a lane's tool list never changes; a jj lane's answers why not.
 */
export function resolveTool(
  resolve: (
    lane: ThreadId,
    path: string,
    choose: "ours" | "theirs" | "base",
  ) => Promise<ToolAnswer>,
) {
  return {
    name: RESOLVE_TOOL,
    label: "resolve a conflict",
    description:
      "Close a conflicted path of this thread's copy, in a project without jj: ours keeps /workspace/<path> as you left it, theirs or base writes that version (from /pinetrie-states/conflicts/<path>/) over it. In a jj lane, edit the markers out of the file instead.",
    parameters: Type.Object({
      path: Type.String({
        description: "The conflicted path, from /workspace",
      }),
      choose: Type.Union(
        [Type.Literal("ours"), Type.Literal("theirs"), Type.Literal("base")],
        { description: "ours, theirs or base" },
      ),
    }),
    async execute(
      _id: string,
      params: { path: string; choose: string },
      _onUpdate: unknown,
      _toolContext: unknown,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = threadOfContext(context)
      const choose = parseResolveChoice(params.choose)
      const answer =
        lane === undefined
          ? NO_LANE
          : choose === null
            ? {
                text: "choose is ours, theirs or base.",
                isError: true,
                details: null,
              }
            : await resolve(lane, params.path, choose)
      return resultOf(answer)
    },
  }
}

/**
 * `split_proposed_changes`: the host queues a card that splits the proposed
 * changes when the run ends, as the strip's button does.
 */
export function splitTool(askSplit: (lane: ThreadId) => Promise<ToolAnswer>) {
  return {
    name: SPLIT_TOOL,
    label: "split the changes",
    description:
      "Ask for this thread's proposed changes to be split into a stack of reviewable revisions. The split runs after this run ends, as a run of its own, and the person reviews the stack before accepting it.",
    parameters: Type.Object({}),
    async execute(
      _id: string,
      _params: Record<string, never>,
      _onUpdate: unknown,
      _toolContext: unknown,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = threadOfContext(context)
      return resultOf(lane === undefined ? NO_LANE : await askSplit(lane))
    },
  }
}

/**
 * `ask`: relay an ask to another thread's agent, a member of this thread. It
 * never waits for the answer, which arrives as a message: two agents that
 * waited on each other would never finish.
 */
export function askTool(
  ask: (lane: ThreadId, to: string, text: string) => Promise<ToolAnswer>,
) {
  return {
    name: ASK_TOOL,
    label: "ask",
    description:
      "Ask another thread's agent, a member of this thread, by its thread's name. It does not wait: it answers whether the ask was relayed or queued, and the other agent's answer arrives later as a message. An @name you write in a reply asks nobody; only this does.",
    parameters: Type.Object({
      to: Type.String({ description: "The other thread's name, as amber-fox" }),
      text: Type.String({ description: "What you ask it" }),
    }),
    async execute(
      _id: string,
      params: { to: string; text: string },
      _onUpdate: unknown,
      _toolContext: unknown,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = threadOfContext(context)
      const answer =
        lane === undefined
          ? NO_LANE
          : await ask(lane, params.to.replace(/^@/, ""), params.text)
      return resultOf(answer)
    },
  }
}

/** `leave`: this thread's agent leaves another thread's members. */
export function leaveTool(
  leave: (lane: ThreadId, thread: string) => Promise<ToolAnswer>,
) {
  return {
    name: LEAVE_TOOL,
    label: "leave",
    description:
      "Leave another thread you were invited into: you are no longer asked there.",
    parameters: Type.Object({
      thread: Type.String({ description: "That thread's name" }),
    }),
    async execute(
      _id: string,
      params: { thread: string },
      _onUpdate: unknown,
      _toolContext: unknown,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = threadOfContext(context)
      const answer =
        lane === undefined
          ? NO_LANE
          : await leave(lane, params.thread.replace(/^@/, ""))
      return resultOf(answer)
    },
  }
}
