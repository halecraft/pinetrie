// interface/proposal-view — an agent's proposal of branches as a column draws
// it: which proposals the column's path holds and where each stands
// (`columnProposals`), and what one card shows and offers (`proposalView`),
// worded in one place (`proposalWords`).

import {
  type AskIndex,
  type EntryId,
  entryAsk,
  entryThread,
  type LaneView,
  type Proposal,
  type ProposalState,
  type ProposedThread,
  proposalState,
  runPrompt,
  type ThreadId,
  type TreeIndex,
  threadLane,
  type WriterId,
} from "@pinetrie/core"

/** A press on a proposal's card, as the page asks the host. */
export type ProposalPress =
  /** Open, or open and start, the rows kept, each with its brief as left. */
  | {
      readonly kind: "start" | "open"
      readonly rows: readonly {
        readonly row: number
        readonly brief: string
        /** Changed in the card: Open keeps it as that composer's start. */
        readonly edited: boolean
      }[]
    }
  /** Send each of your opened branches still unsent, from its composer. */
  | {
      readonly kind: "send"
      readonly fork: EntryId
      readonly threads: readonly {
        readonly thread: ThreadId
        readonly row: number
      }[]
    }

/** One proposal on a column's path, and where it stands. */
export interface ProposalFacts {
  readonly proposal: EntryId
  readonly content: Proposal
  readonly state: ProposalState
  /** Your branches of it still unsent: Send's, when you pressed Open. */
  readonly unsent: readonly {
    readonly thread: ThreadId
    readonly row: number
  }[]
}

/**
 * The proposals among `nodes`, by the prompt of the ask whose run made each,
 * in order: what a column draws after each ask's work. Running is read from
 * the proposing lane, which may be another than the column's: a shared
 * stretch of path is drawn in the leftmost column showing it.
 */
export function columnProposals(input: {
  readonly nodes: readonly EntryId[]
  readonly index: TreeIndex
  readonly asks: AskIndex
  readonly branches: ReadonlyMap<EntryId, readonly ProposedThread[]>
  readonly lanes: readonly LaneView[]
  readonly me: WriterId
}): ReadonlyMap<EntryId, readonly ProposalFacts[]> {
  const { index, asks } = input
  const out = new Map<EntryId, ProposalFacts[]>()
  for (const id of input.nodes) {
    const prompt = entryAsk(asks, id)
    if (prompt === undefined) continue
    // A tool's result is no node: it is a child of the message holding its call.
    for (const entry of index.childrenOf.get(id) ?? []) {
      const content = index.entries[entry]?.message?.proposal
      if (content === undefined) continue
      const lane = entryThread(index, entry)
      const view = lane === null ? undefined : threadLane(input.lanes, lane)
      const runningAsk =
        view?.kind === "lane" && view.running
          ? runPrompt(index, view.tip)
          : null
      const state = proposalState({
        index,
        asks,
        branches: input.branches,
        proposal: entry,
        runningAsk,
      })
      if (state === null) continue
      const unsent =
        state.kind === "spent" && state.by === input.me
          ? state.threads
              .filter(t => !t.started)
              .map(t => ({ thread: t.thread, row: t.row }))
          : []
      out.set(prompt, [
        ...(out.get(prompt) ?? []),
        { proposal: entry, content, state, unsent },
      ])
    }
  }
  return out
}

/** What the reader changed in a proposal's card before a press. */
export interface ProposalMemory {
  /** Each edited row's brief. */
  readonly edited: ReadonlyMap<number, string>
  readonly dropped: ReadonlySet<number>
  /** The rows opened to read or edit their brief. */
  readonly open: ReadonlySet<number>
}

export const NO_PROPOSAL_MEMORY: ProposalMemory = {
  edited: new Map(),
  dropped: new Set(),
  open: new Set(),
}

/** One row of a proposal's card. */
interface ProposalRowView {
  readonly row: number
  readonly title: string
  /** Its brief as it would be sent: the edit, else the agent's. */
  readonly brief: string
  /** The brief's first line, what a closed row shows. */
  readonly firstLine: string
  readonly open: boolean
  readonly dropped: boolean
  readonly edited: boolean
}

