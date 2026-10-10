// task — a task's record and its canvas (ADR-0116).
//
// A task is the board's card. Its record says only who opened it and when:
// what it holds is where the places document puts each card (a `canvas`
// place, with the task and a rank), so a card has one place by construction
// and no list can disagree with it. A thread card's id is its thread's.

import {
  type BoardPlace,
  type CanvasKey,
  type CanvasTarget,
  type CardId,
  type CardInPlace,
  type CardPlace,
  type CardRecord,
  type EntryId,
  forkEntry,
  hasPlaceKind,
  isThreadId,
  type MoveTarget,
  makeCard,
  NO_CONTENT,
  type PlaceKey,
  type PlaceOf,
  type RootId,
  type TaskId,
  type TaskRecord,
  type ThreadFork,
  type ThreadId,
  type ThreadOrigin,
  type ThreadRecord,
  type TreeIndex,
  threadOfPlace,
  type ValueWrite,
  type Workflow,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { BOARD, placeStarted } from "./board.ts"
import { decodeAt, taskKey } from "./decode.ts"
import {
  type MakeStep,
  type PlaceStep,
  planMake,
  rankOnCanvas,
} from "./moves.ts"
import { branchAfter, rankAfter } from "./rank.ts"
import { type RecordSpec, setRecord } from "./records.ts"
import { THREAD } from "./thread.ts"

const TaskSchema = Type.Object({
  by: Type.String({ minLength: 1 }),
  createdAt: Type.Number(),
})

/** Each task, at its id, in the session: written as it opens. */
export const TASK: RecordSpec<TaskRecord, TaskId, "session"> = {
  namespace: "pinetrie.task",
  home: "session",
  keyOf: r => r.task,
  encode: ({ task, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(TaskSchema, contents, taskKey(key), (r, task) => ({
      task,
      by: r.by as WriterId,
      createdAt: r.createdAt,
    })),
}

/** A card on a canvas, in its task's order. */
export type CanvasCard = CardInPlace<"canvas">

/** A canvas card's kinds: what every consumer of a canvas switches over. */
export type CanvasKind = CanvasCard["kind"]

/** Whether `c` is on a canvas. */
export const isCanvasCard = (c: CardRecord): c is CanvasCard =>
  hasPlaceKind(c, "canvas")

const onCanvas = isCanvasCard

const byRank = (a: CanvasCard, b: CanvasCard): number =>
  a.place.order < b.place.order
    ? -1
    : a.place.order > b.place.order
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0

/**
 * Where every card and thread is among tasks (ADR-0116), from the places
 * and the threads' records alone: the one derivation the host and the page
 * both read, so they cannot disagree on which task something is in.
 */
export interface TaskIndex {
  /** Each task's cards, in its canvas's order: by rank, then by id. */
  readonly canvases: ReadonlyMap<TaskId, readonly CanvasCard[]>
  /** Each canvas card's task: a thread's, a note column's. */
  readonly taskOfCard: ReadonlyMap<CardId, TaskId>
  /** Each thread's task; a thread in an inventory has none. */
  readonly taskOfThread: ReadonlyMap<ThreadId, TaskId>
  /** Each task's thread cards, in canvas order. */
  readonly threadsOf: ReadonlyMap<TaskId, readonly ThreadId[]>
  /**
   * The roots of each task's threads, each once, in the order its first
   * thread is on the canvas; a thread with no record yet is left out.
   */
  readonly rootsOf: ReadonlyMap<TaskId, readonly RootId[]>
  /** The tasks each root has a thread in, by task id. */
  readonly tasksOfRoot: ReadonlyMap<RootId, readonly TaskId[]>
  /**
   * Each recorded thread's root: a place at a thread names no root, so a
   * place's root is its thread's (`THREAD`).
   */
  readonly rootOfThread: ReadonlyMap<ThreadId, RootId>
  /**
   * Each forked thread's fork, a branch's or a copy's (ADR-0117): where its
   * column ends before its first send, and what its fork row names after it.
   */
  readonly forkOf: ReadonlyMap<ThreadId, ThreadFork>
}

/** Every card's task, as the places and the threads' records say. Pure. */
export function indexTasks(
  cards: readonly CardRecord[],
  threads: ReadonlyMap<ThreadId, ThreadRecord>,
): TaskIndex {
  const canvases = new Map<TaskId, CanvasCard[]>()
  for (const c of cards.filter(onCanvas)) {
    const list = canvases.get(c.place.task) ?? []
    list.push(c)
    canvases.set(c.place.task, list)
  }
  const taskOfCard = new Map<CardId, TaskId>()
  const taskOfThread = new Map<ThreadId, TaskId>()
  const threadsOf = new Map<TaskId, readonly ThreadId[]>()
  const rootsOf = new Map<TaskId, readonly RootId[]>()
  const tasksOfRoot = new Map<RootId, TaskId[]>()
  for (const task of [...canvases.keys()].sort()) {
    const canvas = canvases.get(task) ?? []
    canvas.sort(byRank)
    for (const c of canvas) taskOfCard.set(c.id, task)
    const ids = canvas.flatMap(c => (isThreadId(c.id) ? [c.id] : []))
    threadsOf.set(task, ids)
    const roots: RootId[] = []
    for (const thread of ids) {
      taskOfThread.set(thread, task)
      const root = threads.get(thread)?.root
      if (root !== undefined && !roots.includes(root)) roots.push(root)
    }
    rootsOf.set(task, roots)
    for (const root of roots)
      tasksOfRoot.set(root, [...(tasksOfRoot.get(root) ?? []), task])
  }
  const rootOfThread = new Map(
    [...threads].map(([thread, r]) => [thread, r.root] as const),
  )
  const forkOf = new Map(
    [...threads].flatMap(([thread, r]) =>
      r.origin.kind === "fork" ? [[thread, r.origin] as const] : [],
    ),
  )
  return {
    canvases,
    taskOfCard,
    taskOfThread,
    threadsOf,
    rootsOf,
    tasksOfRoot,
    rootOfThread,
    forkOf,
  }
}

/**
 * The root a place is in: a place at a thread, its thread's
 * (`rootOfThread`). Undefined for any other, or a thread with no record.
 * Pure.
 */
export const rootOfPlace = (
  place: CardPlace | PlaceKey,
  rootOfThread: ReadonlyMap<ThreadId, RootId>,
): RootId | undefined => {
  const thread = threadOfPlace(place)
  return thread === null ? undefined : rootOfThread.get(thread)
}

/** No tasks: before the places arrive. */
export const NO_TASK_INDEX: TaskIndex = indexTasks([], new Map())

/**
 * The task a place is in (ADR-0116): a canvas card's, a card pinned to a
 * task's or a trashed card's own; a note, its note column's; a card at a thread or
 * in an entry's margin, its thread's task (a queued card's thread is its
 * lane). Null for an
 * inventory, or a thread or a note column in none. Pure.
 */
export function taskOfPlace(
  tasks: TaskIndex,
  place: CardPlace | PlaceKey,
): TaskId | null {
  switch (place.kind) {
    case "canvas":
    case "task-pinned":
      return place.task
    // A trash key names no history: the host gives it one (`historyOf`).
    case "trash":
      return "task" in place ? place.task : null
    case "inventory":
      return null
    case "note":
      return tasks.taskOfCard.get(place.column) ?? null
    case "queued":
    case "composing":
    case "pinned":
    case "margin":
      return tasks.taskOfThread.get(place.thread) ?? null
  }
}

/**
 * The task a move sends a card to: its place's (`taskOfPlace`); a thread's
 * nearest notes, its thread's; a spot on a canvas, its canvas's. Pure.
 */
export function taskOfTarget(
  tasks: TaskIndex,
  to: CardPlace | MoveTarget,
): TaskId | null {
  switch (to.kind) {
    case "notes":
      return to.near === "thread"
        ? (tasks.taskOfThread.get(to.thread) ?? null)
        : to.task
    case "canvas-at":
      return to.task
    default:
      return taskOfPlace(tasks, to)
  }
}

/** The task a card is in now: its place's (`taskOfPlace`); null for none. */
export const taskOfCard = (
  tasks: TaskIndex,
  cards: readonly CardRecord[],
  id: CardId,
): TaskId | null => {
  const now = cards.find(c => c.id === id)
  return now === undefined ? null : taskOfPlace(tasks, now.place)
}

/** One task's cards, in order. */
export const canvasOf = (
  cards: readonly CardRecord[],
  task: TaskId,
): readonly CanvasCard[] =>
  cards
    .filter(onCanvas)
    .filter(c => c.place.task === task)
    .sort(byRank)

/**
 * Where a thread's card lands as the thread opens (ADR-0126): on `task`'s
 * canvas just after the thread it forks from (`branchAfter`), else at the
 * canvas's end; where it was dropped on a canvas (`rankOnCanvas`); or in an
 * inventory.
 */
export type ThreadPlacement =
  | {
      readonly kind: "after"
      readonly task: TaskId
      /** The thread it forks from; null for a root's first thread. */
      readonly parent: ThreadId | null
    }
  | { readonly kind: "spot"; readonly to: CanvasKey | CanvasTarget }
  | { readonly kind: "inventory"; readonly holder: WriterId }

/** The task a thread opens in, when the session does not hold it yet: a new tab's. */
export interface TaskOpening {
  /** The workflow state it lands in; null for the first open one (ADR-0122). */
  readonly state: WorkflowStateId | null
  readonly workflow: Workflow | null
  readonly board: ReadonlyMap<TaskId, BoardPlace>
}

/** What a thread's opening writes, or why its card's make was refused. */
export type ThreadOpen =
  | {
      readonly kind: "open"
      /**
       * Its record; for a task the session lacks, the task's record and its
       * board place, at the end of its state (`placeStarted`), none with no
       * workflow yet.
       */
      readonly records: readonly ValueWrite[]
      /** The cards re-ranked to make room, then its card. */
      readonly steps: readonly PlaceStep[]
    }
  | Extract<MakeStep, { kind: "refused" }>

/**
 * A thread opened (ADR-0126): the one way a thread begins, before its first
 * entry, as its column opens, a copy is made or a card is spun into it. Its
 * record says how it began (`origin`); its card is made by `by`
 * (`makeCard`, `planMake`) where `placement` says; and a task the session
 * does not hold (`opens`) is written with it. Its first send writes only
 * its entry. Pure.
 */
export function planThreadOpen(input: {
  readonly thread: ThreadId
  readonly origin: ThreadOrigin
  readonly root: RootId
  readonly by: WriterId
  readonly now: number
  readonly placement: ThreadPlacement
  readonly opens: TaskOpening | null
  readonly cards: readonly CardRecord[]
}): ThreadOpen {
  const { thread, by, now, placement, cards } = input
  const ranked = ((): {
    readonly to: PlaceOf<"thread">
    readonly first: readonly PlaceStep[]
  } => {
    switch (placement.kind) {
      case "inventory":
        return { to: placement, first: [] }
      case "spot": {
        const { to, first } = rankOnCanvas(cards, thread, placement.to)
        return { to: { ...to, width: 1 }, first }
      }
      case "after": {
        const canvas = canvasOf(cards, placement.task)
        const { order, respaced } = rankAfter(
          canvas,
          branchAfter(canvas, placement.parent),
        )
        return {
          to: { kind: "canvas", task: placement.task, order, width: 1 },
          first: respaced.map(
            (record): PlaceStep => ({ kind: "write", record }),
          ),
        }
      }
    }
  })()
  const made = planMake(
    cards,
    makeCard("thread", thread, ranked.to, NO_CONTENT, by),
    by,
  )
  if (made.kind === "refused") return made
  const records: ValueWrite[] = [
    setRecord(THREAD, {
      thread,
      root: input.root,
      by,
      createdAt: now,
      origin: input.origin,
    }),
  ]
  const task = ranked.to.kind === "canvas" ? ranked.to.task : null
  if (input.opens !== null && task !== null) {
    records.push(setRecord(TASK, { task, by, createdAt: now }))
    if (input.opens.workflow !== null)
      records.push(
        setRecord(
          BOARD,
          placeStarted({
            task,
            state: input.opens.state,
            by,
            now,
            workflow: input.opens.workflow,
            places: input.opens.board,
          }),
        ),
      )
  }
  return { kind: "open", records, steps: [...ranked.first, made] }
}

/** Where a thread not yet started begins: its root, and its fork, or null for a new root's first. */
export interface ThreadOpening {
  readonly root: RootId
  readonly fork: EntryId | null
}

/**
 * Each thread opened and not yet started (ADR-0126): no entry of it in
 * `index`, and either its fork in `index` (a branch's or a copy's, its root
 * held here), or its root one the directory does not name yet (`started`:
 * a new tab's, whose root gets its document with its first entry). A
 * thread whose root this tab does not hold is in neither. Pure.
 */
export function unstartedThreads(
  threads: ReadonlyMap<ThreadId, ThreadRecord>,
  index: TreeIndex,
  started: ReadonlySet<RootId>,
): ReadonlyMap<ThreadId, ThreadOpening> {
  const out = new Map<ThreadId, ThreadOpening>()
  for (const [thread, r] of threads) {
    if (index.firstOf.has(thread)) continue
    const fork = forkEntry(r.origin)
    if (
      fork === null ? !started.has(r.root) : index.entries[fork] !== undefined
    )
      out.set(thread, { root: r.root, fork })
  }
  return out
}

/**
 * The roots something still holds (ADR-0116): those with a thread whose
 * card is on the canvas of a task outside `archived`, or in an inventory.
 * What a starting host loads (`planLoads`), and what archiving keeps. A
 * root gets its document with its first entry (ADR-0063), so one the
 * directory does not name (`started`) is not held: an unstarted new tab's
 * thread names a root with nothing to load (ADR-0126). Pure.
 */
export function rootsHeld(
  cards: readonly CardRecord[],
  threads: ReadonlyMap<ThreadId, ThreadRecord>,
  archived: ReadonlySet<TaskId>,
  started: ReadonlySet<RootId>,
): ReadonlySet<RootId> {
  const held = new Set<RootId>()
  for (const c of cards) {
    if (c.kind !== "thread") continue
    const live =
      c.place.kind === "inventory" ||
      (c.place.kind === "canvas" && !archived.has(c.place.task))
    const root = threads.get(c.id)?.root
    if (live && root !== undefined && started.has(root)) held.add(root)
  }
  return held
}
