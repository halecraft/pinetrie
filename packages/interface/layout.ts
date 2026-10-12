// interface/layout — which task you are on, the sidebar, and your view of
// each task's canvas.
//
// The task you are on shows its rail and its columns: one per card on its
// canvas, in the canvas's order (`canvasColumns`), which is everyone's. The
// sidebar is the tasks you have open, in your order: it is your own document,
// the same on every device (`openThreads`, `@pinetrie/session`), and comes in
// here as a fact, so the layout draws it but never stores it. The layout keeps
// your view of each task you have opened (`TaskView`: which columns are
// unfolded, how each is read, what a thread you opened starts with). A branch
// or a new tab is a thread card on its task's canvas from the moment it opens,
// so it is a column like any other, and a new tab is its own task. Which task
// you are on, the views and whether the board is open are this browser tab's
// view state, never written to the document; they are stored per browser tab in
// the form at the end of this file.

import {
  type CardId,
  type EntryId,
  isTaskId,
  type LaneView,
  parseCardId,
  pathIds,
  type TaskId,
  type ThreadId,
  type TreeIndex,
  threadAt,
  type WriterId,
} from "@pinetrie/core"
import type { CanvasCard, TaskIndex, ThreadOpening } from "@pinetrie/rules"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import type { Density } from "./ask-words.ts"
import {
  type CardView,
  canvasColumns,
  defaultView,
  openColumns,
  type Strip,
  stripOf,
  type TaskView,
  viewOf,
} from "./canvas-columns.ts"
import { projectColumns } from "./column-paths.ts"
import type { Pending, Prefill } from "./columns.ts"

/** What the stage shows: a task of the sidebar, or nothing. */
export type Here =
  | { readonly kind: "nothing" }
  | { readonly kind: "task"; readonly task: TaskId }

export const NOTHING: Here = { kind: "nothing" }

export interface Layout {
  /**
   * Null until it is chosen: a browser tab with nothing stored, before the
   * document settles. `prune` chooses; no action sets it back to null.
   */
  readonly active: Here | null
  /**
   * The sidebar as drawn: your open tasks in your order (`LayoutFacts.list`),
   * less the archived ones but the task you are on, and the task you are on
   * wherever the list lacks it. Derived by `resolveLayout`, never stored.
   */
  readonly open: readonly TaskId[]
  /**
   * Your view of each task you have changed one of (`TaskView`), kept when
   * it leaves the sidebar so opening it again brings it back. A task with
   * none is drawn as `defaultView` says.
   */
  readonly tasks: ReadonlyMap<TaskId, TaskView>
  /** Whether the board is open over the columns. */
  readonly board: boolean
}

/** A change to your view of one task (`TaskView`). */
export type ViewChange =
  /** Unfold a column, or fold it to a strip with its title. */
  | { readonly kind: "fold"; readonly card: CardId; readonly unfolded: boolean }
  /** Unfold the task column, or fold it. */
  | { readonly kind: "foldTask"; readonly unfolded: boolean }
  /** How much of each ask a column draws. */
  | {
      readonly kind: "density"
      readonly card: CardId
      readonly density: Density
    }
  /** Whether a thread's details are open under its header. */
  | { readonly kind: "details"; readonly card: CardId; readonly open: boolean }
  /**
   * A thread you opened: its column unfolded, with what it starts with, until
   * its first send.
   */
  | {
      readonly kind: "opened"
      readonly card: ThreadId
      /** A first message the column sends as soon as it opens. */
      readonly pending?: Pending
      /** What its composer starts with, unsent. */
      readonly prefill?: Prefill
      /** A Start Agent column: its first message with no mention asks the agent. */
      readonly asksAgent?: true
    }
  /** A thread you opened sent its first message: what it started with is spent. */
  | { readonly kind: "sent"; readonly card: ThreadId }

