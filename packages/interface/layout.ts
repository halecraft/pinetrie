// interface/layout — which task you are on, the sidebar, and your view of
// each task's canvas (ADR-0029, ADR-0030, ADR-0122, ADR-0116).
//
// The task you are on shows its rail and its columns: one per card on its
// canvas, in the canvas's order (`canvasColumns`), which is everyone's. The
// sidebar is the tasks you have open, in your order: it is your own
// document, the same on every device (`openThreads`, `@pinetrie/session`),
// and comes in here as a fact, so the layout draws it but never stores it.
// The layout keeps your view of each task you have opened (`TaskView`:
// which columns are unfolded, how each is read, branches not yet sent), and
// new tabs: each one fresh column at the root, in a task of its own that
// joins the sidebar once its first message is written. Which task you are
// on, the views, the new tabs and whether the board is open are this
// browser tab's view state, never written to the document; they are stored
// per browser tab (ADR-0027) in the form at the end of this file. Pure.

import {
  type CardId,
  type EntryId,
  entryId,
  isTaskId,
  isThreadId,
  isWorkflowStateId,
  type LaneView,
  parseCardId,
  parseNewRoot,
  parseNewTask,
  pathIds,
  type RootId,
  type TaskId,
  THREAD_PATTERN,
  type ThreadId,
  type TreeIndex,
  threadAt,
  type WorkflowStateId,
} from "@pinetrie/core"
import type { CanvasCard, TaskIndex } from "@pinetrie/rules"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import type { Density } from "./ask-words.ts"
import {
  type CardView,
  canvasColumns,
  defaultView,
  type FreshColumn,
  openColumns,
  type Strip,
  stripOf,
  type TaskView,
  viewOf,
} from "./canvas-columns.ts"
import { projectColumns } from "./column-paths.ts"
import {
  type Column,
  type NewTabAction,
  newTabReducer,
  type Pending,
  type Prefill,
} from "./columns.ts"

/** What the workspace shows: a task of the sidebar, a new tab, or nothing. */
export type Here =
  | { readonly kind: "nothing" }
  | { readonly kind: "task"; readonly task: TaskId }
  | { readonly kind: "new"; readonly key: string }

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
  /**
   * New tabs: each one fresh column at the root, local until its first
   * message is written and its thread's card is on its task's canvas. Its
   * key is the thread it minted, as the card's id will be, so the column
   * stays mounted as it becomes its task's.
   */
  readonly newTabs: readonly Column[]
  /** Whether the board is open over the columns (ADR-0122). */
  readonly board: boolean
}

/** A change to your view of one task (`TaskView`). */
export type ViewChange =
  /** Unfold a column, or fold it to a strip with its title. */
  | { readonly kind: "fold"; readonly card: CardId; readonly unfolded: boolean }
  /** Unfold the task column, or fold it. */
  | { readonly kind: "foldTask"; readonly unfolded: boolean }
  /** How much of each ask a column draws (ADR-0106). */
  | {
      readonly kind: "density"
      readonly card: CardId
      readonly density: Density
    }
  /** Whether a thread's details are open under its header (ADR-0073). */
  | { readonly kind: "details"; readonly card: CardId; readonly open: boolean }
  /** Open a branch at `at`, its first send to start `thread`. */
  | {
      readonly kind: "openFresh"
      readonly thread: ThreadId
      readonly at: EntryId
      /** A first message the column sends as soon as it opens. */
      readonly pending?: Pending
      /** What its composer starts with, unsent. */
      readonly prefill?: Prefill
    }
  /** A branch sent its first message, as send `sendId`. */
  | {
      readonly kind: "sent"
      readonly thread: ThreadId
      readonly sendId: string
    }
  /** Close a branch not yet sent; nothing was written. */
  | { readonly kind: "closeFresh"; readonly thread: ThreadId }

export type LayoutAction =
  | { readonly kind: "show"; readonly here: Here }
  | {
      readonly kind: "newTab"
      /** Its key: the thread it minted (`Layout.newTabs`). */
      readonly key: ThreadId
      /** Its root, minted with its key (ADR-0066). */
      readonly root: RootId
      /** Its task, minted with its key (ADR-0116). */
      readonly task: TaskId
      readonly asksAgent: boolean
      /** What its composer starts with. */
      readonly prefill?: Prefill
      /** The workflow state its task lands in: the board column it was opened from. */
      readonly state?: WorkflowStateId
    }
  /** Close an unsent new tab; nothing was written. */
  | { readonly kind: "closeNewTab"; readonly key: string }
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
  /**
   * A column action on new tab `key`'s one column: its first send, or a
   * reader's setting (`ReaderAction`).
   */
  | {
      readonly kind: "newTabColumn"
      readonly key: string
      readonly action: Exclude<NewTabAction, { kind: "sync" }>
    }
  /** Open or close the board. */
  | { readonly kind: "board"; readonly open: boolean }
  /** Store what `resolveLayout` draws for these facts. */
  | ({ readonly kind: "resolve" } & LayoutFacts)
  /** Once, after the documents settle: the tasks the session lacks go, and `active` is chosen. */
  | ({
      readonly kind: "prune"
      /** Every task the session holds (ADR-0116). */
      readonly known: ReadonlySet<TaskId>
    } & LayoutFacts)

