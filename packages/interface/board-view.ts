// interface/board-view — what the board shows and offers (ADR-0122), decided.
// PURE: `Board` and `BoardStrip` (`board.tsx`) draw it.
//
// The board is everyone's: every task with a message, in its workflow state
// (ADR-0116). Its strip, in the footer, says each state's name, count and
// highest mark, and how many of its tasks the agent works in and have work
// ready to accept (ADR-0091); opened, each open state is a column of cards,
// each ⇡ when a thread of it has work ready, whose head says what the
// strip's button did, and the archive is a count and its most recent tasks.
// One search over labels, and "mine", filter every state in place
// (ADR-0109), and what the board shows says whether a filter is on
// (`BoardShown`, ADR-0115).

import type {
  BoardPlace,
  TaskId,
  Workflow,
  WorkflowState,
  WorkflowStateId,
  WriterId,
} from "@pinetrie/core"
import { boardOf } from "@pinetrie/rules"
import { type Level, markOf } from "./attention.ts"
import { count } from "./counts.ts"
import type { Intent } from "./intent.ts"
import type { KeyLike } from "./page-keys.ts"
import { NO_TEXT, type TaskSummary } from "./root-label.ts"
import { stepsIn } from "./root-target.ts"
import type { ThreadCardHead } from "./thread-card.ts"

/**
 * A task on the board, its card (ADR-0111, ADR-0116): its header, the one the
 * sidebar draws too (`ThreadCardHead`), spread here and kept whole as
 * `head`, with what only the board adds.
 */
export interface ThreadCard extends Omit<ThreadCardHead, "state"> {
  readonly head: ThreadCardHead
  /** The state it is in: what its drag carries. */
  readonly state: WorkflowStateId
  /** Everyone who wrote a chat in it (`TaskSummary.writers`). */
  readonly writers: readonly WriterId[]
  /** Its body: its first line, under a title that differs from it; null for none. */
  readonly body: string | null
  readonly show: Intent
  /** Its ⋯'s Move up and Move down within its state; null at an end. */
  readonly up: Intent | null
  readonly down: Intent | null
}

/** A state's roots: every one, or those a filter keeps of every one. */
export type Count =
  | { readonly kind: "all"; readonly total: number }
  | { readonly kind: "kept"; readonly kept: number; readonly total: number }

/** What a workflow state shows of its roots' work, beyond their count. */
export interface StateSignals {
  /** Its tasks the agent works in (`Status` working, a pending verdict among them): ◌. */
  readonly working: number
  /** Its tasks with work ready to accept: ⇡. */
  readonly ready: number
  /** The tasks whose readers' avatars it shows. */
  readonly tasks: readonly TaskId[]
}

/** The archive's: it shows none. */
const NO_SIGNALS: StateSignals = { working: 0, ready: 0, tasks: [] }

/** An open state's column. */
export interface BoardColumnView {
  readonly state: WorkflowState
  /** The cards of the roots the search keeps, in their order. */
  readonly items: readonly ThreadCard[]
  readonly count: Count
  /** Its highest mark over every root, kept or not (`markOf`): a filter hides no warning. */
  readonly mark: Level | null
  /** Over the roots the search keeps, as its cards show them. */
  readonly signals: StateSignals
  /** ＋ here: a new root that lands in this state. */
  readonly add: { readonly agent: Intent; readonly conversation: Intent }
  /** One place left or right among the open states; null at an end. */
  readonly left: Intent | null
  readonly right: Intent | null
  /** Where a state added beside it goes: before this state, or before the next (null: last). */
  readonly addBefore: {
    readonly left: WorkflowStateId
    readonly right: WorkflowStateId | null
  }
  /** Remove it, or why it cannot be removed (`removeWords`): every root counts. */
  readonly remove: { readonly intent: Intent; readonly why: string | null }
}

/** The archive: collapsed to its count and its rows. */
export interface ArchiveView {
  readonly state: WorkflowState
  readonly count: Count
  /** The kept roots, newest first; with no words, the most recent few (`archiveRows`). */
  readonly rows: readonly ThreadCard[]
}

/** One state as the strip says it, over every root in it: the strip is never filtered. */
export interface StripState {
  readonly id: WorkflowStateId
  readonly name: string
  readonly count: number
  readonly mark: Level | null
  readonly signals: StateSignals
  readonly archive: boolean
}

