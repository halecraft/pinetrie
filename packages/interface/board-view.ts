// interface/board-view — what the board shows and offers, decided; `Board`
// and `BoardStrip` (`board.tsx`) draw it.

import type {
  CanvasId,
  CardRecord,
  WorkflowStateId,
  WriterId,
} from "@pinetrie/core"
import { taskBoard, type Workflow, type WorkflowState } from "@pinetrie/rules"
import { type Level, markLevel } from "./attention.ts"
import { count } from "./counts.ts"
import type { Intent } from "./intent.ts"
import type { KeyLike } from "./page-keys.ts"
import { type CanvasSummary, NO_TEXT } from "./root-label.ts"
import { stepsIn } from "./root-target.ts"
import { newCanvasButton, type StartButton } from "./start-button.ts"
import type { ThreadCardHead } from "./thread-card.ts"

/**
 * A canvas on the board, its card: its header, the one the
 * sidebar draws too (`ThreadCardHead`), spread here and kept whole as
 * `head`, with what only the board adds.
 */
export interface ThreadCard extends Omit<ThreadCardHead, "state"> {
  readonly head: ThreadCardHead
  /** The state it is in: what its drag carries. */
  readonly state: WorkflowStateId
  /** Everyone who wrote a chat in it (`CanvasSummary.writers`). */
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
  /** Its canvases the agent works in (`Status` working, a pending run-end report among them): ◌. */
  readonly working: number
  /** Its canvases with changes ready to accept: ⇡. */
  readonly ready: number
  /** The canvases whose readers' avatars it shows. */
  readonly canvases: readonly CanvasId[]
}

/** The archive's: it shows none. */
const NO_SIGNALS: StateSignals = { working: 0, ready: 0, canvases: [] }

