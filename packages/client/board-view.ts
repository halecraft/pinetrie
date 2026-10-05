// client/board-view — what the board shows and offers (ADR-0085), decided.
// PURE: `Board` and `BoardStrip` (`board.tsx`) draw it.
//
// The board is everyone's: every root with a message, in its workflow state.
// Its strip, in the footer, says each state's name, count and highest mark;
// opened, each open state is a column of items, and the closed state is a
// count, a search over labels and its most recent roots.

import type {
  BoardPlace,
  EntryId,
  RootId,
  RootSummary,
  Workflow,
  WorkflowState,
  WorkflowStateId,
  WriterId,
} from "@pineta/core"
import { boardOf } from "@pineta/rules"
import { type Level, markOf, type Status } from "./attention.ts"
import type { Intent } from "./intent.ts"
import { NO_TEXT } from "./root-label.ts"
import { stepsIn } from "./root-target.ts"

/** A root on the board. */
export interface BoardItem {
  readonly root: RootId
  readonly entry: EntryId
  readonly label: string
  /** What its mark draws (`rootStatus`), or null for none. */
  readonly status: Status | null
  /** An unsent card of yours is in it (`CardMarks.roots`). */
  readonly card: boolean
  /** Everyone who wrote a chat in it, in order of first message. */
  readonly writers: readonly WriterId[]
  /** The state it is in: what its drag carries. */
  readonly state: WorkflowStateId
  readonly show: Intent
  /** Its ⋯'s "Move to ▸", one per other state: the keyboard's way to every move. */
  readonly moves: readonly BoardMove[]
  /** Its ⋯'s Move up and Move down within its state; null at an end. */
  readonly up: Intent | null
  readonly down: Intent | null
}

/** A move to another state, as an item's ⋯ offers it. */
export interface BoardMove {
  readonly name: string
  /** To the closed state: it archives the root. */
  readonly closes: boolean
  /** Why it is refused now (`ROOT_BUSY_REASON`'s key), into the closed state only. */
  readonly busy: "running" | "waiting" | null
  readonly intent: Intent
}

/** An open state's column. */
export interface BoardColumnView {
  readonly state: WorkflowState
  readonly items: readonly BoardItem[]
  /** Its highest mark (`markOf`). */
  readonly mark: Level | null
  /** ＋ here: a new root that lands in this state. */
  readonly add: { readonly agent: Intent; readonly conversation: Intent }
  /** One place left or right among the open states; null at an end. */
  readonly left: Intent | null
  readonly right: Intent | null
  /** Remove it, or why it cannot be removed (`removeWords`). */
  readonly remove: { readonly intent: Intent; readonly why: string | null }
}

/** The closed state: collapsed to its count, a search, and its rows. */
export interface ClosedView {
  readonly state: WorkflowState
  readonly count: number
  /** The roots `query` and `mine` keep, newest first; the most recent few with no query. */
  readonly rows: readonly BoardItem[]
}

/** One state as the strip says it. */
export interface StripState {
  readonly id: WorkflowStateId
  readonly name: string
  readonly count: number
  readonly mark: Level | null
  /** Its roots: the strip's avatars are the people reading in them. */
  readonly roots: readonly EntryId[]
  readonly closed: boolean
}

export interface BoardView {
  readonly strip: readonly StripState[]
  readonly open: readonly BoardColumnView[]
  readonly closed: ClosedView
}

/** How many of the closed state's roots it shows with no query. */
export const CLOSED_RECENT = 8

export interface BoardViewInput {
  readonly workflow: Workflow
  readonly places: ReadonlyMap<RootId, BoardPlace>
  /** Each root's root entry, by its id: every root with a message (`rootEntriesOf`). */
  readonly rootEntries: ReadonlyMap<RootId, EntryId>
  /** Each root, by its root entry (`summariesOf`). */
  readonly summaries: readonly RootSummary[]
  /** Each root's label (`labelsOf`). */
  readonly labels: ReadonlyMap<EntryId, string>
  /** Each root's status (`rootStatus`). */
  readonly status: ReadonlyMap<EntryId, Status>
  /** Roots holding an unsent card of yours (`CardMarks.roots`). */
  readonly cardRoots: ReadonlySet<EntryId>
  /** The closed state's search, and whether it keeps only roots you wrote in. */
  readonly query: string
  readonly mine: boolean
  readonly me: WriterId
  /** The agent's work in each root (`rootWork`): a root it works in is not closed. */
  readonly work: ReadonlyMap<string, "running" | "waiting">
}