export type LayoutAction =
  | { readonly kind: "show"; readonly here: Here }
  /**
   * A task leaves the sidebar (its document is written apart): if you are on
   * it, show its neighbour. Your view of it is kept.
   */
  | { readonly kind: "closeTask"; readonly task: TaskId }
  /**
   * A change to your view of `task`. `first` is its canvas's first card,
   * which a view made by this change starts with unfolded (`defaultView`).
   */
  | {
      readonly kind: "view"
      readonly task: TaskId
      readonly first: CardId | null
      readonly change: ViewChange
    }
  /** Open or close the board. */
  | { readonly kind: "board"; readonly open: boolean }
  /** Store what `resolveLayout` draws for these facts. */
  | ({ readonly kind: "resolve" } & LayoutFacts)
  /** Once, after the documents settle: the tasks the session lacks go, and `active` is chosen. */
  | ({
      readonly kind: "prune"
      /** Every task the session holds. */
      readonly known: ReadonlySet<TaskId>
    } & LayoutFacts)

/** What a task's columns are drawn from: its canvas and the tree, one moment's. */
export interface CanvasFacts {
  /** Each task's canvas, in order (`TaskIndex.canvases`). */
  readonly canvases: ReadonlyMap<TaskId, readonly CanvasCard[]>
  /** Each thread opened and not yet started (`unstartedThreads`). */
  readonly unstarted: ReadonlyMap<ThreadId, ThreadOpening>
  /** Each thread someone else holds, by its holder (`heldByOthers`). */
  readonly holders: ReadonlyMap<ThreadId, WriterId>
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
}

/** The document facts a layout follows: one moment's, read together. */
export interface LayoutFacts extends CanvasFacts {
  /** The tasks in the archive. */
  readonly archived: ReadonlySet<TaskId>
  /** The sidebar (`openThreads`). */
  readonly list: readonly TaskId[]
}

export const initialLayout = (): Layout => ({
  active: null,
  open: [],
  tasks: new Map(),
  board: false,
})

export const sameHere = (a: Here | null, b: Here): boolean =>
  a !== null &&
  a.kind === b.kind &&
  (a.kind !== "task" || b.kind !== "task" || a.task === b.task)

/** `views` with `task`'s view as `view`. */
const withView = (
  views: ReadonlyMap<TaskId, TaskView>,
  task: TaskId,
  view: TaskView,
): ReadonlyMap<TaskId, TaskView> => new Map(views).set(task, view)

/** `view` with the card `card`'s view changed by `change`. */
const withCard = (
  view: TaskView,
  card: CardId,
  change: (seen: CardView) => CardView,
): TaskView => {
  const was = view.cards.get(card) ?? {}
  const next = change(was)
  if (sameCardView(was, next)) return view
  const cards = new Map(view.cards)
  if (Object.keys(next).length === 0) cards.delete(card)
  else cards.set(card, next)
  return { ...view, cards }
}

const sameCardView = (a: CardView, b: CardView): boolean =>
  a.unfolded === b.unfolded &&
  a.density === b.density &&
  a.details === b.details &&
  a.pending === b.pending &&
  a.prefill === b.prefill &&
  a.asksAgent === b.asksAgent

/** `seen` with `key` set to `value`, or left out for undefined. */
const set = <K extends keyof CardView>(
  seen: CardView,
  key: K,
  value: CardView[K] | undefined,
): CardView => {
  const { [key]: _, ...rest } = seen
  return value === undefined ? rest : { ...rest, [key]: value }
}

/** `view` changed by `change`; the same view when nothing changes. */
export function changeView(view: TaskView, change: ViewChange): TaskView {
  switch (change.kind) {
    case "fold":
      return withCard(view, change.card, c =>
        set(c, "unfolded", change.unfolded ? true : undefined),
      )
    case "foldTask":
      return view.task.unfolded === change.unfolded
        ? view
        : { ...view, task: { unfolded: change.unfolded } }
    case "density":
      return withCard(view, change.card, c => set(c, "density", change.density))
    case "details":
      return withCard(view, change.card, c =>
        set(c, "details", change.open ? true : undefined),
      )
    case "opened":
      return withCard(view, change.card, c => ({
        ...set(
          set(set(c, "pending", change.pending), "prefill", change.prefill),
          "asksAgent",
          change.asksAgent,
        ),
        unfolded: true,
      }))
    case "sent":
      return withCard(view, change.card, c =>
        set(set(c, "pending", undefined), "prefill", undefined),
      )
  }
}

/**
 * The sidebar as drawn: the archived tasks leave it, but the task you are on,
 * which stays where it is, or comes at the end where the list lacks it:
 * another device's repair may have taken it out (`planOpenRepair`).
 */
