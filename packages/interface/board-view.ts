// interface/board-view — what the board shows and offers (ADR-0112), decided.
// PURE: `Board` and `BoardStrip` (`board.tsx`) draw it.
//
// The board is everyone's: every root with a message, in its workflow state.
// Its strip, in the footer, says each state's name, count and highest mark,
// and how many of its roots the agent works in and have work ready to
// accept (ADR-0091); opened, each open state is a column of items, each ⇡
// when a thread of it has work ready, and the closed state is a count and
// its most recent roots. One search over labels, and "mine", filter every
// state in place (ADR-0109).

import type {
  BoardPlace,
  EntryId,
  RootId,
  RootSummary,
  RootWork,
  Workflow,
  WorkflowState,
  WorkflowStateId,
  WriterId,
} from "@pinetrie/core"
import { boardOf } from "@pinetrie/rules"
import { type Level, markOf, type Status } from "./attention.ts"
import { count } from "./counts.ts"
import type { Intent } from "./intent.ts"
import type { KeyLike } from "./inventory-keys.ts"
import { NO_TEXT } from "./root-label.ts"
import { stepsIn } from "./root-target.ts"

/** A root on the board. */
export interface ThreadCard {
  readonly root: RootId
  readonly entry: EntryId
  readonly label: string
  /** What its mark draws (`rootStatus`), or null for none. */
  readonly status: Status | null
  /** An unsent card of yours is in it (`CardMarks.roots`). */
  readonly card: boolean
  /** Its threads with work ready to accept (`offeredByRoot`): ⇡, for everyone (ADR-0091). */
  readonly ready: readonly string[]
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
  readonly busy: RootWork | null
  readonly intent: Intent
}

/** An open state's column. */
export interface BoardColumnView {
  readonly state: WorkflowState
  /** The items the search keeps, in their order; every item with no search. */
  readonly items: readonly ThreadCard[]
  /** Every root in it, kept or not. Its mark, counts and `remove` count them all too. */
  readonly total: number
  /** Its highest mark (`markOf`). */
  readonly mark: Level | null
  /** Its items whose agent works (`Status` working, a pending verdict among them). */
  readonly working: number
  /** Its items with work ready to accept. */
  readonly ready: number
  /** ＋ here: a new root that lands in this state. */
  readonly add: { readonly agent: Intent; readonly conversation: Intent }
  /** One place left or right among the open states; null at an end. */
  readonly left: Intent | null
  readonly right: Intent | null
  /** Remove it, or why it cannot be removed (`removeWords`). */
  readonly remove: { readonly intent: Intent; readonly why: string | null }
}

/** The closed state: collapsed to its count and its rows. */
export interface ClosedView {
  readonly state: WorkflowState
  /** Every root in it, kept or not. */
  readonly total: number
  /** Its roots the search keeps: `rows` may be fewer. */
  readonly kept: number
  /** Those roots, newest first; the most recent few with no query (`closedRows`). */
  readonly rows: readonly ThreadCard[]
}

/** One state as the strip says it. */
export interface StripState {
  readonly id: WorkflowStateId
  readonly name: string
  readonly count: number
  readonly mark: Level | null
  /** Its column's `working` and `ready`; 0 for the closed state. */
  readonly working: number
  readonly ready: number
  /** Its roots: the strip's avatars are the people reading in them. */
  readonly roots: readonly EntryId[]
  readonly closed: boolean
}

export interface BoardView {
  readonly strip: readonly StripState[]
  readonly open: readonly BoardColumnView[]
  readonly closed: ClosedView
  /** The search keeps only some roots: each state says how many (`keptWords`). */
  readonly filtered: boolean
  /** Every root on the board: the search's placeholder counts them. */
  readonly total: number
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
  /** Each root's threads with an open offer (`offeredByRoot`). */
  readonly ready: ReadonlyMap<EntryId, readonly string[]>
  /** The board's search, and whether it keeps only roots you wrote in (`boardFilter`). */
  readonly query: string
  readonly mine: boolean
  readonly me: WriterId
  /** The agent's work in each root, held or not (`workAnywhere`): a root it works in is not closed. */
  readonly work: ReadonlyMap<string, RootWork>
}