/** The board's filter: the words typed, lowercased, and "mine". */
export interface BoardSearch {
  readonly words: readonly string[]
  readonly mine: boolean
}

/** What the board shows of its roots: every one, or those a filter keeps. */
export type BoardShown =
  | { readonly kind: "all"; readonly total: number }
  | {
      readonly kind: "filtered"
      readonly search: BoardSearch
      readonly kept: number
      readonly total: number
    }

export interface BoardView {
  readonly strip: readonly StripState[]
  readonly open: readonly BoardColumnView[]
  readonly archive: ArchiveView
  readonly shown: BoardShown
}

/** How many of the archive's roots it shows with no words to search. */
export const ARCHIVE_RECENT = 8

/** The board's search field, as the key `armFocus` arms when you open the board. */
export const BOARD_SEARCH = "board-search"

export interface BoardViewInput {
  readonly workflow: Workflow
  readonly places: ReadonlyMap<TaskId, BoardPlace>
  /** Each task with a message (`summariesOf`): its first line is a titled card's body. */
  readonly summaries: ReadonlyMap<TaskId, TaskSummary>
  /** Each task's thread card header (`threadCardHeads`), which the sidebar reads too. */
  readonly heads: ReadonlyMap<TaskId, ThreadCardHead>
  /** The board's filter (`parseSearch`), or null for none. */
  readonly search: BoardSearch | null
  readonly me: WriterId
}

/** A card's body: its first line, when its label is a title that says something else. */
const bodyOf = (label: string, line: string | undefined): string | null =>
  line === undefined || line === "" || line === label ? null : line

export function boardView(input: BoardViewInput): BoardView {
  const { workflow, search, summaries } = input
  const board = boardOf(workflow, input.places, summaries.keys())
  const keeps = search === null ? null : boardFilter(search, input.me)
  const headOf = (task: TaskId): ThreadCardHead =>
    input.heads.get(task) ?? {
      task,
      label: NO_TEXT,
      status: null,
      ready: [],
      pip: false,
      state: null,
      moves: [],
    }
  const writersOf = (task: TaskId) => summaries.get(task)?.writers ?? []
  /** A move within `state`, before `before` there, or to its end. */
  const within = (
    task: TaskId,
    state: WorkflowStateId,
    before: TaskId | null,
  ): Intent => ({
    kind: "moveTask",
    task,
    from: state,
    to: state,
    before,
    closes: false,
  })
  /** The signals of `tasks`, from each one's status and offers. */
  const stateSignals = (tasks: readonly TaskId[]): StateSignals => ({
    working: tasks.filter(t => headOf(t).status?.kind === "working").length,
    ready: tasks.filter(t => headOf(t).ready.length > 0).length,
    tasks,
  })
  const status = new Map(
    [...input.heads.values()].flatMap(head =>
      head.status === null ? [] : [[head.task, head.status] as const],
    ),
  )
  /** A kept task's card, whose Move up and Move down step among the tasks `isShown` keeps. */
  const cardOf = (
    task: TaskId,
    state: WorkflowStateId,
    column: readonly TaskId[],
    isShown: (task: TaskId) => boolean,
  ): ThreadCard => {
    const steps = stepsIn(column, task, isShown)
    const head = headOf(task)
    return {
      ...head,
      head,
      state,
      writers: writersOf(task),
      body: bodyOf(head.label, summaries.get(task)?.line),
      show: { kind: "show", here: { kind: "task", task } },
      up: steps.up === null ? null : within(task, state, steps.up.before),
      down: steps.down === null ? null : within(task, state, steps.down.before),
    }
  }
  /**
   * A state's tasks: every one with a message, which its mark, Remove and
   * the strip count, and a card for each the search keeps, which is drawn.
   */
  const tasksOf = (column: {
    tasks: readonly TaskId[]
    state: WorkflowState
  }): {
    all: readonly TaskId[]
    cards: readonly ThreadCard[]
    count: Count
  } => {
    const all = column.tasks.filter(task => summaries.has(task))
    const kept =
      keeps === null
        ? all
        : all.filter(task =>
            keeps({ label: headOf(task).label, writers: writersOf(task) }),
          )
    const shown = new Set(kept)
    return {
      all,
      cards: kept.map(task =>
        cardOf(task, column.state.id, column.tasks, t => shown.has(t)),
      ),
      count:
        keeps === null
          ? { kind: "all", total: all.length }
          : { kind: "kept", kept: kept.length, total: all.length },
    }
  }
  const columns = board.open.map((column, i) => {
    const { all, cards, count } = tasksOf(column)
    const { state } = column
    const before = (to: WorkflowStateId | null): Intent => ({
      kind: "editWorkflow",
      edit: { action: "move", state: state.id, name: "", before: to },
    })
    const next = board.open[i + 1]
    const afterNext = board.open[i + 2]
    const previous = board.open[i - 1]
    const mark = markOf(status, all)
    const view: BoardColumnView = {
      state,
      items: cards,
      count,
      mark,
      signals: stateSignals(cards.map(t => t.task)),
      add: {
        agent: { kind: "newTab", asksAgent: true, state: state.id },
        conversation: { kind: "newTab", asksAgent: false, state: state.id },
      },
      left: previous === undefined ? null : before(previous.state.id),
      right: next === undefined ? null : before(afterNext?.state.id ?? null),
      addBefore: { left: state.id, right: next?.state.id ?? null },
      remove: {
        intent: {
          kind: "editWorkflow",
          edit: { action: "remove", state: state.id, name: "", before: null },
        },
        why: removeWords(all.length, board.open.length),
      },
    }
    const strip: StripState = {
      id: state.id,
      name: state.name,
      count: all.length,
      mark,
      signals: stateSignals(all),
      archive: false,
    }
    return { view, strip }
  })
  const archiveRoots = tasksOf(board.archive)
  const archive: ArchiveView = {
    state: board.archive.state,
    count: archiveRoots.count,
    rows: archiveRows({ items: archiveRoots.cards, summaries, search }),
  }
  const strip: readonly StripState[] = [
    ...columns.map(c => c.strip),
    {
      id: archive.state.id,
      name: archive.state.name,
      count: archiveRoots.all.length,
      mark: null,
      signals: NO_SIGNALS,
      archive: true,
    },
  ]
  const total = strip.reduce((n, s) => n + s.count, 0)
  const kept = columns.reduce(
    (n, c) => n + c.view.items.length,
    archiveRoots.cards.length,
  )
  return {
    strip,
    open: columns.map(c => c.view),
    archive,
    shown:
      search === null
        ? { kind: "all", total }
        : { kind: "filtered", search, kept, total },
  }
}