/** What a task's columns are drawn from: its canvas and the tree, one moment's. */
export interface CanvasFacts {
  /** Each task's canvas, in order (`TaskIndex.canvases`). */
  readonly canvases: ReadonlyMap<TaskId, readonly CanvasCard[]>
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
}

/** The document facts a layout follows: one moment's, read together. */
export interface LayoutFacts extends CanvasFacts {
  /** The tasks in the archive (ADR-0122). */
  readonly archived: ReadonlySet<TaskId>
  /** The sidebar (`openThreads`). */
  readonly list: readonly TaskId[]
}

export const initialLayout = (): Layout => ({
  active: null,
  open: [],
  tasks: new Map(),
  newTabs: [],
  board: false,
})

/**
 * Where a column is, by its key: a new tab's, or a task's branch not yet
 * sent, whether or not that task is in the sidebar. Undefined for any other
 * key: a column on a canvas is found by its card.
 */
export function hereOfColumn(layout: Layout, key: string): Here | undefined {
  if (layout.newTabs.some(c => c.key === key)) return { kind: "new", key }
  for (const [task, view] of layout.tasks)
    for (const thread of view.fresh.keys())
      if (thread === key) return { kind: "task", task }
  return undefined
}

export const sameHere = (a: Here | null, b: Here): boolean =>
  a !== null &&
  a.kind === b.kind &&
  (a.kind !== "task" || b.kind !== "task" || a.task === b.task) &&
  (a.kind !== "new" || b.kind !== "new" || a.key === b.key)

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
  a.details === b.details

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
    case "openFresh":
      return {
        ...view,
        fresh: new Map(view.fresh).set(change.thread, {
          at: change.at,
          ...(change.pending === undefined ? {} : { pending: change.pending }),
          ...(change.prefill === undefined ? {} : { prefill: change.prefill }),
        }),
      }
    case "sent": {
      const fresh = view.fresh.get(change.thread)
      if (fresh === undefined) return view
      // Sent: its prefill and pending message are spent.
      return {
        ...view,
        fresh: new Map(view.fresh).set(change.thread, {
          at: fresh.at,
          sendId: change.sendId,
        }),
      }
    }
    case "closeFresh": {
      if (!view.fresh.has(change.thread)) return view
      const fresh = new Map(view.fresh)
      fresh.delete(change.thread)
      return { ...view, fresh }
    }
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
 * else above, else nothing. `layout` is before the close. Pure.
 */
export function afterClosing(layout: Layout, closed: Here): Here {
  const items = listOf(layout)
  const at = items.findIndex(t => sameHere(t, closed))
  const next = items[at + 1] ?? items[at - 1]
  return at < 0 || next === undefined ? NOTHING : next
}

/**
 * Whether `action` shows something in the workspace: a task, a new tab or
 * the board. A page over the workspace (ADR-0098) is left for it.
 */