function drawnList(
  list: readonly TaskId[],
  archived: ReadonlySet<TaskId>,
  active: Here | null,
): readonly TaskId[] {
  const here = active?.kind === "task" ? active.task : null
  const kept = list.filter(t => !archived.has(t) || t === here)
  return here === null || kept.includes(here) ? kept : [...kept, here]
}

const sameList = (a: readonly TaskId[], b: readonly TaskId[]): boolean =>
  a.length === b.length && a.every((t, i) => b[i] === t)

/**
 * What to show once `closed` is closed: its neighbour below in the sidebar,
 * else above, else nothing. `layout` is before the close.
 */
export function afterClosing(layout: Layout, closed: Here): Here {
  const items = listOf(layout)
  const at = items.findIndex(t => sameHere(t, closed))
  const next = items[at + 1] ?? items[at - 1]
  return at < 0 || next === undefined ? NOTHING : next
}

/**
 * Whether `action` shows something in the stage: a task or the board. A
 * page over the stage is left for it.
 */
export function showsStage(action: LayoutAction): boolean {
  switch (action.kind) {
    case "show":
      return true
    case "board":
      return action.open
    default:
      return false
  }
}

export function layoutReducer(state: Layout, action: LayoutAction): Layout {
  switch (action.kind) {
    // Choosing what to work in closes the board, which lay over it.
    case "show": {
      const board = action.here.kind === "nothing" && state.board
      return sameHere(state.active, action.here) && board === state.board
        ? state
        : { ...state, active: action.here, board }
    }
    case "closeTask": {
      const here: Here = { kind: "task", task: action.task }
      if (!sameHere(state.active, here)) return state
      return { ...state, active: afterClosing(state, here) }
    }
    case "view": {
      const before = state.tasks.get(action.task) ?? defaultView(action.first)
      const after = changeView(before, action.change)
      return after === before && state.tasks.has(action.task)
        ? state
        : { ...state, tasks: withView(state.tasks, action.task, after) }
    }
    case "board":
      return state.board === action.open
        ? state
        : { ...state, board: action.open }
    case "resolve":
      return resolveLayout(state, action)
    case "prune":
      return pruneLayout(state, action, action.known)
  }
}

/**
 * The layout to draw: `stored` brought up to `facts`. `App` draws this in the
 * render that reads the facts, and stores it after, so no render pairs new
 * entries with an old anchor. The sidebar is the facts' (`drawnList`).
 * Returns `stored` itself when nothing changes.
 */
export function resolveLayout(stored: Layout, facts: LayoutFacts): Layout {
  const open = drawnList(facts.list, facts.archived, stored.active)
  return sameList(open, stored.open) ? stored : { ...stored, open }
}

/**
 * Once the documents have settled: tasks the session lacks go (`known`), and
 * what to show is chosen. The view of a card no longer on the canvas goes
 * as the layout is stored (`storedLayout`). A task you were on that is
 * gone or archived gives way to the last task of the sidebar, else nothing,
 * and with nothing the board opens: nothing opens a task by itself.
 */
function pruneLayout(
  state: Layout,
  facts: LayoutFacts,
  known: ReadonlySet<TaskId>,
): Layout {
  let tasks = state.tasks
  for (const task of state.tasks.keys()) {
    if (known.has(task)) continue
    const next = new Map(tasks)
    next.delete(task)
    tasks = next
  }
  const list = facts.list.filter(t => known.has(t) && !facts.archived.has(t))
  const active = state.active
  // An archived task you were on is left at a reload.
  const stays =
    active !== null &&
    (active.kind === "nothing" ||
      (active.kind === "task" &&
        known.has(active.task) &&
        !facts.archived.has(active.task)))
  if (tasks === state.tasks && stays) return state
  const last = list.at(-1)
  const fallback: Here =
    last === undefined ? NOTHING : { kind: "task", task: last }
  const shown = stays ? active : fallback
  return {
    ...state,
    tasks,
    active: shown,
    board: state.board || shown.kind === "nothing",
  }
}

/**
 * `layout` as it is stored: without the view of a card not on its task's
 * canvas. Only a task whose canvas holds a card is read: an empty one may not
 * have arrived. The same layout when nothing goes.
 */
