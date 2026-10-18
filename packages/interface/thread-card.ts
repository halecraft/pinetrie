// interface/thread-card — what a canvas's card shows in its header: a canvas on the
// board, or in the sidebar, is one card, its header built once per canvas
// (`threadCardHeads`) and read by both views. Its signals are its threads'
// together, whatever roots they are in. Neutral: never in the thread's colour.

import type { AgentWork, CanvasId, WorkflowStateId } from "@pinetrie/core"
import type { Workflow } from "@pinetrie/rules"
import type { Status } from "./attention.ts"
import type { Intent } from "./intent.ts"
import { NO_TEXT } from "./root-label.ts"

/** A move to another workflow state, as a thread card's ⋯ offers it. */
export interface ThreadMove {
  readonly name: string
  /** To the archive: it archives the canvas. */
  readonly closes: boolean
  /** Why it is refused now (`CANVAS_BUSY_REASON`'s key, `@pinetrie/rules`), into the archive only. */
  readonly busy: AgentWork | null
  /** Into the archive, the threads whose proposed changes it withdraws. */
  readonly drops: readonly string[]
  readonly intent: Intent
}

/** What a Move to ▸ item does, as its title says it, wherever it is offered. */
export const moveTitle = (move: Pick<ThreadMove, "closes">): string =>
  move.closes
    ? "archive: read-only for everyone until moved out"
    : "move it on the board, for everyone"

/** A thread card's header: its signals, and its ⋯'s Move to ▸. */
export interface ThreadCardHead {
  readonly canvas: CanvasId
  readonly label: string
  /** What its mark draws (`canvasStatus`), or null for none. */
  readonly status: Status | null
  /** Its threads with changes ready to accept (`openProposedByCanvas`): ⇡, for everyone. */
  readonly ready: readonly string[]
  /** An unsent card of yours is in it (`UnsentSignals.canvases`): your pip. */
  readonly pip: boolean
  /** The state it is in on the board; null before the host placed it. */
  readonly state: WorkflowStateId | null
  /** "Move to ▸" each state but its own; none before it is placed. */
  readonly moves: readonly ThreadMove[]
}

/** What every thread card's header is read from. */
export interface ThreadCardFacts {
  /** The board's states, or null before the host wrote them. */
  readonly workflow: Workflow | null
  /** Each canvas's state on the board (`taskBoard`). */
  readonly stateOf: ReadonlyMap<CanvasId, WorkflowStateId>
  /** Each canvas's label (`taskLabels`). */
  readonly labels: ReadonlyMap<CanvasId, string>
  /** Each canvas's status (`canvasStatus`). */
  readonly status: ReadonlyMap<CanvasId, Status>
  /** Canvases holding an unsent card of yours (`UnsentSignals.canvases`). */
  readonly pips: ReadonlySet<CanvasId>
  /** The threads with open proposed changes, by canvas (`openProposedByCanvas`). */
  readonly proposed: ReadonlyMap<CanvasId, readonly string[]>
  /** The agent's work in each canvas, held or not (`canvasWork`). */
  readonly work: ReadonlyMap<CanvasId, AgentWork>
}

export function threadCardHead(
  canvas: CanvasId,
  facts: ThreadCardFacts,
): ThreadCardHead {
  const state = facts.stateOf.get(canvas) ?? null
  return {
    canvas,
    label: facts.labels.get(canvas) ?? NO_TEXT,
    status: facts.status.get(canvas) ?? null,
    ready: facts.proposed.get(canvas) ?? [],
    pip: facts.pips.has(canvas),
    state,
    moves: movesOf(canvas, state, facts),
  }
}

/** "Move to ▸" each state but `from`. */
function movesOf(
  canvas: CanvasId,
  from: WorkflowStateId | null,
  facts: ThreadCardFacts,
): readonly ThreadMove[] {
  const { workflow } = facts
  if (workflow === null || from === null) return []
  return [...workflow.open, workflow.archive].flatMap(to => {
    if (to.id === from) return []
    const closes = to.id === workflow.archive.id
    return [
      {
        name: to.name,
        closes,
        busy: closes ? (facts.work.get(canvas) ?? null) : null,
        drops: closes ? (facts.proposed.get(canvas) ?? []) : [],
        intent: {
          kind: "moveCanvas",
          canvas,
          from,
          to: to.id,
          before: null,
          closes,
        },
      },
    ]
  })
}

/** Every canvas's header, once: what the board and the sidebar both read. */
export function threadCardHeads(
  canvases: Iterable<CanvasId>,
  facts: ThreadCardFacts,
): ReadonlyMap<CanvasId, ThreadCardHead> {
  const heads = new Map<CanvasId, ThreadCardHead>()
  for (const canvas of canvases)
    heads.set(canvas, threadCardHead(canvas, facts))
  return heads
}