/** An open state's column. */
export interface BoardColumnView {
  readonly state: WorkflowState
  /** The cards of the roots the search keeps, in their order. */
  readonly items: readonly ThreadCard[]
  readonly count: Count
  /** Its highest mark over every root, kept or not (`markLevel`): a filter hides no warning. */
  readonly mark: Level | null
  /** Over the roots the search keeps, as its cards show them. */
  readonly signals: StateSignals
  /** ＋ canvas here: a new canvas that lands in this state. */
  readonly add: StartButton
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

export interface BoardViewInput {
  readonly workflow: Workflow
  /** Every card: the board's are each canvas's. */
  readonly cards: readonly CardRecord[]
  /** Each canvas with a message (`taskSummaries`): its first line is a titled card's body. */
  readonly summaries: ReadonlyMap<CanvasId, CanvasSummary>
  /** Each canvas's thread card header (`threadCardHeads`), which the sidebar reads too. */
  readonly heads: ReadonlyMap<CanvasId, ThreadCardHead>
  /** The board's filter (`parseSearch`), or null for none. */
  readonly search: BoardSearch | null
  readonly me: WriterId
}

/** A card's body: its first line, when its label is a title that says something else. */
const bodyOf = (label: string, line: string | undefined): string | null =>
  line === undefined || line === "" || line === label ? null : line

/**
 * The board as drawn: each canvas with a message (`summaries`), so a new
 * tab's canvas joins it with its first send.
 */
export function boardView(input: BoardViewInput): BoardView {
  const { workflow, search, summaries } = input
  const board = taskBoard(workflow, input.cards)
  const keeps = search === null ? null : boardFilter(search, input.me)
  const headOf = (canvas: CanvasId): ThreadCardHead =>
    input.heads.get(canvas) ?? {
      canvas,
      label: NO_TEXT,
      status: null,
      ready: [],
      pip: false,
      state: null,
      moves: [],
    }
  const writersOf = (canvas: CanvasId) => summaries.get(canvas)?.writers ?? []
  /** A move within `state`, before `before` there, or to its end. */
  const within = (
    canvas: CanvasId,
    state: WorkflowStateId,
    before: CanvasId | null,
  ): Intent => ({
    kind: "moveCanvas",
    canvas,
    from: state,
    to: state,
    before,
    closes: false,
  })
  /** The signals of `canvases`, from each one's status and proposed changes. */
  const stateSignals = (canvases: readonly CanvasId[]): StateSignals => ({
    working: canvases.filter(t => headOf(t).status?.kind === "working").length,
    ready: canvases.filter(t => headOf(t).ready.length > 0).length,
    canvases,
  })
  const status = new Map(
    [...input.heads.values()].flatMap(head =>
      head.status === null ? [] : [[head.canvas, head.status] as const],
    ),
  )
  /** A kept canvas's card, whose Move up and Move down step among the canvases `isShown` keeps. */
  const cardOf = (
    canvas: CanvasId,
    state: WorkflowStateId,
    column: readonly CanvasId[],
    isShown: (canvas: CanvasId) => boolean,
  ): ThreadCard => {
    const steps = stepsIn(column, canvas, isShown)
    const head = headOf(canvas)
    return {
      ...head,
      head,
      state,
      writers: writersOf(canvas),
      body: bodyOf(head.label, summaries.get(canvas)?.line),
      show: { kind: "show", here: { kind: "canvas", canvas } },
      up: steps.up === null ? null : within(canvas, state, steps.up.before),
      down:
        steps.down === null ? null : within(canvas, state, steps.down.before),
    }
  }
  /**
   * A state's canvases: every one with a message, which its mark, Remove and
   * the strip count, and a card for each the search keeps, which is drawn.
   */
  const stateCanvases = (column: {
    canvases: readonly CanvasId[]
    state: WorkflowState
  }): {
    all: readonly CanvasId[]
    cards: readonly ThreadCard[]
    count: Count
  } => {
    const all = column.canvases.filter(canvas => summaries.has(canvas))
    const kept =
      keeps === null
        ? all
        : all.filter(canvas =>
            keeps({ label: headOf(canvas).label, writers: writersOf(canvas) }),
          )
    const shown = new Set(kept)
    return {
      all,
      cards: kept.map(canvas =>
        cardOf(canvas, column.state.id, column.canvases, t => shown.has(t)),
      ),
      count:
        keeps === null
          ? { kind: "all", total: all.length }
          : { kind: "kept", kept: kept.length, total: all.length },
    }
  }
  const columns = board.open.map((column, i) => {
    const { all, cards, count } = stateCanvases(column)
    const { state } = column
    const before = (to: WorkflowStateId | null): Intent => ({
      kind: "editWorkflow",
      edit: { action: "move", state: state.id, name: "", before: to },
    })
    const next = board.open[i + 1]
    const afterNext = board.open[i + 2]
    const previous = board.open[i - 1]
    const mark = markLevel(status, all)
    const view: BoardColumnView = {
      state,
      items: cards,
      count,
      mark,
      signals: stateSignals(cards.map(t => t.canvas)),
      add: newCanvasButton({ from: "board", landsIn: state }),
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
  const archiveRoots = stateCanvases(board.archive)
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

/** A link to an address, `[label](/a/…)`, as its label alone. */
const ADDRESS_LINK = /\[([^\]]*)\]\(\/a\/[^)\s]*\)/g

/**
 * A label as search reads it: a link to an address by its label, never its
 * address, which names ids nobody types.
 */
export const searchedText = (label: string): string =>
  label.replace(ADDRESS_LINK, "$1")

/**
 * What `search` keeps: the canvases whose label (`taskLabels`, so a title is
 * found) holds every word, in any order, and with `mine`, those `me` wrote a
 * chat in. Labels, not messages: a search of every message would hold every
 * root's document.
 */
function boardFilter(
  search: BoardSearch,
  me: WriterId,
): (root: Pick<ThreadCard, "label" | "writers">) => boolean {
  return root => {
    const label = searchedText(root.label).toLowerCase()
    return (
      (!search.mine || root.writers.includes(me)) &&
      search.words.every(w => label.includes(w))
    )
  }
}

/**
 * The archive's rows, of the canvases the search kept: newest activity
 * first, and with no words to search (none, or "mine" alone) only the most
 * recent few.
 */
export function archiveRows(input: {
  readonly items: readonly ThreadCard[]
  readonly summaries: ReadonlyMap<CanvasId, CanvasSummary>
  readonly search: BoardSearch | null
}): readonly ThreadCard[] {
  const newest = (t: ThreadCard) => input.summaries.get(t.canvas)?.newest ?? ""
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

/** Why an open state cannot be removed, or null when it can. */
export function removeWords(
  canvases: number,
  openStates: number,
): string | null {
  if (canvases > 0)
    return `holds ${canvases === 1 ? "a canvas" : `${canvases} canvases`}: move ${canvases === 1 ? "it" : "them"} first`
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

/** A state's ◌ and ⇡, as their titles say them, in the strip and in a column's head. */
export const stateWords = (
  signals: Pick<StateSignals, "working" | "ready">,
): { readonly working: string; readonly ready: string } => ({
  working: `the agent is working in ${canvasesWords(signals.working)}`,
  ready: `${canvasesWords(signals.ready)} with changes ready to accept`,
})

/** A thread card's ⇡: the threads it names. */
export const readyWords = (threads: readonly string[]): string =>
  `ready to accept: ${threads.join(", ")}`

/** A number of canvases: a state's count's title, and the filter's. */
export const canvasesWords = (n: number): string =>
  count(n, "canvas", "canvases")

/** A state's count in its head: "12 of 96" while a filter keeps some of its canvases. */
export const keptWords = (count: Count): string =>
  count.kind === "kept" ? `${count.kept} of ${count.total}` : `${count.total}`

/** The search's placeholder. */
export const searchWords = (total: number): string =>
  `search ${canvasesWords(total)}…`

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
      ? `No canvases${search.mine ? " you wrote in" : ""} match ${quoted(search)}`
      : `You wrote in none of ${canvasesWords(total)}`
  const of = `${kept} of ${canvasesWords(total)}`
  if (!words) return `Filtered to canvases you wrote in: ${of}`
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
