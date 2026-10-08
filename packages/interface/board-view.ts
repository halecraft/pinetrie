// interface/board-view — what the board shows and offers (ADR-0122), decided.
// PURE: `Board` and `BoardStrip` (`board.tsx`) draw it.
//
// The board is everyone's: every root with a message, in its workflow state.
// Its strip, in the footer, says each state's name, count and highest mark,
// and how many of its roots the agent works in and have work ready to
// accept (ADR-0091); opened, each open state is a column of cards, each ⇡
// when a thread of it has work ready, whose head says what the strip's
// button did, and the closed state is a count and its most recent roots.
// One search over labels, and "mine", filter every state in place
// (ADR-0109), and what the board shows says whether a filter is on
// (`BoardShown`, ADR-0115).

import type {
  BoardPlace,
  EntryId,
  RootId,
  RootSummary,
  Workflow,
  WorkflowState,
  WorkflowStateId,
  WriterId,
} from "@pinetrie/core"
import { boardOf } from "@pinetrie/rules"
import { type Level, markOf } from "./attention.ts"
import { count } from "./counts.ts"
import type { Intent } from "./intent.ts"
import type { KeyLike } from "./inventory-keys.ts"
import { NO_TEXT } from "./root-label.ts"
import { stepsIn } from "./root-target.ts"
import type { ThreadCardHead } from "./thread-card.ts"

/** A root on the board. */
/**
 * A root on the board, a thread card (ADR-0111): its header, the one the
 * sidebar draws too (`ThreadCardHead`), spread here and kept whole as
 * `head`, with what only the board adds.
 */
export interface ThreadCard extends Omit<ThreadCardHead, "root" | "state"> {
  readonly head: ThreadCardHead
  readonly root: RootId
  /** The state it is in: what its drag carries. */
  readonly state: WorkflowStateId
  /** Everyone who wrote a chat in it, in order of first message. */
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
  /** Its roots the agent works in (`Status` working, a pending verdict among them): ◌. */
  readonly working: number
  /** Its roots with work ready to accept: ⇡. */
  readonly ready: number
  /** The roots whose readers' avatars it shows. */
  readonly roots: readonly EntryId[]
}

/** The closed state's: it shows none. */
const NO_SIGNALS: StateSignals = { working: 0, ready: 0, roots: [] }

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

/** The closed state: collapsed to its count and its rows. */
export interface ClosedView {
  readonly state: WorkflowState
  readonly count: Count
  /** The kept roots, newest first; with no words, the most recent few (`closedRows`). */
  readonly rows: readonly ThreadCard[]
}

/** One state as the strip says it, over every root in it: the strip is never filtered. */
export interface StripState {
  readonly id: WorkflowStateId
  readonly name: string
  readonly count: number
  readonly mark: Level | null
  readonly signals: StateSignals
  readonly closed: boolean
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
  readonly closed: ClosedView
  readonly shown: BoardShown
}

/** How many of the closed state's roots it shows with no words to search. */
export const CLOSED_RECENT = 8

/** The board's search field, as the key `armFocus` arms when you open the board. */
export const BOARD_SEARCH = "board-search"

export interface BoardViewInput {
  readonly workflow: Workflow
  readonly places: ReadonlyMap<RootId, BoardPlace>
  /** Each root's root entry, by its id: every root with a message (`rootEntriesOf`). */
  readonly rootEntries: ReadonlyMap<RootId, EntryId>
  /** Each root, by its root entry (`summariesOf`). */
  readonly summaries: readonly RootSummary[]
  /** Each root's thread card header (`threadCardHeads`), which the sidebar reads too. */
  readonly heads: ReadonlyMap<EntryId, ThreadCardHead>
  /** Each root's first line (`firstLinesOf`): a titled card's body. */
  readonly lines: ReadonlyMap<EntryId, string>
  /** The board's filter (`parseSearch`), or null for none. */
  readonly search: BoardSearch | null
  readonly me: WriterId
}

/** A card's body: its first line, when its label is a title that says something else. */
const bodyOf = (label: string, line: string | undefined): string | null =>
  line === undefined || line === "" || line === label ? null : line