/** A button on the card: its words, and the press it makes when enabled. */
export interface ProposalButton {
  readonly label: string
  /** Null while the host would refuse it. */
  readonly press: ProposalPress | null
}

interface ProposalView {
  readonly proposal: EntryId
  readonly rows: readonly ProposalRowView[]
  /** Rows can be edited and dropped: before any press, where you may write. */
  readonly editable: boolean
  readonly start: ProposalButton | null
  readonly open: ProposalButton | null
  /** Your opened branches still unsent; null for anyone else, or none. */
  readonly send: ProposalButton | null
  /** Where it stands, in words; null while it waits for nothing. */
  readonly state: string | null
}

/**
 * What a proposal's card shows and offers `me`. Start and Open count the rows
 * kept, and are offered only once the host would take them: the run ended,
 * the proposal not spent, the column writable (`readOnly` its words, null
 * when writable). Send is the presser's alone.
 */
export function proposalView(input: {
  readonly facts: ProposalFacts
  readonly memory: ProposalMemory
  readonly readOnly: string | null
  readonly nameOf: (writer: WriterId) => string
}): ProposalView {
  const { facts, memory } = input
  const { state } = facts
  const rows = facts.content.branches.map((b, row): ProposalRowView => {
    const edit = memory.edited.get(row)
    const brief = edit ?? b.brief
    return {
      row,
      title: b.title,
      brief,
      firstLine: brief.split("\n")[0] ?? "",
      open: memory.open.has(row),
      dropped: memory.dropped.has(row),
      edited: edit !== undefined && edit !== b.brief,
    }
  })
  const kept = rows.filter(r => !r.dropped && r.brief.trim() !== "")
  if (state.kind === "spent")
    return {
      proposal: facts.proposal,
      rows,
      editable: false,
      start: null,
      open: null,
      send:
        facts.unsent.length === 0
          ? null
          : {
              label: proposalWords({
                kind: "send",
                count: facts.unsent.length,
              }),
              press:
                input.readOnly === null
                  ? { kind: "send", fork: state.fork, threads: facts.unsent }
                  : null,
            },
      state: proposalWords({
        kind: "spent",
        by: input.nameOf(state.by),
        started: state.threads.every(t => t.started),
        unsent: state.threads.filter(t => !t.started).length,
      }),
    }
  // Start and Open are drawn only once a press would take: shown disabled
  // through a run, they read as broken. Nothing kept stays a disabled
  // button, since ↺ is the reader's own way back.
  const offered = state.kind === "ready" && input.readOnly === null
  const pressed = kept.map(r => ({
    row: r.row,
    brief: r.brief.trim(),
    edited: r.edited,
  }))
  const branchOut = (kind: "start" | "open"): ProposalButton | null =>
    offered
      ? {
          label: proposalWords({ kind, count: kept.length }),
          press: kept.length > 0 ? { kind, rows: pressed } : null,
        }
      : null
  return {
    proposal: facts.proposal,
    rows,
    editable: input.readOnly === null,
    start: branchOut("start"),
    open: branchOut("open"),
    send: null,
    state:
      state.kind === "running"
        ? proposalWords({ kind: "running" })
        : input.readOnly,
  }
}

/** What a proposal's card says, worded in one place. */
function proposalWords(
  said:
    | { readonly kind: "start" | "open" | "send"; readonly count: number }
    | { readonly kind: "running" }
    | {
        readonly kind: "spent"
        readonly by: string
        readonly started: boolean
        readonly unsent: number
      },
): string {
  switch (said.kind) {
    case "start":
      return `Start ${said.count}`
    case "open":
      return `Open ${said.count}`
    case "send":
      return `Send ${said.count}`
    case "running":
      return "waiting for the run to end"
    case "spent":
      return said.started
        ? `started by ${said.by}`
        : `opened by ${said.by} · ${said.unsent} unsent`
  }
}
