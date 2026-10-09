// interface/thread-card — what a task's card shows in its header (ADR-0111,
// ADR-0116): a task on the board, or in the sidebar, is one card, its header
// built once per task (`threadCardHeads`) and read by both views. Its signals
// are its first root's, the one root a task holds until a task's canvas
// holds several. Neutral: never in the thread's colour. PURE.

import type {
  EntryId,
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
  /** Into the archive, the threads whose offers it withdraws (ADR-0061). */
  readonly drops: readonly string[]
  readonly intent: Intent
}

/** A thread card's header: its signals, and its ⋯'s Move to ▸. */
export interface ThreadCardHead {
  readonly task: TaskId
  /** Its first root's root entry; null before that root has a message. */
  readonly entry: EntryId | null
  readonly label: string
  /** What its mark draws (`rootStatus`), or null for none. */
  readonly status: Status | null
  /** Its threads with work ready to accept (`offeredByRoot`): ⇡, for everyone (ADR-0091). */
  readonly ready: readonly string[]
  /** An unsent card of yours is in it (`CardMarks.roots`): your pip. */
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
  /** Each task's first root's root entry (`entriesOf`). */
  readonly entries: ReadonlyMap<TaskId, EntryId>
  /** Each task's state on the board (`boardOf`). */
  readonly stateOf: ReadonlyMap<TaskId, WorkflowStateId>
  /** Each task's label (`labelsOf`). */
  readonly labels: ReadonlyMap<TaskId, string>
  /** Each root's status (`rootStatus`, ADR-0077). */
  readonly status: ReadonlyMap<EntryId, Status>
  /** Roots holding an unsent card of yours (`CardMarks.roots`). */
  readonly pips: ReadonlySet<EntryId>
  /** The threads with an open offer, by root (`offeredByRoot`). */
  readonly offered: ReadonlyMap<EntryId, readonly string[]>
  /** The agent's work in each root, held or not (`workAnywhere`). */
  readonly work: ReadonlyMap<string, RootWork>
}

/** The header of `task`. */
export function threadCardHead(
  task: TaskId,
  facts: ThreadCardFacts,
): ThreadCardHead {
  const entry = facts.entries.get(task) ?? null
  const state = facts.stateOf.get(task) ?? null
  const of = <T>(m: ReadonlyMap<EntryId | string, T>): T | undefined =>
    entry === null ? undefined : m.get(entry)
  return {
    task,
    entry,
    label: facts.labels.get(task) ?? NO_TEXT,
    status: of(facts.status) ?? null,
    ready: of(facts.offered) ?? [],
    pip: entry !== null && facts.pips.has(entry),
    state,
    moves: movesOf(task, entry, state, facts),
  }
}

/** "Move to ▸" each state but `from`. */
function movesOf(
  task: TaskId,
  entry: EntryId | null,
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
        busy: closes && entry !== null ? (facts.work.get(entry) ?? null) : null,
        drops: closes && entry !== null ? (facts.offered.get(entry) ?? []) : [],
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
