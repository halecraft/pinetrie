// interface/layout — which task you are on, the sidebar, and each task's
// columns (ADR-0029, ADR-0030, ADR-0122, ADR-0116).
//
// The task you are on shows its rail and its columns. The sidebar is the
// tasks you have open, in your order: it is your own document, the same on
// every device (`openThreads`, `@pinetrie/session`), and comes in here as a
// fact, so the layout draws it but never stores it. The layout keeps a
// column list per task you have opened, and new tabs: each one fresh column
// at the root, in a task of its own that joins the sidebar once its first
// message is written. Which task you are on, the columns, the new tabs and
// whether the board is open are this browser tab's view state, never written
// to the document; they are stored per browser tab (ADR-0027) in the form at
// the end of this file. Pure.

import {
  ancestry,
  type EntryId,
  entryId,
  isTaskId,
  isWorkflowStateId,
  type LaneView,
  parseNewRoot,
  parseNewTask,
  pathIds,
  type RootId,
  rootOf,
  type TaskId,
  THREAD_PATTERN,
  type ThreadId,
  type TreeIndex,
  type WorkflowStateId,
} from "@pinetrie/core"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import { projectColumns } from "./column-paths.ts"
import {
  type Column,
  type ColumnAction,
  columnsReducer,
  type Prefill,
  type ReaderAction,
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
   * Each opened task's columns, in order, kept when it leaves the sidebar so
   * opening it again brings them back. A task with none is absent.
   */
  readonly tasks: ReadonlyMap<TaskId, readonly Column[]>
  /** New tabs: each one fresh column at the root, local until its first send. */
  readonly newTabs: readonly Column[]
  /** Whether the board is open over the columns (ADR-0122). */
  readonly board: boolean
}

