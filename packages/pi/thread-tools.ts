// pi/thread-tools — the tools an agent acts on its own thread with: `catch_up`,
// which merges its base's or its parent's new work into its copy during the
// run, `resolve_conflict`, which closes a folder lane's conflicted path,
// `split_proposed_changes`, which queues its proposed changes' split, and
// `propose_branches`, which proposes threads a person starts; and the tools it
// talks to other threads' agents with: `ask`, which relays an ask to a member
// without waiting, and `leave`. The host decides and carries them out
// (`LaneHooks`); this only reads the call and hands back the host's answer, as
// the model reads it. `propose_branches` asks the host nothing: its result is
// the proposal, and a person's press acts on it.

import {
  ASK_TOOL,
  GET_LATEST_TOOL,
  LEAVE_TOOL,
  type PointId,
  PROPOSE_TOOL,
  type Proposal,
  RESOLVE_TOOL,
  SPLIT_TOOL,
  type ThreadId,
} from "@pinetrie/core"
import { parseProposal, type ToolAnswer } from "@pinetrie/rules"
import { Type } from "typebox"
import { threadOfContext } from "./thread-context.ts"

type Context = Parameters<typeof threadOfContext>[0]

/** `catch_up`'s `from` as the agent passed it: the base unless it named the parent. */
export const parseGetLatestArgs = (args: {
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
export function getLatestTool(
  getLatest: (lane: ThreadId, from: "base" | "parent") => Promise<ToolAnswer>,
) {
  return {
    name: GET_LATEST_TOOL,
    label: "get the latest",
    description:
      "Merge the new work of this thread's base (accepted work, or its unfinished work), or with from: parent of the thread this one branched from, into this thread's own copy, now. It acts only when there is new work, and must be the only tool call in its turn. A clean merge answers what came in; a conflicted one answers the conflicts, to resolve here.",
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
          : await getLatest(lane, parseGetLatestArgs(params))
      return resultOf(answer)
    },
  }
}

/** `resolve_conflict`'s `choose` as the agent passed it; null for anything else. */
const parseResolveChoice = (
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

/** What the model is told of a proposal it made. */
const proposedText = (proposal: Proposal): string =>
  `Proposed ${proposal.branches.length === 1 ? "1 branch" : `${proposal.branches.length} branches`}: ${proposal.branches.map(b => b.title).join("; ")}. A person starts them from the proposal, after this run ends. Finish your reply; nothing runs until then.`

/**
 * `propose_branches`: its result's `details` are the proposal, which the
 * page draws as a card and a person's press opens or starts. An invalid call
 * fails with why, and has no details, so no card is drawn for it.
 */
export function proposeTool() {
  return {
    name: PROPOSE_TOOL,
    label: "propose branches",
    description:
      "Propose new threads that branch from the end of this run, one per item, each with a short title and a brief the new thread's agent starts from. A person reads the proposal and starts or opens them; nothing starts on its own. Use it when the person asks for work split into threads.",
    parameters: Type.Object({
      branches: Type.Array(
        Type.Object({
          title: Type.String({ description: "A few words naming the work" }),
          brief: Type.String({
            description:
              "What the new thread's agent is asked to do; it also reads this thread",
          }),
        }),
        { description: "One per new thread, in the order to show them" },
      ),
    }),
    async execute(_id: string, params: unknown) {
      const read = parseProposal(params)
      // pi marks a result failed only when its tool throws.
      if ("refused" in read) throw new Error(read.refused)
      return {
        content: [{ type: "text" as const, text: proposedText(read) }],
        details: read,
      }
    },
  }
}