export function showsWorkspace(action: LayoutAction): boolean {
  switch (action.kind) {
    case "show":
    case "newTab":
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
    case "newTab":
      return {
        ...state,
        board: false,
        active: { kind: "new", key: action.key },
        newTabs: [
          ...state.newTabs,
          {
            key: action.key,
            anchor: null,
            thread: action.key,
            fresh: {
              root: action.root,
              task: action.task,
              ...(action.prefill === undefined
                ? {}
                : { prefill: action.prefill }),
              ...(action.state === undefined ? {} : { state: action.state }),
            },
            ...(action.asksAgent ? { asksAgent: true } : {}),
          },
        ],
      }
    case "closeNewTab": {
      const here: Here = { kind: "new", key: action.key }
      return {
        ...state,
        newTabs: state.newTabs.filter(c => c.key !== action.key),
        active: sameHere(state.active, here)
          ? afterClosing(state, here)
          : state.active,
      }
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
    case "newTabColumn":
      return {
        ...state,
        newTabs: state.newTabs.map(c =>
          c.key === action.key ? newTabReducer(c, action.action) : c,
        ),
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
 * entries with an old anchor (S35). The sidebar is the facts' (`drawnList`).
 * Returns `stored` itself when nothing changes.
 */
export function resolveLayout(stored: Layout, facts: LayoutFacts): Layout {
  const synced = syncLayout(stored, facts)
  const open = drawnList(facts.list, facts.archived, synced.active)
  return sameList(open, synced.open) ? synced : { ...synced, open }
}

/** The task whose canvas holds `card`, if any. */
const taskOnCanvas = (
  canvases: ReadonlyMap<TaskId, readonly CanvasCard[]>,
  card: CardId,
): TaskId | undefined => {
  for (const [task, canvas] of canvases)
    if (canvas.some(c => c.id === card)) return task
  return undefined
}

/**
 * Every view and new tab brought up to the facts. A branch whose thread's
 * card is on its task's canvas is that card's column now: it leaves the
 * branches, unfolded (ADR-0116). A new tab's one column follows the tree,
 * and once its thread's card is on a canvas the tab becomes that task, and
 * the task you are on if you were on the tab, its column unfolded and read
 * as it was; the session puts that task in the sidebar as its send is
 * answered.
 */
function syncLayout(state: Layout, facts: LayoutFacts): Layout {
  let changed = false
  let tasks = state.tasks
  for (const [task, view] of state.tasks) {
    const canvas = facts.canvases.get(task) ?? []
    let next = view
    for (const thread of view.fresh.keys())
      if (canvas.some(c => c.id === thread))
        next = changeView(changeView(next, { kind: "closeFresh", thread }), {
          kind: "fold",
          card: thread,
          unfolded: true,
        })
    if (next !== view) {
      changed = true
      tasks = withView(tasks, task, next)
    }
  }
  let active = state.active
  const newTabs: Column[] = []
  for (const tab of state.newTabs) {
    const task = taskOnCanvas(facts.canvases, tab.thread)
    if (task === undefined) {
      const column = newTabReducer(tab, {
        kind: "sync",
        index: facts.index,
        lanes: facts.lanes,
      })
      if (column !== tab) changed = true
      newTabs.push(column)
      continue
    }
    changed = true
    const view = tasks.get(task) ?? defaultView(null)
    tasks = withView(
      tasks,
      task,
      withCard(view, tab.thread, c => ({
        ...c,
        unfolded: true,
        ...(tab.density === undefined ? {} : { density: tab.density }),
        ...(tab.details ? { details: true } : {}),
      })),
    )
    if (sameHere(active, { kind: "new", key: tab.key }))
      active = { kind: "task", task }
  }
  return changed ? { ...state, active, tasks, newTabs } : state
}

/**
 * Once the documents have settled: tasks the session lacks go (`known`), and
 * what to show is chosen. In a task whose roots this tab holds (one of its
 * threads is in the index), a branch whose fork is gone goes. The view of a
 * card no longer on the canvas goes as the layout is stored (`storedLayout`). A task you were on that is
 * gone or archived gives way to the last task of the sidebar, else nothing,
 * and with nothing the board opens: nothing opens a task by itself
 * (ADR-0030).
 */
function pruneLayout(
  state: Layout,
  facts: LayoutFacts,
  known: ReadonlySet<TaskId>,
): Layout {
  let tasks = state.tasks
  for (const [task, view] of state.tasks) {
    if (!known.has(task)) {
      const next = new Map(tasks)
      next.delete(task)
      tasks = next
      continue
    }
    const canvas = facts.canvases.get(task) ?? []
    if (!canvas.some(c => facts.index.firstOf.has(c.id as ThreadId))) continue
    const kept = prunedView(view, facts.index)
    if (kept !== view) tasks = withView(tasks, task, kept)
  }
  const list = facts.list.filter(t => known.has(t) && !facts.archived.has(t))
  const active = state.active
  // An archived task you were on is left at a reload (ADR-0029).
  const stays =
    active !== null &&
    (active.kind === "nothing" ||
      (active.kind === "task" &&
        known.has(active.task) &&
        !facts.archived.has(active.task)) ||
      (active.kind === "new" && state.newTabs.some(c => c.key === active.key)))
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

/** `view` without a branch whose fork the settled index has not. */
function prunedView(view: TaskView, index: TreeIndex): TaskView {
  const fresh = new Map(
    [...view.fresh].filter(([, f]) => index.entries[f.at] !== undefined),
  )
  return fresh.size === view.fresh.size ? view : { ...view, fresh }
}

/**
 * `layout` as it is stored (ADR-0027): without the view of a card on
 * neither its task's canvas nor one of your branches. Only a task whose
 * canvas holds a card is read: an empty one may not have arrived. The same
 * layout when nothing goes. Pure.
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
      [...view.cards].filter(
        ([card]) =>
          canvas.some(c => c.id === card) ||
          [...view.fresh.keys()].some(t => t === card),
      ),
    )
    if (cards.size !== view.cards.size)
      tasks = withView(tasks, task, { ...view, cards })
  }
  return tasks === layout.tasks ? layout : { ...layout, tasks }
}

/**
 * The sidebar as drawn, then new tabs: what the sidebar shows. An archived
 * task you are on is still in `open` (`resolveLayout` keeps it), so it keeps
 * its place.
 */
export function listOf(layout: Layout): readonly Here[] {
  return [
    ...layout.open.map(task => ({ kind: "task", task }) as const),
    ...layout.newTabs.map(c => ({ kind: "new", key: c.key }) as const),
  ]
}

/**
 * The tasks among `tasks` not in the sidebar and not archived: what ▦ marks
 * for them (ADR-0077, ADR-0122). An archived task's work is done, so it marks
 * only its own row on the board.
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
): OpenPlan | null {
  const thread = threadAt(index, id)
  if (thread === null || index.entries[id] === undefined) return null
  const task = tasks.taskOfThread.get(thread)
  if (task === undefined) return null
  const columns = openColumns(
    taskColumns(layout, task, { canvases: tasks.canvases, index, lanes }),
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

// ── stored form (ADR-0027) ────────────────────────────────────────────────
//
// Kept per browser tab through `tab-state.ts`. Built field by field both ways,
// so a field the schema does not name is never stored or restored.
// A fresh column's `pending` is one: restoring it would send its message
// again. Its `prefill` is stored: only `pending` is sent on opening. A new
// tab's `thread` is stored, so a reload keeps it and its name (ADR-0057,
// ADR-0117). The reader's settings, `density` and `details`, are kept so a
// reload shows the column as it was left.

/** A thread's id as stored: `isThreadId`'s pattern. */
const StoredThread = Type.Unsafe<ThreadId>(
  Type.String({ pattern: THREAD_PATTERN }),
)

const StoredDensity = Type.Union([
  Type.Literal("outline"),
  Type.Literal("story"),
  Type.Literal("raw"),
])

const StoredPrefill = Type.Object({
  text: Type.String(),
  blank: Type.Boolean(),
})

const StoredColumn = Type.Object({
  key: Type.String(),
  anchor: Type.Union([Type.String(), Type.Null()]),
  thread: StoredThread,
  asksAgent: Type.Optional(Type.Literal(true)),
  density: Type.Optional(StoredDensity),
  details: Type.Optional(Type.Literal(true)),
  fresh: Type.Optional(
    Type.Object({
      sendId: Type.Optional(Type.String()),
      root: Type.Optional(Type.String()),
      task: Type.Optional(Type.String()),
      state: Type.Optional(Type.String()),
      prefill: Type.Optional(StoredPrefill),
    }),
  ),
})

const StoredCardView = Type.Object({
  unfolded: Type.Optional(Type.Literal(true)),
  density: Type.Optional(StoredDensity),
  details: Type.Optional(Type.Literal(true)),
})

const StoredFresh = Type.Object({
  at: Type.String({ minLength: 1 }),
  sendId: Type.Optional(Type.String()),
  prefill: Type.Optional(StoredPrefill),
})

/** A task's view as stored: records by id, so no order can be kept (ADR-0116). */
const StoredTaskView = Type.Object({
  cards: Type.Record(Type.String(), StoredCardView),
  task: Type.Object({ unfolded: Type.Boolean() }),
  fresh: Type.Record(Type.String(), StoredFresh),
})

const StoredHere = Type.Union([
  Type.Object({ kind: Type.Literal("nothing") }),
  Type.Object({ kind: Type.Literal("task"), task: Type.String() }),
  Type.Object({ kind: Type.Literal("new"), key: Type.String() }),
])

/**
 * `v` changes when the shape does; an older layout is dropped, not migrated.
 * `v: 8` (ADR-0116): a task's columns are its canvas's, and each task keeps
 * only your view of them.
 */
const StoredLayout = Type.Object({
  v: Type.Literal(8),
  active: Type.Union([StoredHere, Type.Null()]),
  tasks: Type.Record(Type.String(), StoredTaskView),
  newTabs: Type.Array(StoredColumn),
  board: Type.Boolean(),
})

type Stored = Static<typeof StoredColumn>

const storedPrefill = (p: Prefill) => ({ text: p.text, blank: p.blank })

const toStored = (c: Column): Stored => ({
  key: c.key,
  anchor: c.anchor,
  thread: c.thread,
  ...(c.asksAgent ? { asksAgent: true } : {}),
  ...(c.density === undefined ? {} : { density: c.density }),
  ...(c.details ? { details: true } : {}),
  ...(c.fresh === undefined
    ? {}
    : {
        fresh: {
          ...(c.fresh.sendId === undefined ? {} : { sendId: c.fresh.sendId }),
          ...(c.fresh.root === undefined ? {} : { root: c.fresh.root }),
          ...(c.fresh.task === undefined ? {} : { task: c.fresh.task }),
          ...(c.fresh.state === undefined ? {} : { state: c.fresh.state }),
          ...(c.fresh.prefill === undefined
            ? {}
            : { prefill: storedPrefill(c.fresh.prefill) }),
        },
      }),
})

/**
 * A stored new tab's column, or undefined for one that cannot be restored:
 * a fresh one with no root or task of its own.
 */
const fromStored = (s: Stored): Column | undefined => {
  const root =
    s.fresh?.root === undefined ? undefined : parseNewRoot(s.fresh.root)
  const task =
    s.fresh?.task === undefined ? undefined : parseNewTask(s.fresh.task)
  if (s.fresh !== undefined && (root === undefined || task === undefined))
    return undefined
  return {
    key: s.key,
    anchor: s.anchor === null ? null : entryId(s.anchor),
    thread: s.thread,
    ...(s.asksAgent ? { asksAgent: true } : {}),
    ...(s.density === undefined ? {} : { density: s.density }),
    ...(s.details ? { details: true } : {}),
    ...(s.fresh === undefined
      ? {}
      : {
          fresh: {
            ...(s.fresh.sendId === undefined ? {} : { sendId: s.fresh.sendId }),
            ...(root === undefined ? {} : { root }),
            ...(task === undefined ? {} : { task }),
            ...(s.fresh.state !== undefined && isWorkflowStateId(s.fresh.state)
              ? { state: s.fresh.state }
              : {}),
            ...(s.fresh.prefill === undefined
              ? {}
              : { prefill: storedPrefill(s.fresh.prefill) }),
          },
        }),
  }
}

const toStoredView = (view: TaskView): Static<typeof StoredTaskView> => ({
  cards: Object.fromEntries(
    [...view.cards].map(([card, v]) => [
      card,
      {
        ...(v.unfolded ? { unfolded: true } : {}),
        ...(v.density === undefined ? {} : { density: v.density }),
        ...(v.details ? { details: true } : {}),
      },
    ]),
  ),
  task: { unfolded: view.task.unfolded },
  fresh: Object.fromEntries(
    [...view.fresh].map(([thread, f]) => [
      thread,
      {
        at: f.at,
        ...(f.sendId === undefined ? {} : { sendId: f.sendId }),
        ...(f.prefill === undefined
          ? {}
          : { prefill: storedPrefill(f.prefill) }),
      },
    ]),
  ),
})

/** A stored task view, or undefined when a key is no card's or no thread's. */
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
    })
  }
  const fresh = new Map<ThreadId, FreshColumn>()
  for (const [key, f] of Object.entries(s.fresh)) {
    if (!isThreadId(key)) return undefined
    fresh.set(key, {
      at: entryId(f.at),
      ...(f.sendId === undefined ? {} : { sendId: f.sendId }),
      ...(f.prefill === undefined ? {} : { prefill: storedPrefill(f.prefill) }),
    })
  }
  return { cards, task: { unfolded: s.task.unfolded }, fresh }
}

export const encodeLayout = (layout: Layout): Static<typeof StoredLayout> => ({
  v: 8,
  active: layout.active,
  tasks: Object.fromEntries(
    [...layout.tasks].map(([task, view]) => [task, toStoredView(view)]),
  ),
  newTabs: layout.newTabs.map(toStored),
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
  const newTabs = raw.newTabs.map(fromStored)
  if (!newTabs.every(c => c !== undefined)) return undefined
  const { active } = raw
  if (active?.kind === "task" && !isTaskId(active.task)) return undefined
  return {
    active:
      active?.kind === "task"
        ? { kind: "task", task: active.task as TaskId }
        : active,
    open: [],
    tasks,
    newTabs: newTabs.filter(c => c !== undefined),
    board: raw.board,
  }
}