export function boardView(input: BoardViewInput): BoardView {
  const { workflow } = input
  const board = boardOf(workflow, input.places, input.rootEntries.keys())
  const summaries = new Map(input.summaries.map(s => [s.root, s]))
  const keeps = boardFilter(input.query, input.mine, input.me)
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
  /** An item, without its Move up and Move down: those wait for `shown`. */
  const itemOf = (
    root: RootId,
    entry: EntryId,
    state: WorkflowStateId,
  ): ThreadCard => ({
    root,
    entry,
    label: input.labels.get(entry) ?? NO_TEXT,
    status: input.status.get(entry) ?? null,
    card: input.cardRoots.has(entry),
    ready: input.ready.get(entry) ?? [],
    writers: summaries.get(entry)?.writers ?? [],
    state,
    show: { kind: "show", here: { kind: "root", root: entry } },
    up: null,
    down: null,
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
  })
  /**
   * A state's items: every one, which its counts read, and those the search
   * keeps, which are drawn and so step among themselves (`stepsIn`).
   */
  const itemsOf = (column: {
    roots: readonly RootId[]
    state: WorkflowState
  }): { all: readonly ThreadCard[]; kept: readonly ThreadCard[] } => {
    const all = column.roots.flatMap(root => {
      const entry = input.rootEntries.get(root)
      return entry === undefined ? [] : [itemOf(root, entry, column.state.id)]
    })
    const kept = keeps === null ? all : all.filter(keeps)
    const shown = kept.map(t => t.root)
    return {
      all,
      kept: kept.map(t => {
        const steps = stepsIn(column.roots, t.root, shown)
        return {
          ...t,
          up:
            steps.up === null ? null : within(t.root, t.state, steps.up.before),
          down:
            steps.down === null
              ? null
              : within(t.root, t.state, steps.down.before),
        }
      }),
    }
  }
  // Each open column's view, and every root in it for the strip's readers.
  const columns = board.open.map((column, i) => {
    const { all: items, kept } = itemsOf(column)
    const { state } = column
    const before = (to: WorkflowStateId | null): Intent => ({
      kind: "editWorkflow",
      edit: { action: "move", state: state.id, name: "", before: to },
    })
    const next = board.open[i + 1]
    const afterNext = board.open[i + 2]
    const previous = board.open[i - 1]
    const view: BoardColumnView = {
      state,
      items: kept,
      total: items.length,
      mark: markOf(
        input.status,
        items.map(t => t.entry),
      ),
      working: items.filter(t => t.status?.kind === "working").length,
      ready: items.filter(t => t.ready.length > 0).length,
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
    return { view, roots: items.map(t => t.entry) }
  })
  const open = columns.map(c => c.view)
  const closedItems = itemsOf(board.closed)
  const closed: ClosedView = {
    state: board.closed.state,
    total: closedItems.all.length,
    kept: closedItems.kept.length,
    rows: closedRows({
      items: closedItems.kept,
      summaries,
      query: input.query,
    }),
  }
  const strip = [
    ...columns.map(
      ({ view: c, roots }): StripState => ({
        id: c.state.id,
        name: c.state.name,
        count: c.total,
        mark: c.mark,
        working: c.working,
        ready: c.ready,
        roots,
        closed: false,
      }),
    ),
    {
      id: closed.state.id,
      name: closed.state.name,
      count: closed.total,
      mark: null,
      working: 0,
      ready: 0,
      roots: [],
      closed: true,
    },
  ]
  return {
    strip,
    open,
    closed,
    filtered: keeps !== null,
    total: strip.reduce((n, s) => n + s.count, 0),
  }
}

/**
 * What the board's search keeps, or null when it keeps every root: the roots
 * whose label (`labelsOf`, so a title is found) holds every word of `query`,
 * case-insensitively and in any order, and with `mine`, those `me` wrote a
 * chat in. Labels, not messages: a search of every message would hold every
 * root's document (ADR-0063).
 */
export function boardFilter(
  query: string,
  mine: boolean,
  me: WriterId,
): ((root: Pick<ThreadCard, "label" | "writers">) => boolean) | null {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w !== "")
  if (words.length === 0 && !mine) return null
  return root => {
    const label = root.label.toLowerCase()
    return (
      (!mine || root.writers.includes(me)) &&
      words.every(w => label.includes(w))
    )
  }
}

/**
 * The closed state's rows, of the roots the search kept: newest activity
 * first, and with no query only the most recent few.
 */
export function closedRows(input: {
  readonly items: readonly ThreadCard[]
  readonly summaries: ReadonlyMap<EntryId, RootSummary>
  readonly query: string
}): readonly ThreadCard[] {
  const newest = (t: ThreadCard) => input.summaries.get(t.entry)?.newest ?? ""
  const sorted = input.items.toSorted((a, b) =>
    newest(a) < newest(b) ? 1 : newest(a) > newest(b) ? -1 : 0,
  )
  return input.query.trim() === "" ? sorted.slice(0, CLOSED_RECENT) : sorted
}

/** What a key does on the open board (`boardKeyAct`). */
export type BoardKey = "focusSearch" | "clearSearch" | "close"

/** Where focus is, and what is open, when a key is pressed on the open board. */
export interface BoardKeyFocus {
  /** A menu is open on the board: Escape is its (`Popover`). */
  readonly menuOpen: boolean
  readonly query: string
  /** Focus is in a text box, where `/` is typed. */
  readonly inText: boolean
}

/**
 * The open board's keys, or null for a key that is not one of them. Escape
 * clears a query before it closes the board. `/` focuses the search. Apart
 * from `keyAct`'s table: clearing a query and focusing a field are the
 * board's view state, not intents.
 */
export function boardKeyAct(
  event: KeyLike,
  focus: BoardKeyFocus,
): BoardKey | null {
  if (event.key === "Escape")
    return focus.menuOpen ? null : focus.query !== "" ? "clearSearch" : "close"
  const modifier = event.ctrlKey || event.metaKey || event.altKey
  if (event.key === "/" && !focus.inText && !modifier) return "focusSearch"
  return null
}

/** Why an open state cannot be removed, or null when it can (ADR-0112). */
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

/** A strip state's counts, as its titles say them (ADR-0091). */
export const stripWords = (
  state: Pick<StripState, "working" | "ready">,
): { readonly working: string; readonly ready: string } => ({
  working: `the agent is working in ${rootsWords(state.working)}`,
  ready: `${rootsWords(state.ready)} with work ready to accept`,
})

/** A thread card's ⇡: the threads it names. */
export const readyWords = (threads: readonly string[]): string =>
  `ready to accept: ${threads.join(", ")}`

/** A number of roots: a state's count's title. */
export const rootsWords = (n: number): string => count(n, "root", "roots")

/** A state's count in its head: "12 of 96" while the search keeps only some roots. */
export const keptWords = (
  kept: number,
  total: number,
  filtered: boolean,
): string => (filtered ? `${kept} of ${total}` : `${total}`)

/** The search's placeholder. */
export const searchWords = (total: number): string =>
  `search ${rootsWords(total)}…`
