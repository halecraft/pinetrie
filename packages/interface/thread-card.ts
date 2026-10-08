// interface/thread-card — what a thread card shows in its header (ADR-0111):
// a root on the board, or in the sidebar, is one card, its header built once
// per root (`threadCardHeads`) and read by both views. Neutral: never in the
// thread's colour. PURE.

import type {
  EntryId,
  RootId,
  RootWork,
  Workflow,
  WorkflowStateId,
} from "@pinetrie/core"
import type { Status } from "./attention.ts"
import type { Intent } from "./intent.ts"
import { NO_TEXT } from "./root-label.ts"

/** A move to another workflow state, as a thread card's ⋯ offers it. */
export interface ThreadMove {
  readonly name: string
  /** To the closed state: it archives the root. */
  readonly closes: boolean
  /** Why it is refused now (`ROOT_BUSY_REASON`'s key), into the closed state only. */
  readonly busy: RootWork | null
  /** Into the closed state, the threads whose offers it withdraws (ADR-0061). */
  readonly drops: readonly string[]
  readonly intent: Intent
}

/** A thread card's header: its signals, and its ⋯'s Move to ▸. */
export interface ThreadCardHead {
  /** Its id; null for a root whose directory record has not arrived. */
  readonly root: RootId | null
  readonly entry: EntryId
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
  /** Each root's id, by root entry. */
  readonly rootIds: ReadonlyMap<EntryId, RootId>
  /** Each root's state on the board, by root entry (`boardOf`). */
  readonly stateOf: ReadonlyMap<EntryId, WorkflowStateId>
  /** Each root's label (`labelsOf`). */
  readonly labels: ReadonlyMap<EntryId, string>
  /** Each root's status (`rootStatus`, ADR-0077). */
  readonly status: ReadonlyMap<EntryId, Status>
  /** Roots holding an unsent card of yours (`CardMarks.roots`). */
  readonly pips: ReadonlySet<EntryId>
  /** The threads with an open offer, by root (`offeredByRoot`). */
  readonly offered: ReadonlyMap<EntryId, readonly string[]>
  /** The agent's work in each root, held or not (`workAnywhere`). */
  readonly work: ReadonlyMap<string, RootWork>
}

/** The header of the root whose root entry is `entry`. */
export function threadCardHead(
  entry: EntryId,
  facts: ThreadCardFacts,
): ThreadCardHead {
  const root = facts.rootIds.get(entry) ?? null
  const state = facts.stateOf.get(entry) ?? null
  return {
    root,
    entry,
    label: facts.labels.get(entry) ?? NO_TEXT,
    status: facts.status.get(entry) ?? null,
    ready: facts.offered.get(entry) ?? [],
    pip: facts.pips.has(entry),
    state,
    moves: movesOf(root, entry, state, facts),
  }
}

/** "Move to ▸" each state but `from`. */
function movesOf(
  root: RootId | null,
  entry: EntryId,
  from: WorkflowStateId | null,
  facts: ThreadCardFacts,
): readonly ThreadMove[] {
  const { workflow } = facts
  if (workflow === null || root === null || from === null) return []
  return [...workflow.open, workflow.closed].flatMap(to => {
    if (to.id === from) return []
    const closes = to.id === workflow.closed.id
    return [
      {
        name: to.name,
        closes,
        busy: closes ? (facts.work.get(entry) ?? null) : null,
        drops: closes ? (facts.offered.get(entry) ?? []) : [],
        intent: {
          kind: "moveRoot",
          root,
          from,
          to: to.id,
          before: null,
          closes,
        },
      },
    ]
  })
}

/** Every root's header, once, by root entry: what the board and the sidebar both read. */
export function threadCardHeads(
  entries: Iterable<EntryId>,
  facts: ThreadCardFacts,
): ReadonlyMap<EntryId, ThreadCardHead> {
  const heads = new Map<EntryId, ThreadCardHead>()
  for (const entry of entries) heads.set(entry, threadCardHead(entry, facts))
  return heads
}