export function storedLayout(
  layout: Layout,
  canvases: ReadonlyMap<TaskId, readonly CanvasCard[]>,
): Layout {
  let tasks = layout.tasks
  for (const [task, view] of layout.tasks) {
    const canvas = canvases.get(task) ?? []
    if (canvas.length === 0) continue
    const cards = new Map(
      [...view.cards].filter(([card]) => canvas.some(c => c.id === card)),
    )
    if (cards.size !== view.cards.size)
      tasks = withView(tasks, task, { ...view, cards })
  }
  return tasks === layout.tasks ? layout : { ...layout, tasks }
}

/**
 * The sidebar as drawn: what the sidebar shows. An archived task you are on
 * is still in `open` (`resolveLayout` keeps it), so it keeps its place.
 */
export function listOf(
  layout: Layout,
): readonly Extract<Here, { kind: "task" }>[] {
  return layout.open.map(task => ({ kind: "task", task }) as const)
}

/**
 * The tasks among `tasks` not in the sidebar and not archived: what ▦ marks for
 * them. An archived task's work is done, so it marks only its own row on the
 * board.
 */
export const unlisted = (
  layout: Pick<Layout, "open">,
  archived: ReadonlySet<TaskId>,
  tasks: Iterable<TaskId>,
): readonly TaskId[] =>
  [...tasks].filter(t => !layout.open.includes(t) && !archived.has(t))

/**
 * A task's columns as drawn (`canvasColumns`), from your view of it, or the
 * default one (`defaultView`).
 */
export const taskColumns = (
  layout: Pick<Layout, "tasks">,
  task: TaskId,
  facts: CanvasFacts,
) => {
  const canvas = facts.canvases.get(task) ?? []
  return canvasColumns({
    canvas,
    view: viewOf(layout.tasks, task, canvas),
    index: facts.index,
    lanes: facts.lanes,
    unstarted: facts.unstarted,
    holders: facts.holders,
  })
}

/** A task's strip as drawn: its task column, then its columns (`taskColumns`). */
export const taskStrip = (
  layout: Pick<Layout, "tasks">,
  task: TaskId,
  facts: CanvasFacts,
): Strip =>
  stripOf(
    task,
    viewOf(layout.tasks, task, facts.canvases.get(task) ?? []),
    taskColumns(layout, task, facts),
  )

/** What showing an entry means, for the shell to carry out. */
export type OpenPlan =
  /** Column `key` of `task` already shows it: show the task and scroll there. */
  | { readonly kind: "scroll"; readonly task: TaskId; readonly key: string }
  /** Show `task`, unfold its thread's card `card`, and scroll there. */
  | {
      readonly kind: "unfold"
      readonly task: TaskId
      readonly card: ThreadId
    }

/**
 * Show entry `id`, wherever it is, in the task its thread is in
 * (`threadAt`, then `taskOfThread`): an archived task opens as any other,
 * read only (`appView`). A message on a shared stretch of paths is drawn
 * once, in the leftmost unfolded column showing it, so every such column's
 * path is searched; with none, its thread's own column is unfolded. Null
 * for an entry the index lacks, or one in no task.
 */
export function planOpen(
  layout: Layout,
  index: TreeIndex,
  id: EntryId,
  tasks: Pick<TaskIndex, "taskOfThread" | "canvases">,
  lanes: readonly LaneView[],
  holders: ReadonlyMap<ThreadId, WriterId>,
): OpenPlan | null {
  const thread = threadAt(index, id)
  if (thread === null || index.entries[id] === undefined) return null
  const task = tasks.taskOfThread.get(thread)
  if (task === undefined) return null
  const columns = openColumns(
    taskColumns(layout, task, {
      canvases: tasks.canvases,
      // An entry shown is in a started thread.
      unstarted: new Map(),
      holders,
      index,
      lanes,
    }),
  )
  const views = projectColumns(
    index,
    columns.map(c => ({ anchor: c.anchor })),
  )
  const showing = views.findIndex(
    v => v.tipId !== null && pathIds(index, v.tipId).has(id),
  )
  const key = columns[showing]?.key
  if (key !== undefined) return { kind: "scroll", task, key }
  return { kind: "unfold", task, card: thread }
}