/**
 * The board's filter from what was typed and "mine", or null for none: the
 * one place an empty search is decided. Words are split on whitespace and
 * lowercased.
 */
export function parseSearch(query: string, mine: boolean): BoardSearch | null {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w !== "")
  return words.length === 0 && !mine ? null : { words, mine }
}

/**
 * What `search` keeps: the tasks whose label (`labelsOf`, so a title is
 * found) holds every word, in any order, and with `mine`, those `me` wrote a
 * chat in. Labels, not messages: a search of every message would hold every
 * root's document (ADR-0063).
 */
function boardFilter(
  search: BoardSearch,
  me: WriterId,
): (root: Pick<ThreadCard, "label" | "writers">) => boolean {
  return root => {
    const label = root.label.toLowerCase()
    return (
      (!search.mine || root.writers.includes(me)) &&
      search.words.every(w => label.includes(w))
    )
  }
}

/**
 * The archive's rows, of the tasks the search kept: newest activity
 * first, and with no words to search (none, or "mine" alone) only the most
 * recent few.
 */
export function archiveRows(input: {
  readonly items: readonly ThreadCard[]
  readonly summaries: ReadonlyMap<TaskId, TaskSummary>
  readonly search: BoardSearch | null
}): readonly ThreadCard[] {
  const newest = (t: ThreadCard) => input.summaries.get(t.task)?.newest ?? ""
  const sorted = input.items.toSorted((a, b) =>
    newest(a) < newest(b) ? 1 : newest(a) > newest(b) ? -1 : 0,
  )
  return (input.search?.words.length ?? 0) === 0
    ? sorted.slice(0, ARCHIVE_RECENT)
    : sorted
}

/** What a key does on the open board (`boardKeyAct`). */
export type BoardKey = "focusSearch" | "clearFilter" | "close"

/** Where focus is, and what is open, when a key is pressed on the open board. */
export interface BoardKeyFocus {
  /** A menu is open on the board: Escape is its (`Popover`). */
  readonly menuOpen: boolean
  /** A filter is on (`BoardShown`). */
  readonly filtered: boolean
  /** Focus is in a text box, where `/` is typed. */
  readonly inText: boolean
}