export function boardView(input: BoardViewInput): BoardView {
  const { workflow } = input
  const board = boardOf(workflow, input.places, input.rootEntries.keys())
  const summaries = new Map(input.summaries.map(s => [s.root, s]))
  const states = [...workflow.open, workflow.closed]
  /** A move within `state`, before `before` there, or to its end. */
  const within = (
    root: RootId,
    state: WorkflowStateId,
    before: RootId | null,
  ): Intent => ({
    kind: "moveRoot",
    root,
    from: state,
    to: state,
    before,
    closes: false,
  })
  const itemOf = (
    root: RootId,
    state: WorkflowStateId,
    column: readonly RootId[],
  ): BoardItem | null => {
    const entry = input.rootEntries.get(root)
    if (entry === undefined) return null
    const steps = stepsIn(column, root)
    return {
      root,
      entry,
      label: input.labels.get(entry) ?? NO_TEXT,
      status: input.status.get(entry) ?? null,
      card: input.cardRoots.has(entry),
      writers: summaries.get(entry)?.writers ?? [],
      state,
      show: { kind: "show", here: { kind: "root", root: entry } },
      up: steps.up === null ? null : within(root, state, steps.up.before),
      down: steps.down === null ? null : within(root, state, steps.down.before),
      moves: states.flatMap(to => {
        if (to.id === state) return []
        const closes = to.id === workflow.closed.id
        return [
          {
            name: to.name,
            closes,
            busy: closes ? (input.work.get(entry) ?? null) : null,
            intent: {
              kind: "moveRoot",
              root,
              from: state,
              to: to.id,
              before: null,
              closes,
            },
          },
        ]
      }),
    }
  }
  const itemsOf = (column: {
    roots: readonly RootId[]
    state: WorkflowState
  }) =>
    column.roots.flatMap(r => {
      const item = itemOf(r, column.state.id, column.roots)
      return item === null ? [] : [item]
    })
  const open = board.open.map((column, i): BoardColumnView => {
    const items = itemsOf(column)
    const { state } = column
    const before = (to: WorkflowStateId | null): Intent => ({
      kind: "editWorkflow",
      edit: { action: "move", state: state.id, name: "", before: to },
    })
    const next = board.open[i + 1]
    const afterNext = board.open[i + 2]
    const previous = board.open[i - 1]
    return {
      state,
      items,
      mark: markOf(
        input.status,
        items.map(t => t.entry),
      ),
      add: {
        agent: { kind: "newTab", asksAgent: true, state: state.id },
        conversation: { kind: "newTab", asksAgent: false, state: state.id },
      },
      left: previous === undefined ? null : before(previous.state.id),
      right: next === undefined ? null : before(afterNext?.state.id ?? null),
      remove: {
        intent: {
          kind: "editWorkflow",
          edit: { action: "remove", state: state.id, name: "", before: null },
        },
        why: removeWords(items.length, board.open.length),
      },
    }
  })
  const closedItems = itemsOf(board.closed)
  const closed: ClosedView = {
    state: board.closed.state,
    count: closedItems.length,
    rows: closedRows({
      items: closedItems,
      summaries,
      query: input.query,
      mine: input.mine,
      me: input.me,
    }),
  }
  return {
    strip: [
      ...open.map(c => ({
        id: c.state.id,
        name: c.state.name,
        count: c.items.length,
        mark: c.mark,
        roots: c.items.map(t => t.entry),
        closed: false,
      })),
      {
        id: closed.state.id,
        name: closed.state.name,
        count: closed.count,
        mark: null,
        roots: [],
        closed: true,
      },
    ],
    open,
    closed,
  }
}

/**
 * The closed state's rows: newest activity first, case-insensitive over each
 * root's label (`labelsOf`, so a title is found): a search of every message
 * would hold every root's document (ADR-0063). "mine" keeps the roots `me`
 * wrote a chat in. With no query, only the most recent few.
 */
export function closedRows(input: {
  readonly items: readonly BoardItem[]
  readonly summaries: ReadonlyMap<EntryId, RootSummary>
  readonly query: string
  readonly mine: boolean
  readonly me: WriterId
}): readonly BoardItem[] {
  const needle = input.query.trim().toLowerCase()
  const newest = (t: BoardItem) => input.summaries.get(t.entry)?.newest ?? ""
  const kept = input.items
    .filter(t => !input.mine || t.writers.includes(input.me))
    .filter(t => needle === "" || t.label.toLowerCase().includes(needle))
    .toSorted((a, b) =>
      newest(a) < newest(b) ? 1 : newest(a) > newest(b) ? -1 : 0,
    )
  return needle === "" ? kept.slice(0, CLOSED_RECENT) : kept
}

/** Why an open state cannot be removed, or null when it can (ADR-0085). */
export function removeWords(roots: number, openStates: number): string | null {
  if (roots > 0)
    return `holds ${roots === 1 ? "a root" : `${roots} roots`}: move ${roots === 1 ? "it" : "them"} first`
  if (openStates === 1) return "the board needs one open state"
  return null
}

/** A state renamed, or a new one added: the board's name field sends this. */
export const nameStateIntent = (
  state: WorkflowStateId | null,
  name: string,
): Intent => ({
  kind: "editWorkflow",
  edit: {
    action: state === null ? "add" : "rename",
    state,
    name,
    before: null,
  },
})

/** What the closed state's count says. */
export const closedWords = (count: number): string =>
  count === 1 ? "1 root" : `${count} roots`