export type LayoutAction =
  | { readonly kind: "show"; readonly here: Here }
  | {
      readonly kind: "newTab"
      readonly key: string
      /** Its root, minted with its key (ADR-0066). */
      readonly root: RootId
      /** Its task, minted with its key (ADR-0116). */
      readonly task: TaskId
      /** The thread its first send starts, minted with its key (ADR-0117). */
      readonly thread: ThreadId
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
   * it, show its neighbour. Its columns are kept.
   */
  | { readonly kind: "closeTask"; readonly task: TaskId }
  /** A column action on one task's columns; `sync` and `prune` are the layout's. */
  | {
      readonly kind: "columns"
      readonly task: TaskId
      /** Its first root's root entry, where a task with none stored starts. */
      readonly entry: EntryId | null
      readonly action: Exclude<ColumnAction, { kind: "sync" | "prune" }>
    }
  /**
   * A column action on new tab `key`'s one column: its first send, the lane
   * id it reserves (ADR-0057), or a reader's setting (`ReaderAction`).
   */
  | {
      readonly kind: "newTabColumn"
      readonly key: string
      readonly action:
        | Extract<ColumnAction, { kind: "sent" | "reserve" }>
        | ReaderAction
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

/** The document facts a layout follows: one moment's, read together. */
export interface LayoutFacts {
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  /** The tasks in the archive (ADR-0122). */
  readonly archived: ReadonlySet<TaskId>
  /** The sidebar (`openThreads`). */
  readonly list: readonly TaskId[]
  /** Each task's first root's root entry (`entriesOf`): where its first column is. */
  readonly entries: ReadonlyMap<TaskId, EntryId>
}

export const initialLayout = (): Layout => ({
  active: null,
  open: [],
  tasks: new Map(),
  newTabs: [],
  board: false,
})

/**
 * A task's columns as stored, or its first column, anchored at its first
 * root's root entry (`entry`; null for a task with no message yet). Its key
 * holds no `:`, as no column key may (`readingKey`).
 */
export function columnsOf(
  layout: Layout,
  task: TaskId,
  entry: EntryId | null,
): readonly Column[] {
  return (
    layout.tasks.get(task) ??
    (entry === null ? [] : [{ key: `first-${task}`, anchor: entry }])
  )
}

/**
 * A task's columns as drawn: its first column, never stored, settled on its
 * thread's end as stored ones are when the layout resolves.
 */
export const drawnColumns = (
  layout: Layout,
  task: TaskId,
  entry: EntryId | null,
  index: TreeIndex,
  lanes: readonly LaneView[],
): readonly Column[] =>
  layout.tasks.has(task)
    ? columnsOf(layout, task, entry)
    : columnsReducer(columnsOf(layout, task, entry), {
        kind: "sync",
        index,
        lanes,
      })

/**
 * Where a column is, by its key: a new tab's, or a task's, whether or not
 * that task is in the sidebar. Undefined for a key this layout does not hold.
 */
export function hereOfColumn(layout: Layout, key: string): Here | undefined {
  if (layout.newTabs.some(c => c.key === key)) return { kind: "new", key }
  for (const [task, columns] of layout.tasks)
    if (columns.some(c => c.key === key)) return { kind: "task", task }
  return undefined
}

export const sameHere = (a: Here | null, b: Here): boolean =>
  a !== null &&
  a.kind === b.kind &&
  (a.kind !== "task" || b.kind !== "task" || a.task === b.task) &&
  (a.kind !== "new" || b.kind !== "new" || a.key === b.key)

/** Store a task's columns; an empty list gives the task its first column again. */
const withTask = (
  tasks: ReadonlyMap<TaskId, readonly Column[]>,
  task: TaskId,
  columns: readonly Column[],
): ReadonlyMap<TaskId, readonly Column[]> => {
  const next = new Map(tasks)
  if (columns.length === 0) next.delete(task)
  else next.set(task, columns)
  return next
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
            thread: action.thread,
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
    case "columns": {
      const before = columnsOf(state, action.task, action.entry)
      const after = columnsReducer(before, action.action)
      return after === before
        ? state
        : { ...state, tasks: withTask(state.tasks, action.task, after) }
    }
    case "newTabColumn":
      return {
        ...state,
        newTabs: state.newTabs.map(c =>
          c.key === action.key
            ? (columnsReducer([c], action.action)[0] ?? c)
            : c,
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
  const synced = syncLayout(stored, facts.index, facts.lanes)
  const open = drawnList(facts.list, facts.archived, synced.active)
  return sameList(open, synced.open) ? synced : { ...synced, open }
}

/** The task a task's columns are read in: held while its first entry is in the index. */
const isHeld = (index: TreeIndex, columns: readonly Column[]): boolean =>
  columns.some(c => c.anchor !== null && index.entries[c.anchor] !== undefined)

/**
 * Every task's columns follow the tree, not only the active task's: a stored
 * anchor left behind can later follow a newer branch below it (ADR-0027). A
 * new tab whose first message is written becomes its task's columns, and the
 * task you are on; the session puts that task in the sidebar as its send is
 * answered.
 */
function syncLayout(
  state: Layout,
  index: TreeIndex,
  lanes: readonly LaneView[],
): Layout {
  let changed = false
  const tasks = new Map<TaskId, readonly Column[]>()
  for (const [task, columns] of state.tasks) {
    // A root this tab does not hold is in no index (ADR-0063): its columns
    // wait, as stored, until it is held.
    const next = !isHeld(index, columns)
      ? columns
      : columnsReducer(columns, { kind: "sync", index, lanes })
    if (next !== columns) changed = true
    tasks.set(task, next)
  }
  let active = state.active
  const newTabs: Column[] = []
  for (const tab of state.newTabs) {
    const [column = tab] = columnsReducer([tab], { kind: "sync", index, lanes })
    const task = tab.fresh?.task
    const written =
      column.fresh === undefined &&
      column.anchor !== null &&
      rootOf(index, column.anchor) !== null
    if (!written || task === undefined) {
      if (column !== tab) changed = true
      newTabs.push(column)
      continue
    }
    changed = true
    tasks.set(task, [...(tasks.get(task) ?? []), column])
    if (sameHere(active, { kind: "new", key: tab.key }))
      active = { kind: "task", task }
  }
  return changed ? { ...state, active, tasks, newTabs } : state
}

/**
 * Once the documents have settled: tasks the session lacks go (`known`),
 * anchors a held root lacks go, and what to show is chosen. A task's columns
 * are pruned only where this tab holds its roots: another's anchors are in
 * no index. A task you were on that is gone or archived gives way to the
 * last task of the sidebar, else nothing, and with nothing the board opens:
 * nothing opens a task by itself (ADR-0030).
 */
function pruneLayout(
  state: Layout,
  facts: LayoutFacts,
  known: ReadonlySet<TaskId>,
): Layout {
  let tasks = state.tasks
  for (const [task, columns] of state.tasks) {
    const next = !known.has(task)
      ? []
      : !isHeld(facts.index, columns)
        ? columns
        : columnsReducer(columns, { kind: "prune", index: facts.index })
    if (next !== columns) tasks = withTask(tasks, task, next)
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
 * The column a new path should open beside: the one sharing the deepest
 * ancestor with `id`, so its colour link is short to follow.
 */
export function openBeside(
  index: TreeIndex,
  paths: readonly ReadonlySet<EntryId>[],
  id: EntryId,
): number {
  const up = ancestry(index, id).path
  let best = paths.length - 1
  let depth = Number.POSITIVE_INFINITY
  for (const [i, path] of paths.entries()) {
    const d = up.findIndex(a => path.has(a))
    if (d >= 0 && d < depth) {
      depth = d
      best = i
    }
  }
  return best
}

/** What showing an entry means, for the shell to carry out. */
export type OpenPlan =
  /** Column `key` of `task` already shows it: show the task and scroll there. */
  | { readonly kind: "scroll"; readonly task: TaskId; readonly key: string }
  /** Show `task` and open a column anchored at the entry, after column `after`. */
  | {
      readonly kind: "open"
      readonly task: TaskId
      readonly entry: EntryId
      readonly after: number
    }

/**
 * Show entry `id`, wherever it is, in the task its root's thread is in
 * (`ofEntry`): an archived task opens as any other, read only (`appView`). A
 * message on a shared stretch of paths is drawn once, in the leftmost column
 * showing it, so every column's path is searched. Null for an entry the
 * index lacks, or one in no task.
 */
export function planOpen(
  layout: Layout,
  index: TreeIndex,
  id: EntryId,
  ofEntry: ReadonlyMap<EntryId, TaskId>,
): OpenPlan | null {
  const root = rootOf(index, id)
  if (root === null) return null
  const task = ofEntry.get(root)
  if (task === undefined) return null
  const columns = drawnColumns(layout, task, root, index, [])
  const views = projectColumns(
    index,
    columns.map(c => ({ anchor: c.anchor })),
  )
  const paths = views.map(v =>
    v.tipId === null ? new Set<EntryId>() : pathIds(index, v.tipId),
  )
  const showing = columns[paths.findIndex(p => p.has(id))]
  if (showing !== undefined) return { kind: "scroll", task, key: showing.key }
  return {
    kind: "open",
    task,
    entry: root,
    after: openBeside(index, paths, id),
  }
}

// ── stored form (ADR-0027) ────────────────────────────────────────────────
//
// Kept per browser tab through `tab-state.ts`. Built field by field both ways,
// so a field the schema does not name is never stored or restored.
// `fresh.pending` is one: restoring it would send its message again.
// `fresh.prefill` is stored: only `pending` is sent on opening. `thread` is
// stored, so a reload keeps a fresh column's thread and its name (ADR-0057,
// ADR-0117). The reader's settings, `density` and `details`, are kept so a
// reload shows the column as it was left.

/** A thread's id as stored: `isThreadId`'s pattern. */
const StoredThread = Type.Unsafe<ThreadId>(
  Type.String({ pattern: THREAD_PATTERN }),
)

const StoredColumn = Type.Object({
  key: Type.String(),
  anchor: Type.Union([Type.String(), Type.Null()]),
  thread: Type.Optional(StoredThread),
  asksAgent: Type.Optional(Type.Literal(true)),
  density: Type.Optional(
    Type.Union([
      Type.Literal("outline"),
      Type.Literal("story"),
      Type.Literal("raw"),
    ]),
  ),
  details: Type.Optional(Type.Literal(true)),
  fresh: Type.Optional(
    Type.Object({
      sendId: Type.Optional(Type.String()),
      root: Type.Optional(Type.String()),
      task: Type.Optional(Type.String()),
      state: Type.Optional(Type.String()),
      prefill: Type.Optional(
        Type.Object({
          text: Type.String(),
          blank: Type.Boolean(),
        }),
      ),
    }),
  ),
})

const StoredHere = Type.Union([
  Type.Object({ kind: Type.Literal("nothing") }),
  Type.Object({ kind: Type.Literal("task"), task: Type.String() }),
  Type.Object({ kind: Type.Literal("new"), key: Type.String() }),
])

/**
 * `v` changes when the shape does; an older layout is dropped, not migrated.
 * `v: 7` (ADR-0116): columns are kept per task, and a new tab names its task.
 */
const StoredLayout = Type.Object({
  v: Type.Literal(7),
  active: Type.Union([StoredHere, Type.Null()]),
  tasks: Type.Record(Type.String(), Type.Array(StoredColumn, { minItems: 1 })),
  newTabs: Type.Array(StoredColumn),
  board: Type.Boolean(),
})

type Stored = Static<typeof StoredColumn>

const toStored = (c: Column): Stored => ({
  key: c.key,
  anchor: c.anchor,
  ...(c.thread === undefined ? {} : { thread: c.thread }),
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
            : {
                prefill: {
                  text: c.fresh.prefill.text,
                  blank: c.fresh.prefill.blank,
                },
              }),
        },
      }),
})

/**
 * A stored column, or undefined for one that cannot be restored: a fresh
 * column with no thread to start, or a new tab's with no root or task of its
 * own (`newTab`). `newTab` says which this is: a task's fresh column takes
 * its tab's root and task.
 */
const fromStored = (s: Stored, newTab: boolean): Column | undefined => {
  const { thread } = s
  const root =
    s.fresh?.root === undefined ? undefined : parseNewRoot(s.fresh.root)
  const task =
    s.fresh?.task === undefined ? undefined : parseNewTask(s.fresh.task)
  if (
    s.fresh !== undefined &&
    (thread === undefined ||
      (newTab && (root === undefined || task === undefined)))
  )
    return undefined
  return {
    key: s.key,
    anchor: s.anchor === null ? null : entryId(s.anchor),
    ...(thread === undefined ? {} : { thread }),
    ...(s.asksAgent ? { asksAgent: true } : {}),
    ...(s.density === undefined ? {} : { density: s.density }),
    ...(s.details ? { details: true } : {}),
    ...(s.fresh === undefined
      ? {}
      : {
          fresh: {
            ...(s.fresh.sendId === undefined ? {} : { sendId: s.fresh.sendId }),
            ...(newTab && root !== undefined ? { root } : {}),
            ...(newTab && task !== undefined ? { task } : {}),
            ...(s.fresh.state !== undefined && isWorkflowStateId(s.fresh.state)
              ? { state: s.fresh.state }
              : {}),
            ...(s.fresh.prefill === undefined
              ? {}
              : {
                  prefill: {
                    text: s.fresh.prefill.text,
                    blank: s.fresh.prefill.blank,
                  },
                }),
          },
        }),
  }
}

export const encodeLayout = (layout: Layout): Static<typeof StoredLayout> => ({
  v: 7,
  active: layout.active,
  tasks: Object.fromEntries(
    [...layout.tasks].map(([task, columns]) => [task, columns.map(toStored)]),
  ),
  newTabs: layout.newTabs.map(toStored),
  board: layout.board,
})

/** Every column restored, or undefined when any cannot be. */
const allStored = (
  stored: readonly Stored[],
  newTab: boolean,
): readonly Column[] | undefined => {
  const columns = stored.map(c => fromStored(c, newTab))
  return columns.every(c => c !== undefined) ? columns : undefined
}

/**
 * A stored layout, whole or not at all: only this build writes it, so a
 * half-valid one is not worth keeping. Total.
 */
export function decodeLayout(raw: unknown): Layout | undefined {
  if (!Value.Check(StoredLayout, raw)) return undefined
  const tasks = new Map<TaskId, readonly Column[]>()
  for (const [task, stored] of Object.entries(raw.tasks)) {
    const columns = allStored(stored, false)
    if (columns === undefined || !isTaskId(task)) return undefined
    tasks.set(task, columns)
  }
  const newTabs = allStored(raw.newTabs, true)
  if (newTabs === undefined) return undefined
  const { active } = raw
  if (active?.kind === "task" && !isTaskId(active.task)) return undefined
  return {
    active:
      active?.kind === "task"
        ? { kind: "task", task: active.task as TaskId }
        : active,
    open: [],
    tasks,
    newTabs,
    board: raw.board,
  }
}