/**
 * The open board's keys, or null for a key that is not one of them. Escape
 * clears the filter, its words and "mine", before it closes the board, in a
 * text box too: in the search field it is how you leave the search. `/`
 * focuses the search, except in a text box, where it is typed. Apart from
 * `keyAct`'s table: clearing a filter and focusing a field are the board's
 * view state, not intents.
 */
export function boardKeyAct(
  event: KeyLike,
  focus: BoardKeyFocus,
): BoardKey | null {
  if (event.key === "Escape")
    return focus.menuOpen ? null : focus.filtered ? "clearFilter" : "close"
  const modifier = event.ctrlKey || event.metaKey || event.altKey
  if (event.key === "/" && !focus.inText && !modifier) return "focusSearch"
  return null
}

/** Why an open state cannot be removed, or null when it can (ADR-0122). */
export function removeWords(tasks: number, openStates: number): string | null {
  if (tasks > 0)
    return `holds ${tasks === 1 ? "a task" : `${tasks} tasks`}: move ${tasks === 1 ? "it" : "them"} first`
  if (openStates === 1) return "the board needs one open state"
  return null
}

/** Where a press or a click lands, as the open board sees it. */
export type BoardSide = "board" | "strip" | "elsewhere"

/**
 * Whether a click closes the open board: one pressed and released outside
 * it and its strip, whose buttons act for themselves. A press in the board let go
 * outside (a selection dragged out) keeps it open, and a drag from the sidebar
 * ends in no click, so it can drop on the board.
 */
export const clickClosesBoard = (
  press: BoardSide | null,
  release: BoardSide,
): boolean => press === "elsewhere" && release === "elsewhere"

/** A state renamed: its name field sends this. */
export const nameStateIntent = (
  state: WorkflowStateId,
  name: string,
): Intent => ({
  kind: "editWorkflow",
  edit: { action: "rename", state, name, before: null },
})

/** A state added before `before`, or after the open states if null: a new state's name field sends this. */
export const addStateIntent = (
  before: WorkflowStateId | null,
  name: string,
): Intent => ({
  kind: "editWorkflow",
  edit: { action: "add", state: null, name, before },
})

/** A state's ◌ and ⇡, as their titles say them, in the strip and in a column's head (ADR-0091). */
export const stateWords = (
  signals: Pick<StateSignals, "working" | "ready">,
): { readonly working: string; readonly ready: string } => ({
  working: `the agent is working in ${tasksWords(signals.working)}`,
  ready: `${tasksWords(signals.ready)} with work ready to accept`,
})

/** A thread card's ⇡: the threads it names. */
export const readyWords = (threads: readonly string[]): string =>
  `ready to accept: ${threads.join(", ")}`

/** A number of tasks: a state's count's title, and the filter's. */
export const tasksWords = (n: number): string => count(n, "task", "tasks")

/** A state's count in its head: "12 of 96" while a filter keeps some of its tasks. */
export const keptWords = (count: Count): string =>
  count.kind === "kept" ? `${count.kept} of ${count.total}` : `${count.total}`

/** The search's placeholder. */
export const searchWords = (total: number): string =>
  `search ${tasksWords(total)}…`

/** The words searched for, quoted as the banner and ▦'s title say them. */
const quoted = (search: BoardSearch): string => `"${search.words.join(" ")}"`

/** The banner at the board's foot, while a filter is on. */
export function filterWords(
  shown: Extract<BoardShown, { kind: "filtered" }>,
): string {
  const { search, kept, total } = shown
  const words = search.words.length > 0
  if (kept === 0)
    return words
      ? `No tasks${search.mine ? " you wrote in" : ""} match ${quoted(search)}`
      : `You wrote in none of ${tasksWords(total)}`
  const of = `${kept} of ${tasksWords(total)}`
  if (!words) return `Filtered to tasks you wrote in: ${of}`
  return `Filtered by ${quoted(search)}${search.mine ? " and mine" : ""}: ${of}`
}

/** What ▦'s title adds while a filter is on and the board is closed. */
export const filterTitle = (search: BoardSearch): string =>
  `filtered: ${[
    ...(search.words.length > 0 ? [quoted(search)] : []),
    ...(search.mine ? ["mine"] : []),
  ].join(", ")}`

/** The banner's button, which lifts the whole filter. */
export const CLEAR_FILTER = "Clear"