// ── stored form ────────────────────────────────────────────────
//
// Kept per browser tab through `tab-state.ts`. Built field by field both ways,
// so a field the schema does not name is never stored or restored. A thread
// you opened keeps its `prefill` and Start Agent; its `pending` is not
// kept: restoring it would send its message again. The reader's settings,
// `density` and `details`, are kept so a reload shows the column as it was
// left.

const StoredDensity = Type.Union([
  Type.Literal("outline"),
  Type.Literal("story"),
  Type.Literal("raw"),
])

const StoredPrefill = Type.Object({
  text: Type.String(),
  blank: Type.Boolean(),
})

const StoredCardView = Type.Object({
  unfolded: Type.Optional(Type.Literal(true)),
  density: Type.Optional(StoredDensity),
  details: Type.Optional(Type.Literal(true)),
  prefill: Type.Optional(StoredPrefill),
  asksAgent: Type.Optional(Type.Literal(true)),
})

/** A task's view as stored: records by id, so no order can be kept. */
const StoredTaskView = Type.Object({
  cards: Type.Record(Type.String(), StoredCardView),
  task: Type.Object({ unfolded: Type.Boolean() }),
})

const StoredHere = Type.Union([
  Type.Object({ kind: Type.Literal("nothing") }),
  Type.Object({ kind: Type.Literal("task"), task: Type.String() }),
])

/**
 * `v` changes when the shape does; an older layout is dropped, not migrated.
 * `v: 9`: a thread you opened is a card, so no task view keeps branches of its
 * own, and no new tab is kept apart from its task.
 */
const StoredLayout = Type.Object({
  v: Type.Literal(9),
  active: Type.Union([StoredHere, Type.Null()]),
  tasks: Type.Record(Type.String(), StoredTaskView),
  board: Type.Boolean(),
})

const storedPrefill = (p: Prefill) => ({ text: p.text, blank: p.blank })

const toStoredView = (view: TaskView): Static<typeof StoredTaskView> => ({
  cards: Object.fromEntries(
    [...view.cards].map(([card, v]) => [
      card,
      {
        ...(v.unfolded ? { unfolded: true } : {}),
        ...(v.density === undefined ? {} : { density: v.density }),
        ...(v.details ? { details: true } : {}),
        ...(v.prefill === undefined
          ? {}
          : { prefill: storedPrefill(v.prefill) }),
        ...(v.asksAgent ? { asksAgent: true } : {}),
      },
    ]),
  ),
  task: { unfolded: view.task.unfolded },
})

/** A stored task view, or undefined when a key is no card's. */
const fromStoredView = (
  s: Static<typeof StoredTaskView>,
): TaskView | undefined => {
  const cards = new Map<CardId, CardView>()
  for (const [key, v] of Object.entries(s.cards)) {
    const card = parseCardId(key)
    if (card === undefined) return undefined
    cards.set(card, {
      ...(v.unfolded ? { unfolded: true } : {}),
      ...(v.density === undefined ? {} : { density: v.density }),
      ...(v.details ? { details: true } : {}),
      ...(v.prefill === undefined ? {} : { prefill: storedPrefill(v.prefill) }),
      ...(v.asksAgent ? { asksAgent: true } : {}),
    })
  }
  return { cards, task: { unfolded: s.task.unfolded } }
}

export const encodeLayout = (layout: Layout): Static<typeof StoredLayout> => ({
  v: 9,
  active: layout.active,
  tasks: Object.fromEntries(
    [...layout.tasks].map(([task, view]) => [task, toStoredView(view)]),
  ),
  board: layout.board,
})

/**
 * A stored layout, whole or not at all: only this build writes it, so a
 * half-valid one is not worth keeping. Total.
 */
export function decodeLayout(raw: unknown): Layout | undefined {
  if (!Value.Check(StoredLayout, raw)) return undefined
  const tasks = new Map<TaskId, TaskView>()
  for (const [task, stored] of Object.entries(raw.tasks)) {
    const view = fromStoredView(stored)
    if (view === undefined || !isTaskId(task)) return undefined
    tasks.set(task, view)
  }
  const { active } = raw
  if (active?.kind === "task" && !isTaskId(active.task)) return undefined
  return {
    active:
      active?.kind === "task"
        ? { kind: "task", task: active.task as TaskId }
        : active,
    open: [],
    tasks,
    board: raw.board,
  }
}
