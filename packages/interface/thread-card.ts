// interface/thread-card — what a task's card shows in its header: a task on the
// board, or in the sidebar, is one card, its header built once per task
// (`threadCardHeads`) and read by both views. Its signals are its threads'
// together, whatever roots they are in. Neutral: never in the thread's colour.

import type {
  RootWork,
  TaskId,
  Workflow,
  WorkflowStateId,
} from "@pinetrie/core"
import type { Status } from "./attention.ts"
import type { Intent } from "./intent.ts"
import { NO_TEXT } from "./root-label.ts"

/** A move to another workflow state, as a thread card's ⋯ offers it. */
export interface ThreadMove {
  readonly name: string
  /** To the archive: it archives the task. */
  readonly closes: boolean
  /** Why it is refused now (`ROOT_BUSY_REASON`'s key), into the archive only. */
  readonly busy: RootWork | null
  /** Into the archive, the threads whose proposed changes it withdraws. */
  readonly drops: readonly string[]
  readonly intent: Intent
}

/** A thread card's header: its signals, and its ⋯'s Move to ▸. */
export interface ThreadCardHead {
  readonly task: TaskId
  readonly label: string
  /** What its mark draws (`taskStatus`), or null for none. */
  readonly status: Status | null
  /** Its threads with changes ready to accept (`openProposedByTask`): ⇡, for everyone. */
  readonly ready: readonly string[]
  /** An unsent card of yours is in it (`UnsentSignals.tasks`): your pip. */
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
  /** Each task's state on the board (`boardOf`). */
  readonly stateOf: ReadonlyMap<TaskId, WorkflowStateId>
  /** Each task's label (`labelsOf`). */
  readonly labels: ReadonlyMap<TaskId, string>
  /** Each task's status (`taskStatus`). */
  readonly status: ReadonlyMap<TaskId, Status>
  /** Tasks holding an unsent card of yours (`UnsentSignals.tasks`). */
  readonly pips: ReadonlySet<TaskId>
  /** The threads with open proposed changes, by task (`openProposedByTask`). */
  readonly proposed: ReadonlyMap<TaskId, readonly string[]>
  /** The agent's work in each task, held or not (`taskWork`). */
  readonly work: ReadonlyMap<TaskId, RootWork>
}

export function threadCardHead(
  task: TaskId,
  facts: ThreadCardFacts,
): ThreadCardHead {
  const state = facts.stateOf.get(task) ?? null
  return {
    task,
    label: facts.labels.get(task) ?? NO_TEXT,
    status: facts.status.get(task) ?? null,
    ready: facts.proposed.get(task) ?? [],
    pip: facts.pips.has(task),
    state,
    moves: movesOf(task, state, facts),
  }
}

/** "Move to ▸" each state but `from`. */
function movesOf(
  task: TaskId,
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
        busy: closes ? (facts.work.get(task) ?? null) : null,
        drops: closes ? (facts.proposed.get(task) ?? []) : [],
        intent: {
          kind: "moveTask",
          task,
          from,
          to: to.id,
          before: null,
          closes,
        },
      },
    ]
  })
}

/** Every task's header, once: what the board and the sidebar both read. */
export function threadCardHeads(
  tasks: Iterable<TaskId>,
  facts: ThreadCardFacts,
): ReadonlyMap<TaskId, ThreadCardHead> {
  const heads = new Map<TaskId, ThreadCardHead>()
  for (const task of tasks) heads.set(task, threadCardHead(task, facts))
  return heads
}
