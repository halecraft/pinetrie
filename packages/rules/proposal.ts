// proposal — an agent's proposal of branches: its shape, read once for the
// tool's arguments and the stored result alike, and the plan for a press of
// Start or Open. The draft an opened branch's composer starts with is
// `canvas.ts`' (`proposalDraft`), beside the threads not yet started.

import {
  type AskIndex,
  agentAsk,
  type BranchedFact,
  type BranchOut,
  type CanvasId,
  type CardRecord,
  type EntryId,
  type NonEmpty,
  nonEmpty,
  type Proposal,
  type ProposalState,
  type ProposedBranch,
  parseMentions,
  proposalState,
  type Send,
  type StartedRow,
  type ThreadId,
  type ThreadRecord,
  type TreeIndex,
  threadAt,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import { afterSteps, type PlaceStep } from "./moves.ts"
import { type OpenPlan, planBranchOpen } from "./open.ts"

/** What a model is told when its arguments are not a proposal. */
const NOT_A_PROPOSAL =
  "branches is a list of { title, brief }, at least one, each with a title and a brief."

/**
 * A call's arguments as a proposal, titles and briefs trimmed; or why not, in
 * words for the model. The stored result is read by the same rule
 * (`decodeProposal`), so what a call proposed and what a page reads agree.
 */
export function parseProposal(
  args: unknown,
): Proposal | { readonly refused: string } {
  if (typeof args !== "object" || args === null)
    return { refused: NOT_A_PROPOSAL }
  const { branches } = args as { branches?: unknown }
  if (!Array.isArray(branches) || branches.length === 0)
    return { refused: NOT_A_PROPOSAL }
  const read: ProposedBranch[] = []
  for (const [i, b] of branches.entries()) {
    const { title, brief } = (typeof b === "object" && b !== null ? b : {}) as {
      title?: unknown
      brief?: unknown
    }
    const t = typeof title === "string" ? title.trim() : ""
    const r = typeof brief === "string" ? brief.trim() : ""
    if (t === "" || r === "")
      return {
        refused: `branch ${i + 1} needs a title and a brief. ${NOT_A_PROPOSAL}`,
      }
    read.push({ title: t, brief: r })
  }
  const proposed = nonEmpty(read)
  return proposed === null
    ? { refused: NOT_A_PROPOSAL }
    : { branches: proposed }
}

/** A tool result's `details` as the proposal it holds; undefined for anything else. */
export const decodeProposal = (details: unknown): Proposal | undefined => {
  const read = parseProposal(details)
  return "refused" in read ? undefined : read
}

/** Why a press is refused: as the proposal stands, or a branch's opening. */
export type BranchOutRefusal =
  | "no-proposal"
  | "running"
  | "spent"
  | "no-row"
  | Extract<OpenPlan, { kind: "refused" }>["why"]

/** Everything a press opens: the threads' records, then one places change. */
export interface Opening {
  readonly records: readonly ValueWrite[]
  readonly steps: readonly PlaceStep[]
}

/** A press planned: Start alone carries sends. */
type BranchOutPlan =
  | {
      readonly how: "open"
      readonly opening: Opening
      readonly fact: BranchedFact
    }
  | {
      readonly how: "start"
      readonly opening: Opening
      readonly sends: NonEmpty<Send>
      readonly fact: BranchedFact
    }

/**
 * A press on the proposal at `press.proposal`, by `sender`. Refused while
 * its run runs, once any branch names it, for a row past its end, for a canvas
 * that is not the proposing thread's, or as a branch's opening is. Each
 * branch opens after the one before it, the first after the proposing
 * thread: opened one by one after the parent, they would land reversed.
 */
export function planBranchOut(input: {
  readonly press: BranchOut
  /** The root's tree. */
  readonly index: TreeIndex
  readonly asks: AskIndex
  readonly branches: Parameters<typeof proposalState>[0]["branches"]
  readonly runningAsk: EntryId | null
  readonly sender: WriterId
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  /** Each thread's canvas (`CanvasIndex.canvasOfThread`). */
  readonly canvasOfThread: ReadonlyMap<ThreadId, CanvasId>
  /** Every canvas the session holds. */
  readonly canvases: ReadonlySet<CanvasId>
  readonly now: number
}):
  | BranchOutPlan
  | { readonly kind: "refused"; readonly why: BranchOutRefusal } {
  const { press, index } = input
  const state: ProposalState | null = proposalState({
    index,
    asks: input.asks,
    branches: input.branches,
    proposal: press.proposal,
    runningAsk: input.runningAsk,
  })
  const proposal = index.entries[press.proposal]?.message?.proposal
  if (state === null || proposal === undefined)
    return { kind: "refused", why: "no-proposal" }
  if (state.kind !== "ready") return { kind: "refused", why: state.kind }
  const lane = threadAt(index, press.proposal)
  if (lane === null || input.canvasOfThread.get(lane) !== press.canvas)
    return { kind: "refused", why: "unknown" }
  const last = press.branches.at(-1)
  if (last === undefined || last.row >= proposal.branches.length)
    return { kind: "refused", why: "no-row" }
  let cards = input.cards
  let after: ThreadId = lane
  const records: ValueWrite[] = []
  const steps: PlaceStep[] = []
  for (const b of press.branches) {
    const opened = planBranchOpen({
      thread: b.thread,
      root: press.root,
      canvas: press.canvas,
      at: state.fork,
      after,
      proposal: { entry: press.proposal, row: b.row },
      index,
      sender: input.sender,
      cards,
      threads: input.threads,
      canvases: input.canvases,
      now: input.now,
    })
    if (opened.kind === "refused") return opened
    records.push(...opened.records)
    steps.push(...opened.steps)
    cards = afterSteps(cards, opened.steps)
    after = b.thread
  }
  const opening: Opening = { records, steps }
  const fact = (how: BranchedFact["how"]): BranchedFact => ({
    kind: "branched",
    lane,
    by: input.sender,
    proposal: press.proposal,
    how,
    titles: press.branches.map(b => proposal.branches[b.row]?.title ?? ""),
  })
  if (press.how === "open")
    return { how: "open", opening, fact: fact("opened") }
  const send = (b: StartedRow): Send => {
    const text = agentAsk(b.brief)
    return {
      kind: "send",
      text,
      root: press.root,
      at: {
        kind: "branch",
        thread: b.thread,
        at: state.fork,
        canvas: press.canvas,
      },
      mentions: parseMentions(text),
      card: null,
      pinned: [],
      base: null,
      state: null,
    }
  }
  const [head, ...tail] = press.branches
  return {
    how: "start",
    opening,
    sends: [send(head), ...tail.map(send)],
    fact: fact("started"),
  }
}