export function boardView(input: BoardViewInput): BoardView {
  const { workflow, search } = input
  const board = boardOf(workflow, input.places, input.rootEntries.keys())
  const summaries = new Map(input.summaries.map(s => [s.root, s]))
  const keeps = search === null ? null : boardFilter(search, input.me)
  const _states = [...workflow.open, workflow.closed]
  const headOf = (entry: EntryId): ThreadCardHead =>
    input.heads.get(entry) ?? {
      root: null,
      entry,
      label: NO_TEXT,
      status: null,
      ready: [],
      pip: false,
      state: null,
      moves: [],
    }
  const labelOf = (entry: EntryId) => headOf(entry).label
  const status = new Map(
    [...input.heads].flatMap(([entry, head]) =>
      head.status === null ? [] : [[entry, head.status] as const],
    ),
  )
  const writersOf = (entry: EntryId) => summaries.get(entry)?.writers ?? []
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
  /** The signals of the roots `entries`, from each root's status and offers. */
  const stateSignals = (entries: readonly EntryId[]): StateSignals => ({
    working: entries.filter(e => status.get(e)?.kind === "working").length,
    ready: entries.filter(e => headOf(e).ready.length > 0).length,
    roots: entries,
  })
  /** A kept root's card, whose Move up and Move down step among the roots `isShown` keeps. */
  const cardOf = (
    root: RootId,
    entry: EntryId,
    state: WorkflowStateId,
    column: readonly RootId[],
    isShown: (root: RootId) => boolean,
  ): ThreadCard => {
    const steps = stepsIn(column, root, isShown)
    const head = headOf(entry)
    return {
      ...head,
      head,
      root,
      state,
      writers: writersOf(entry),
      body: bodyOf(head.label, input.lines.get(entry)),
      show: { kind: "show", here: { kind: "root", root: entry } },
      up: steps.up === null ? null : within(root, state, steps.up.before),
      down: steps.down === null ? null : within(root, state, steps.down.before),
    }
  }
  /**
   * A state's roots: the entry of every one, which its mark, Remove and the
   * strip count, and a card for each the search keeps, which is drawn.
   */
  const rootsOf = (column: {
    roots: readonly RootId[]
    state: WorkflowState
  }): {
    entries: readonly EntryId[]
    cards: readonly ThreadCard[]
    count: Count
  } => {
    const all = column.roots.flatMap(root => {
      const entry = input.rootEntries.get(root)
      return entry === undefined ? [] : [{ root, entry }]
    })
    const kept =
      keeps === null
        ? all
        : all.filter(r =>
            keeps({ label: labelOf(r.entry), writers: writersOf(r.entry) }),
          )
    const shown = new Set(kept.map(r => r.root))
    return {
      entries: all.map(r => r.entry),
      cards: kept.map(r =>
        cardOf(r.root, r.entry, column.state.id, column.roots, root =>
          shown.has(root),
        ),
      ),
      count:
        keeps === null
          ? { kind: "all", total: all.length }
          : { kind: "kept", kept: kept.length, total: all.length },
    }
  }
  const columns = board.open.map((column, i) => {
    const { entries, cards, count } = rootsOf(column)
    const { state } = column
    const before = (to: WorkflowStateId | null): Intent => ({
      kind: "editWorkflow",
      edit: { action: "move", state: state.id, name: "", before: to },
    })
    const next = board.open[i + 1]
    const afterNext = board.open[i + 2]
    const previous = board.open[i - 1]
    const mark = markOf(status, entries)
    const view: BoardColumnView = {
      state,
      items: cards,
      count,
      mark,
      signals: stateSignals(cards.map(t => t.entry)),
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
        why: removeWords(entries.length, board.open.length),
      },
    }
    const strip: StripState = {
      id: state.id,
      name: state.name,
      count: entries.length,
      mark,
      signals: stateSignals(entries),
      closed: false,
    }
    return { view, strip }
  })
  const closedRoots = rootsOf(board.closed)
  const closed: ClosedView = {
    state: board.closed.state,
    count: closedRoots.count,
    rows: closedRows({ items: closedRoots.cards, summaries, search }),
  }
  const strip: readonly StripState[] = [
    ...columns.map(c => c.strip),
    {
      id: closed.state.id,
      name: closed.state.name,
      count: closedRoots.entries.length,
      mark: null,
      signals: NO_SIGNALS,
      closed: true,
    },
  ]
  const total = strip.reduce((n, s) => n + s.count, 0)
  const kept = columns.reduce(
    (n, c) => n + c.view.items.length,
    closedRoots.cards.length,
  )
  return {
    strip,
    open: columns.map(c => c.view),
    closed,
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
 * What `search` keeps: the roots whose label (`labelsOf`, so a title is
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
 * The closed state's rows, of the roots the search kept: newest activity
 * first, and with no words to search (none, or "mine" alone) only the most
 * recent few.
 */
export function closedRows(input: {
  readonly items: readonly ThreadCard[]
  readonly summaries: ReadonlyMap<EntryId, RootSummary>
  readonly search: BoardSearch | null
}): readonly ThreadCard[] {
  const newest = (t: ThreadCard) => input.summaries.get(t.entry)?.newest ?? ""
  const sorted = input.items.toSorted((a, b) =>
    newest(a) < newest(b) ? 1 : newest(a) > newest(b) ? -1 : 0,
  )
  return (input.search?.words.length ?? 0) === 0
    ? sorted.slice(0, CLOSED_RECENT)
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
export function removeWords(roots: number, openStates: number): string | null {
  if (roots > 0)
    return `holds ${roots === 1 ? "a root" : `${roots} roots`}: move ${roots === 1 ? "it" : "them"} first`
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
  working: `the agent is working in ${rootsWords(signals.working)}`,
  ready: `${rootsWords(signals.ready)} with work ready to accept`,
})

/** A thread card's ⇡: the threads it names. */
export const readyWords = (threads: readonly string[]): string =>
  `ready to accept: ${threads.join(", ")}`

/** A number of roots: a state's count's title, and the filter's. */
export const rootsWords = (n: number): string => count(n, "root", "roots")

/** A state's count in its head: "12 of 96" while a filter keeps some of its roots. */
export const keptWords = (count: Count): string =>
  count.kind === "kept" ? `${count.kept} of ${count.total}` : `${count.total}`

/** The search's placeholder. */
export const searchWords = (total: number): string =>
  `search ${rootsWords(total)}…`

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
      ? `No roots${search.mine ? " you wrote in" : ""} match ${quoted(search)}`
      : `You wrote in none of ${rootsWords(total)}`
  const of = `${kept} of ${rootsWords(total)}`
  if (!words) return `Filtered to roots you wrote in: ${of}`
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
